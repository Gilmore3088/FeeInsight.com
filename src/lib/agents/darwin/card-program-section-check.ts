import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { CARD_PROGRAM_KEEP_KEYS } from "@/lib/agents/darwin/non-deposit-document-check";
import {
  CARD_PROGRAM_SECTION_REACH_LINES,
  DEPOSIT_ROW_WORDS_SQL,
  SECTION_DOLLAR_PRICE_SQL,
  SECTION_ROW_PRICE_SQL,
  STACKED_PRICE_LINE_SQL,
  AUDIENCE_ROW_SQL,
  cardProgramHeadingSql,
  cardProgramSectionFee,
  sectionNamePatternSql,
  sectionRowSql,
  sectionWordsSql,
  trimSql,
  wrappedCardRowSql,
} from "@/lib/custom-report/card-program-section";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees printed in a prepaid, payroll, gift or travel card section of a
 * general fee schedule (#1908, #1905; decision 2026-10-15, "Darwin re-checks every live fee against
 * today's rules"). The rule is the shared `cardProgramSectionFee`
 * (`@/lib/custom-report/card-program-section`), which Knox v116 also applies before any specialist
 * reads a text. The document-level twin, `card_program_document` in `non-deposit-document-check.ts`,
 * reads a card program's own document by its address; this check reads the stored text, so it
 * catches Navy Federal's "Prepaid and Gift Cards" / "GO Prepaid Cards" sections inside
 * `/membership/fees-and-charges.html`, whose "Lost/Stolen Card" $5 and "Visa/PLUS Network ATM ...
 * cash withdrawal and balance inquiry" $1 were published as the account's fees on every re-read and
 * taken down by hand three times (#1905).
 *
 * A fee comes down when every line of its document's latest stored text that prints its name with
 * its price sits in a card program section, unless it is the card's own purchase or reload price
 * (`CARD_PROGRAM_KEEP_KEYS`). Only documents whose text names a card program are read
 * (`CARD_PROGRAM_TEXT_SQL`), at most once per `CARD_PROGRAM_SECTION_SCAN_INTERVAL_HOURS`; an
 * institution-scoped run reads that institution's fees every time and does not restart the clock.
 *
 * The switch is the code constant `CARD_PROGRAM_SECTION_TAKEDOWN_LIVE`. The read-only dry run of
 * 2026-10-25 found 12 live fees, and every one was read against the bank's own text and is the
 * card's fee, not the account's (the sampled-clean rule, DECISIONS 2026-10-20). James approved
 * turning it on (2026-10-25, decision card in the Truth lane thread). Off (`live: false`), or
 * in a dry run, the step only reports what it would take down. On, a matching fee goes through the
 * shared 12-hour second look (check `darwin.card_program_section`) and is archived on its second failure: rolled
 * back with `card_program_section: #<doc>`, its verified row rejected with the
 * `card_program_section` flag, never deleted, and a `darwin.card_program_section_takedown` event
 * lists them. The read-only dry-run count over the whole live table is `cardProgramSectionFeesSql`,
 * the Postgres mirror of the same rule.
 */
export const CARD_PROGRAM_SECTION_CHECK = "darwin.card_program_section";
export const CARD_PROGRAM_SECTION_CHECK_VERSION = 1;
/** The switch (see the module note): on since 2026-10-25, James's yes; a one-line change turns it off. */
export const CARD_PROGRAM_SECTION_TAKEDOWN_LIVE: boolean = true;
export const CARD_PROGRAM_SECTION_REASON = "card_program_section";
export const CARD_PROGRAM_SECTION_FLAG = "card_program_section";
export const CARD_PROGRAM_SECTION_DOCUMENT_LIMIT = 2_000;
export const CARD_PROGRAM_SECTION_SAMPLES = 20;
export const CARD_PROGRAM_SECTION_SCAN_INTERVAL_HOURS = 1;
/**
 * A text that names a card program anywhere: the only texts read (Postgres `~*`). A plain
 * alternation, so Postgres scans it fast (a line-anchored pattern took 20-33 s for 1,180 texts);
 * `cardProgramHeading` does the line test in JS. Any run of non-letters may join the words, as
 * `sectionWords` joins them, so it is wider than `CARD_PROGRAM_WORDS`, never narrower.
 */
export const CARD_PROGRAM_TEXT_SQL = "pre[^a-z0-9]*paid|payroll[^a-z0-9]*card|gift[^a-z0-9]*card|travel[^a-z0-9]*card|travel[^a-z0-9]*money|reloadable";

export interface CardProgramSectionFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
}

export interface CardProgramSectionDocumentRow {
  source_document_id: number | string;
  document_url: string | null;
  normalized_text: string | null;
  fees: CardProgramSectionFeeRow[] | string | null;
}

export interface CardProgramSectionMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  sourceDocumentId: number;
  documentUrl: string;
  reason: string;
}

