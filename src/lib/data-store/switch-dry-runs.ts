import type { sql } from "@/lib/data-store/connection";
import { loadSourceTexts } from "@/lib/agents/darwin/verify";
import { runFreshAudit } from "@/lib/agents/deming/fresh-audit";
import { EXCERPT_ONLY_CODES } from "@/lib/agents/deming/switch-dry-runs/excerpt-at-publish";
import type {
  DailyCapRow,
  DocumentRow,
  LimitRow,
  LimitTakedownRow,
  LiveFeeRow,
  SwitchAuditReader,
} from "@/lib/agents/deming/switch-dry-runs/types";
import { LIMIT_GUARD_MIN_AMOUNT, LIMIT_GUARD_REASON, TRANSACTION_AMOUNT_PG } from "@/lib/agents/hamilton/limit-guard";

type SqlTag = typeof sql;

/**
 * The switch dry-run audit's reads (#1092): SELECT statements, plus one `SET LOCAL statement_timeout`
 * and one `SHOW transaction_read_only`, all inside one read-only, repeatable-read transaction
 * (`withReadOnlySwitchAudit`), so a write anywhere under it fails instead of landing. Each read but
 * the fresh audit takes an institution scope as its last parameter (null for every institution).
 */

const LIVE = "fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL";
const CAP_CATEGORIES = ["od_daily_cap", "nsf_daily_cap"];
const scoped = (column: string, param: number) => `($${param}::bigint[] IS NULL OR ${column} = ANY($${param}::bigint[]))`;

/** Raw reads filed as daily caps (Knox's hint, or Darwin's verified category), with every tier. `$1` row cap, `$2` scope. */
export const DAILY_CAP_ROWS_SQL = `
  WITH cap_raw AS (
    SELECT fr.fee_raw_id
      FROM raw_fee_observations fr
     WHERE (COALESCE(fr.outlier_flags, '[]'::jsonb) ?| ARRAY['canonical_hint:od_daily_cap', 'canonical_hint:nsf_daily_cap']
            OR COALESCE(fr.extraction_note, fr.conditions) ~ 'canonical_hint=(od|nsf)_daily_cap')
       AND ${scoped("fr.institution_id", 2)}
    UNION
    SELECT fv.fee_raw_id FROM verified_fee_observations fv
     WHERE fv.canonical_fee_key IN ('${CAP_CATEGORIES.join("', '")}') AND ${scoped("fv.institution_id", 2)}
  )
  SELECT fr.fee_raw_id, fr.institution_id, inst.institution_name, fr.source_document_id,
         fr.source_url, sd.document_url, sd.crawled_at AS document_crawled_at,
         to_jsonb(sd)->>'companion_source_id' AS document_stream, fr.fee_name AS raw_name, fr.amount AS raw_amount, fr.product_name, fr.outlier_flags,
         COALESCE(fr.extraction_note, fr.conditions) AS conditions,
         fv.fee_verified_id, fv.review_status, fv.canonical_fee_key AS verified_key,
         fv.fee_name AS verified_name, fv.amount AS verified_amount,
         fp.fee_published_id, fp.canonical_fee_key AS published_key, fp.fee_name AS published_name,
         fp.amount AS published_amount,
         (fp.fee_published_id IS NOT NULL AND (fp.rolled_back_at IS NOT NULL OR fp.quarantined_at IS NOT NULL)) AS removed,
         fp.rolled_back_reason,
         pa.detail->>'decision' AS verify_decision, pa.detail->>'reason_code' AS verify_reason,
         pa.detail->>'canonical_fee_key' AS verify_key
    FROM cap_raw c
    JOIN raw_fee_observations fr ON fr.fee_raw_id = c.fee_raw_id
    LEFT JOIN institution_sources inst ON inst.id = fr.institution_id
    LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
    LEFT JOIN LATERAL (
      SELECT v.* FROM verified_fee_observations v WHERE v.fee_raw_id = fr.fee_raw_id ORDER BY v.fee_verified_id DESC LIMIT 1
    ) fv ON true
    LEFT JOIN LATERAL (
      SELECT p.* FROM published_fee_records p WHERE p.lineage_ref = fv.fee_verified_id
       ORDER BY (p.rolled_back_at IS NULL AND p.quarantined_at IS NULL) DESC, p.fee_published_id DESC LIMIT 1
    ) fp ON true
    LEFT JOIN LATERAL (
      SELECT a.detail FROM pipeline_attempts a
       WHERE a.stage = 'verify' AND a.strategy = 'verify.rules' AND a.input_fingerprint = 'raw:' || fr.fee_raw_id::text
       ORDER BY a.created_at DESC, a.id DESC LIMIT 1
    ) pa ON true
   WHERE fr.amount IS NOT NULL
   ORDER BY fr.fee_raw_id
   LIMIT $1::int`;

/**
 * Every space JavaScript's `\s` matches. Postgres's `\s` misses the no-break and Unicode spaces
 * (checked on PostgreSQL 16), and schedules print them between a price and its dash.
 */
// A plain string, so Postgres receives the \u escapes themselves (build tools may cook a String.raw).
const SPACE = "[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";

/**
 * A superset of Knox's dash list line (`PRICE_DASH_NAME` in `knox/dash-list-rows.ts`): a price, a
 * spaced dash, a capital. `dashListRuns` makes the real test on each text.
 */
export const DASH_LINE_PG = String.raw`\$${SPACE}?[0-9][0-9,]*(\.[0-9]{1,2})?${SPACE}+[-–—]${SPACE}+[A-Z]`;

/**
 * Candidate documents, chosen by institution: every current copy Knox reads (success, no duplicate,
 * not superseded), at any institution, and every document a live fee cites. Institutions with a live
 * fee come first, so a bound trims those with nothing live to sit beside. The bound applies before
 * any text is read: `$2` candidates from `$4` on, in that order, are the only ones whose newest
 * completed text is scanned for a dash list line (`$1`). Every row carries `scanned`, the number of
 * candidates read; a scan that matches nothing returns one row with no document. `$3` scope.
 */
export const DASH_LIST_DOCUMENTS_SQL = `
  WITH live_docs AS (
    SELECT DISTINCT fr.source_document_id
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE ${LIVE} AND fr.source_document_id IS NOT NULL AND ${scoped("fp.institution_id", 3)}
  ), live_institutions AS (
    SELECT DISTINCT fp.institution_id FROM published_fee_records fp WHERE ${LIVE} AND ${scoped("fp.institution_id", 3)}
  ), candidates AS (
    SELECT sd.id FROM source_documents sd
     WHERE sd.status = 'success' AND sd.duplicate_of_id IS NULL AND sd.superseded_by_id IS NULL
       AND ${scoped("sd.institution_id", 3)}
    UNION
    SELECT source_document_id FROM live_docs
  ), bounded AS MATERIALIZED (
    SELECT sd.id, sd.institution_id,
           row_number() OVER (ORDER BY (sd.institution_id IN (SELECT institution_id FROM live_institutions)) DESC, sd.institution_id, sd.id) AS rank
      FROM candidates c
      JOIN source_documents sd ON sd.id = c.id
     ORDER BY rank
    OFFSET $4::int
     LIMIT $2::int
  ), newest AS (
    SELECT DISTINCT ON (t.source_document_id) t.source_document_id, t.id
      FROM agent_source_texts t
      JOIN bounded b ON b.id = t.source_document_id
     WHERE t.status = 'completed' AND t.normalized_text IS NOT NULL
     ORDER BY t.source_document_id, t.id DESC
  ), matched AS (
    SELECT sd.id AS source_document_id, sd.institution_id, inst.institution_name, sd.document_url, sd.crawled_at,
           to_jsonb(sd)->>'companion_source_id' AS document_stream, b.rank
      FROM newest n
      JOIN agent_source_texts t ON t.id = n.id
      JOIN bounded b ON b.id = n.source_document_id
      JOIN source_documents sd ON sd.id = n.source_document_id
      LEFT JOIN institution_sources inst ON inst.id = sd.institution_id
     WHERE t.normalized_text ~ $1
  )
  SELECT (SELECT count(*) FROM bounded)::int AS scanned, m.source_document_id, m.institution_id, m.institution_name,
         m.document_url, m.crawled_at, m.document_stream
    FROM (SELECT 1) one
    LEFT JOIN matched m ON true
   ORDER BY m.rank`;