export interface CardProgramSectionFindings {
  /** Live fees read (on documents whose text names a card program). */
  checked: number;
  documentsRead: number;
  matched: number;
  /** Card purchase or reload prices in a card section, which stay live. */
  keptCardPurchase: number;
  documents: number;
  institutions: number;
  samples: CardProgramSectionMatch[];
}

export interface CardProgramSectionResult extends CardProgramSectionFindings {
  live: boolean;
  /** The read hit its document limit: the oldest texts past it wait for a later read. */
  truncated: boolean;
  dryRun: boolean;
  skipped: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function feesOf(row: CardProgramSectionDocumentRow): CardProgramSectionFeeRow[] {
  if (Array.isArray(row.fees)) return row.fees;
  if (typeof row.fees === "string") {
    try {
      const parsed = JSON.parse(row.fees) as unknown;
      return Array.isArray(parsed) ? (parsed as CardProgramSectionFeeRow[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Pure: the live fees on the documents read that sit in a card program section (see the module note). */
export function findCardProgramSectionFees(documents: CardProgramSectionDocumentRow[]): CardProgramSectionFindings & { matches: CardProgramSectionMatch[] } {
  const matches: CardProgramSectionMatch[] = [];
  const seen = new Set<number>();
  let checked = 0;
  let keptCardPurchase = 0;
  for (const document of documents) {
    const documentId = num(document.source_document_id);
    if (documentId == null) continue;
    for (const fee of feesOf(document)) {
      const feeId = Number(fee.fee_published_id);
      if (!Number.isFinite(feeId) || seen.has(feeId)) continue;
      seen.add(feeId);
      checked += 1;
      const amount = num(fee.amount);
      if (amount == null || !cardProgramSectionFee(document.normalized_text, fee.fee_name, amount)) continue;
      if (fee.canonical_fee_key != null && CARD_PROGRAM_KEEP_KEYS.has(fee.canonical_fee_key)) {
        keptCardPurchase += 1;
        continue;
      }
      matches.push({
        feePublishedId: feeId,
        feeVerifiedId: num(fee.fee_verified_id),
        institutionId: Number(fee.institution_id),
        feeName: fee.fee_name ?? "",
        amount,
        canonicalFeeKey: fee.canonical_fee_key ?? null,
        sourceDocumentId: documentId,
        documentUrl: (document.document_url ?? "").trim(),
        reason: `${CARD_PROGRAM_SECTION_REASON}: #${documentId}`,
      });
    }
  }
  matches.sort((a, b) => a.feePublishedId - b.feePublishedId);
  return {
    checked,
    documentsRead: documents.length,
    matched: matches.length,
    keptCardPurchase,
    documents: new Set(matches.map((fee) => fee.sourceDocumentId)).size,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, CARD_PROGRAM_SECTION_SAMPLES),
    matches,
  };
}

/**
 * Read-only: each live document whose stored text names a card program, with its text and its live
 * dollar fees, newest text first, at most `limit` documents (the result is `truncated` when it hits
 * the limit, and the oldest texts are the ones left for a later read).
 */
/** The document limit a read uses. */
export function documentLimit(limit?: number): number {
  return Math.max(1, Math.min(limit ?? CARD_PROGRAM_SECTION_DOCUMENT_LIMIT, 20_000));
}

export function cardProgramSectionDocumentsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = documentLimit(options.limit);
  return db<CardProgramSectionDocumentRow[]>`
    WITH live AS MATERIALIZED (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount IS NOT NULL
         AND fr.source_document_id IS NOT NULL
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
    ),
    -- The documents first (one text per document: agent_source_texts.source_document_id is
    -- unique), newest text first, so a read past the limit drops the oldest texts.
    docs AS MATERIALIZED (
      SELECT ast.source_document_id, ast.updated_at
        FROM agent_source_texts ast
       WHERE ast.source_document_id IN (SELECT source_document_id FROM live)
         AND ast.normalized_text ~* ${CARD_PROGRAM_TEXT_SQL}
       ORDER BY ast.updated_at DESC NULLS LAST, ast.source_document_id DESC
       LIMIT ${limit}::int
    ),
    -- Their live fees, joined once.
    grouped AS (
      SELECT docs.source_document_id, max(docs.updated_at) AS updated_at,
             json_agg(json_build_object(
               'fee_published_id', l.fee_published_id, 'fee_verified_id', l.fee_verified_id,
               'institution_id', l.institution_id, 'fee_name', l.fee_name, 'amount', l.amount,
               'canonical_fee_key', l.canonical_fee_key) ORDER BY l.fee_published_id) AS fees
        FROM docs
        JOIN live l ON l.source_document_id = docs.source_document_id
       GROUP BY docs.source_document_id
    )
    SELECT g.source_document_id, btrim(sd.document_url) AS document_url, ast.normalized_text, g.fees
      FROM grouped g
      JOIN agent_source_texts ast ON ast.source_document_id = g.source_document_id
      LEFT JOIN source_documents sd ON sd.id = g.source_document_id
     ORDER BY g.updated_at DESC NULLS LAST, g.source_document_id DESC
  `;
}

/**
 * The same rule as one read-only SQL statement over the whole live table, for someone with prod
 * access (the dry-run count): one row per live fee the check would take down (`verdict`
 * 'card_program_section') or keep as a card purchase or reload price ('kept_card_purchase'), with its
 * document address. The Postgres mirror of `cardProgramSectionFee`: the same row, header, heading,
 * name and price patterns, and the same reach.
 */
export function cardProgramSectionFeesSql(): string {
  const keep = [...CARD_PROGRAM_KEEP_KEYS].sort().map((key) => `'${key}'`).join(", ");
  return `WITH live AS (
  SELECT fp.fee_published_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key, fr.source_document_id
    FROM published_fee_records fp
    JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
   WHERE fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL AND fp.amount IS NOT NULL AND fr.source_document_id IS NOT NULL
), texts AS MATERIALIZED (
  SELECT d.source_document_id, t.normalized_text
    FROM (SELECT DISTINCT source_document_id FROM live) d
    -- Through the unique index per document: a plain join lets the planner scan every text.
    JOIN LATERAL (
      SELECT ast.normalized_text FROM agent_source_texts ast
       WHERE ast.source_document_id = d.source_document_id
    ) t ON TRUE
   WHERE t.normalized_text ~* '${CARD_PROGRAM_TEXT_SQL}'
), all_lines AS (
  SELECT tx.source_document_id, l.n, l.line
    FROM texts tx, regexp_split_to_table(tx.normalized_text, E'\\n') WITH ORDINALITY AS l(line, n)
), lines AS MATERIALIZED (
  SELECT source_document_id, n, line,
         row_number() OVER (PARTITION BY source_document_id ORDER BY n) AS k,
         ${sectionRowSql("line")} AS is_row
    FROM all_lines
   WHERE ${trimSql("line")} <> ''
), headed AS (
  SELECT l.*,
         max(CASE WHEN NOT l.is_row THEN l.k END) OVER (PARTITION BY l.source_document_id ORDER BY l.k ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS head_k
    FROM lines l
), section_rows AS MATERIALIZED (
  SELECT h.source_document_id, h.n, h.line
    FROM headed h
    JOIN lines hl ON hl.source_document_id = h.source_document_id AND hl.k = h.head_k
    -- The first line under the heading: a bare price there makes the heading a stacked row label.
    JOIN lines fl ON fl.source_document_id = h.source_document_id AND fl.k = h.head_k + 1
    -- The line right above the heading: a priced card row there makes the heading its wrapped end.
    LEFT JOIN lines pl ON pl.source_document_id = h.source_document_id AND pl.k = h.head_k - 1
   WHERE h.is_row
     AND NOT (fl.is_row AND ${trimSql("fl.line")} ~ ${STACKED_PRICE_LINE_SQL})
     AND NOT (COALESCE(pl.is_row, false) AND ${wrappedCardRowSql("pl.line")})
     AND h.k - h.head_k <= ${CARD_PROGRAM_SECTION_REACH_LINES}
     AND ${trimSql("h.line")} ~ ${SECTION_ROW_PRICE_SQL}
     AND ${sectionWordsSql("h.line")} !~ ${DEPOSIT_ROW_WORDS_SQL}
     AND ${sectionWordsSql("h.line")} !~ ${AUDIENCE_ROW_SQL}
     AND ${cardProgramHeadingSql("hl.line")}
), fees AS (
  SELECT lv.*, ${sectionNamePatternSql("lv.fee_name")} AS name_pattern
    FROM live lv
   -- Only documents with a card program section can hold a match.
   WHERE lv.source_document_id IN (SELECT DISTINCT source_document_id FROM section_rows)
), priced AS (
  SELECT f.fee_published_id, al.n,
         EXISTS (SELECT 1 FROM section_rows s WHERE s.source_document_id = al.source_document_id AND s.n = al.n) AS in_card
    FROM fees f
    JOIN all_lines al ON al.source_document_id = f.source_document_id
   WHERE f.name_pattern IS NOT NULL
     AND strpos(al.line, '$') > 0
     AND lower(al.line) ~ f.name_pattern
     AND EXISTS (
       SELECT 1 FROM regexp_matches(substring(lower(al.line) FROM f.name_pattern || '.*$'), ${SECTION_DOLLAR_PRICE_SQL}, 'g') AS m(price)
        WHERE abs(replace(m.price[1], ',', '')::numeric - f.amount) < 0.005
     )
), judged AS (
  SELECT fee_published_id FROM priced GROUP BY fee_published_id HAVING bool_and(in_card)
)
SELECT CASE WHEN COALESCE(f.canonical_fee_key IN (${keep}), false) THEN 'kept_card_purchase' ELSE 'card_program_section' END AS verdict,
       f.fee_published_id, f.institution_id, f.fee_name, f.amount, f.canonical_fee_key, f.source_document_id,
       btrim(sd.document_url) AS document_url
  FROM judged j
  JOIN fees f ON f.fee_published_id = j.fee_published_id
  JOIN source_documents sd ON sd.id = f.source_document_id
 ORDER BY verdict, f.fee_published_id;`;
}

/** True when a full (not institution-scoped) read ran under the interval ago. A failed read never skips. */
async function readRecently(db: SqlTag, now: Date): Promise<boolean> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<{ created_at: Date | string | null }[]>`
      SELECT created_at
        FROM agent_run_events
       WHERE event_type = ${CARD_PROGRAM_SECTION_CHECK}
         AND COALESCE(detail->>'scoped', 'false') <> 'true'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    const at = rows[0]?.created_at == null ? null : new Date(rows[0].created_at).getTime();
    return at != null && Number.isFinite(at) && now.getTime() - at < CARD_PROGRAM_SECTION_SCAN_INTERVAL_HOURS * 3_600_000;
  } catch (error) {
    console.warn("[darwin] card program section interval read failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckCardProgramSections(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<CardProgramSectionResult> {
  const live = options.live ?? CARD_PROGRAM_SECTION_TAKEDOWN_LIVE;
  const { matches: _none, ...empty } = findCardProgramSectionFees([]);
  void _none;
  const result: CardProgramSectionResult = { live, truncated: false, dryRun: options.dryRun, skipped: false, scoped: options.institutionId != null, ...empty, flagged: 0, waiting: 0, takenDown: [] };

  if (options.institutionId == null && !options.dryRun && await readRecently(db, options.now ?? new Date())) {
    result.skipped = true;
    return result;
  }

  let documents: CardProgramSectionDocumentRow[];
  try {
    documents = await inSavepoint(db, (scope) => cardProgramSectionDocumentsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] card program section check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findCardProgramSectionFees(documents);
  Object.assign(result, findings);
  result.truncated = documents.length === documentLimit(options.limit);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: CARD_PROGRAM_SECTION_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${CARD_PROGRAM_SECTION_CHECK}, 'completed',
          ${`Read live fees for a prepaid, payroll, gift or travel card section: ${result.matched} of ${result.checked} live fee(s) on ${result.documents} document(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(cardProgramSectionDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] card program section check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: CardProgramSectionMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-card-program-section-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${CARD_PROGRAM_SECTION_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${CARD_PROGRAM_SECTION_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return fees.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] card program section takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: CardProgramSectionMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.card_program_section_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) printed in a prepaid, payroll, gift or travel card section, on their second look`},
        ${JSON.stringify({ version: CARD_PROGRAM_SECTION_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] card program section takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: CardProgramSectionMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    document_url: fee.documentUrl,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function cardProgramSectionDetail(result: CardProgramSectionResult) {
  return {
    check: CARD_PROGRAM_SECTION_CHECK,
    version: CARD_PROGRAM_SECTION_CHECK_VERSION,
    switch_live: result.live,
    truncated: result.truncated,
    dry_run: result.dryRun,
    skipped: result.skipped,
    scoped: result.scoped,
    checked: result.checked,
    documents_read: result.documentsRead,
    matched: result.matched,
    kept_card_purchase: result.keptCardPurchase,
    documents: result.documents,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