/** Every live fee at the institutions in `$1`, as `selectLivePublishedFees` reads them (rates and no-amount rows too). */
export const LIVE_FEES_AT_SQL = `
  SELECT fp.fee_published_id, fp.institution_id, inst.institution_name, fp.canonical_fee_key, fp.fee_name,
         fr.fee_name AS raw_fee_name, fp.amount, fp.amount_kind, fp.rate_percent, fp.frequency, fp.variant_type,
         fp.fee_audience, fr.product_name, fp.published_at, fp.source_url, fr.source_document_id,
         sd.crawled_at AS document_crawled_at, to_jsonb(sd)->>'companion_source_id' AS document_stream, sd.document_url
    FROM published_fee_records fp
    LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
    LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
    LEFT JOIN institution_sources inst ON inst.id = fp.institution_id
   WHERE fp.institution_id = ANY($1::bigint[])
     AND ${LIVE}
   ORDER BY fp.fee_published_id`;

/**
 * Live dollar fees as the publish step's verified row carries them (name, category, amount), with
 * Knox's audit text, where the excerpt can change the limit verdict. `$1` cap, `$2` the guard's
 * minimum amount, `$3` the transaction-amount pattern, `$4` scope.
 */
export const LIMIT_ROWS_SQL = `
  SELECT fp.fee_published_id, fp.institution_id, inst.institution_name, fr.source_document_id,
         COALESCE(fv.canonical_fee_key, fp.canonical_fee_key) AS canonical_fee_key,
         COALESCE(fv.fee_name, fp.fee_name) AS fee_name, COALESCE(fv.amount, fp.amount) AS amount,
         COALESCE(fr.extraction_note, fr.conditions) AS conditions
    FROM published_fee_records fp
    JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
    LEFT JOIN institution_sources inst ON inst.id = fp.institution_id
   WHERE ${LIVE}
     AND fp.amount > 0
     AND fp.amount_kind IS DISTINCT FROM 'percent'
     AND (fp.amount >= $2::numeric OR COALESCE(fr.extraction_note, fr.conditions) ~* $3)
     AND ${scoped("fp.institution_id", 4)}
   ORDER BY fp.fee_published_id
   LIMIT $1::int`;

/**
 * Fees the live limit sweep took down with a reading in `$2` (LIKE patterns), each with the names of
 * the live rows of its institution, category and amount; the audit compares them by Hamilton's
 * `normalizedFeeName` (`republished`). `$1` cap, `$3` scope.
 */
export const EXCERPT_TAKEDOWNS_SQL = `
  SELECT fp.fee_published_id, fp.institution_id, inst.institution_name, fp.canonical_fee_key, fp.fee_name,
         fp.amount, fp.rolled_back_reason,
         ARRAY(
           SELECT again.fee_name FROM published_fee_records again
            WHERE again.institution_id = fp.institution_id
              AND again.canonical_fee_key = fp.canonical_fee_key
              AND again.amount IS NOT DISTINCT FROM fp.amount
              AND again.rolled_back_at IS NULL AND again.quarantined_at IS NULL
            ORDER BY again.fee_published_id
         ) AS live_names
    FROM published_fee_records fp
    LEFT JOIN institution_sources inst ON inst.id = fp.institution_id
   WHERE fp.rolled_back_at IS NOT NULL
     AND fp.rolled_back_reason LIKE ANY($2::text[])
     AND ${scoped("fp.institution_id", 3)}
   ORDER BY fp.fee_published_id
   LIMIT $1::int`;

export const EXCERPT_TAKEDOWN_PATTERNS = EXCERPT_ONLY_CODES.map((code) => `${LIMIT_GUARD_REASON}:${code}:%`);

/** Every statement the reader sends itself, for the read-only test. */
export const SWITCH_AUDIT_STATEMENTS = [DAILY_CAP_ROWS_SQL, DASH_LIST_DOCUMENTS_SQL, LIVE_FEES_AT_SQL, LIMIT_ROWS_SQL, EXCERPT_TAKEDOWNS_SQL];

/**
 * A superset of what `SECTION_PATH_LIVE` (#1092) reads: an audience word. The section path itself
 * (`section-path.ts`) makes the real test on each text.
 */
export const SECTION_PATH_PG = "(?i)(business|commercial|corporate|treasury|merchant|personal|consumer|individual)";

/**
 * A superset of what the v157 held-name vocabulary reads (`held-name-vocabulary.ts`), for the
 * `HELD_VOCABULARY_RELABEL_LIVE` section: the vocabulary itself makes the real test on each text.
 */
export const HELD_VOCABULARY_PG =
  "(?i)(skip|amorti[sz]|pay-?offs?\\s+processing|foreign\\s+(check|item|draft)|canadian\\s+(check|item|draft)|international\\s+(check|item|draft)|proof of funds|verification of|immigration|title|dmv)";

/** Candidate documents (`DASH_LIST_DOCUMENTS_SQL`) whose newest completed text matches `pattern`. */
async function matchingDocuments(db: SqlTag, pattern: string, limit: number, offset: number, scope: number[] | null) {
  const rows = await db.unsafe<Array<Partial<DocumentRow> & { scanned: number }>>(DASH_LIST_DOCUMENTS_SQL, [pattern, limit, scope, offset]);
  return {
    scanned: Number(rows[0]?.scanned ?? 0),
    documents: rows.filter((row): row is DocumentRow & { scanned: number } => row.source_document_id != null).map((row) => ({
      source_document_id: row.source_document_id,
      institution_id: row.institution_id,
      institution_name: row.institution_name,
      document_url: row.document_url,
      crawled_at: row.crawled_at,
      document_stream: row.document_stream,
    })),
  };
}

export function createSwitchAuditReader(db: SqlTag, options: { now?: Date; institutionIds?: number[] | null } = {}): SwitchAuditReader {
  const scope = options.institutionIds?.length ? options.institutionIds : null;
  return {
    dailyCapRows: (limit) => db.unsafe<DailyCapRow[]>(DAILY_CAP_ROWS_SQL, [limit, scope]),
    sourceTexts: (documentIds) => loadSourceTexts(db, documentIds),
    dashListDocuments: (limit, offset) => matchingDocuments(db, DASH_LINE_PG, limit, offset, scope),
    sectionPathDocuments: (limit, offset) => matchingDocuments(db, SECTION_PATH_PG, limit, offset, scope),
    heldVocabularyDocuments: (limit, offset) => matchingDocuments(db, HELD_VOCABULARY_PG, limit, offset, scope),
    liveFeesAt: async (institutionIds) =>
      institutionIds.length === 0 ? [] : db.unsafe<LiveFeeRow[]>(LIVE_FEES_AT_SQL, [institutionIds]),
    limitRows: (limit) => db.unsafe<LimitRow[]>(LIMIT_ROWS_SQL, [limit, LIMIT_GUARD_MIN_AMOUNT, TRANSACTION_AMOUNT_PG, scope]),
    excerptLimitTakedowns: (limit) => db.unsafe<LimitTakedownRow[]>(EXCERPT_TAKEDOWNS_SQL, [limit, EXCERPT_TAKEDOWN_PATTERNS, scope]),
    freshAudit: (sampleSize) => runFreshAudit({ db, now: options.now, sampleSize }),
  };
}

/** A statement may run this long before Postgres stops it; the audit reads whole tables. */
export const SWITCH_AUDIT_STATEMENT_TIMEOUT_MS = 600_000;

/**
 * Runs `work` with a reader inside one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`
 * transaction: one snapshot for every count, and Postgres refuses any write. Throws when the
 * session does not report itself read-only.
 */
export async function withReadOnlySwitchAudit<T>(
  client: SqlTag,
  work: (reader: SwitchAuditReader) => Promise<T>,
  options: { statementTimeoutMs?: number; now?: Date; institutionIds?: number[] | null } = {},
): Promise<T> {
  const timeout = Math.max(1_000, Math.trunc(options.statementTimeoutMs ?? SWITCH_AUDIT_STATEMENT_TIMEOUT_MS));
  return client.begin("isolation level repeatable read read only", async (tx) => {
    // postgres.js leaves the tag signature off its transaction type (see `withTransaction`).
    const db = tx as unknown as SqlTag;
    await db.unsafe(`SET LOCAL statement_timeout = ${timeout}`);
    const [state] = await db.unsafe<Array<{ transaction_read_only: string }>>("SHOW transaction_read_only");
    if (state?.transaction_read_only !== "on") {
      throw new Error(`switch dry-run audit: the transaction is not read-only (transaction_read_only=${state?.transaction_read_only ?? "unknown"})`);
    }
    return work(createSwitchAuditReader(db, { now: options.now, institutionIds: options.institutionIds }));
  }) as Promise<T>;
}
