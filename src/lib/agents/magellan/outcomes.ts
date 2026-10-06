import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Magellan's outcome ledger (MG-1). Every link Magellan handed downstream (a bank's main
 * fee link and its companion pages) is judged by what it produced: live fees, a thin
 * read, a page Rosetta ruled out, or a dead address. The judgement is one row per link
 * in the shared learning store (`pipeline_feedback`), so Darwin, Knox and Magellan's own
 * finders and classifier learn from the same record.
 */
export const LINK_YIELD_CHECK = "magellan.link_yield";
/** A link is good once this many distinct fees from it are live (the catalog's own bar). */
export const LINK_GOOD_MIN_LIVE = 3;
/** A link Knox read this long ago with fewer live fees than the bar is thin. */
export const LINK_THIN_AFTER_HOURS = 24;
/** Banks are judged in 24 slots by id, one slot per UTC hour, so each is judged daily. */
export const LINK_YIELD_SLOTS = 24;

export type LinkLabel = "good" | "thin" | "rejected" | "dead";

export interface LinkOutcomeRow {
  institution_id: number | string;
  url: string;
  role: string;
  first_document_id: number | string;
  last_document_id: number | string;
  last_status: string | null;
  last_status_code: number | string | null;
  last_read: string | null;
  last_extract_at: string | Date | null;
  knox_fees: number | string | null;
  live_fees: number | string | null;
  live_categories: string[] | null;
  found_by: string | null;
  found_by_version: number | string | null;
  found_attempt_id: number | string | null;
  current_signal: string | null;
  current_kind: string | null;
  current_weight: number | string | null;
}

export interface LinkJudgement {
  label: LinkLabel;
  signal: "right" | "wrong";
  kind: "produced_live_fees" | "thin_link" | "wrong_document" | "dead_link";
  weight: number;
}

export interface LinkOutcomeResult {
  ready: boolean;
  slot: number;
  links: number;
  judged: Record<LinkLabel, number>;
  undecided: number;
  unchanged: number;
  written: number;
}

const num = (value: number | string | null | undefined) => (value == null ? null : Number(value));

/**
 * Labels one link. Live fees decide first: a link with enough live fees is good however
 * it was fetched. Then a dead address, then a page Rosetta ruled out, then a page Knox
 * read a day ago that still has too few live fees. Anything else (not read yet, read but
 * not extracted, a bot wall) is not judged yet.
 */
export function judgeLink(row: LinkOutcomeRow, now = new Date()): LinkJudgement | null {
  const live = num(row.live_fees) ?? 0;
  if (live >= LINK_GOOD_MIN_LIVE) {
    return { label: "good", signal: "right", kind: "produced_live_fees", weight: live };
  }
  const code = num(row.last_status_code);
  if ((row.last_status === "failed" && (code === 404 || code === 410)) || row.last_read === "http_404") {
    return { label: "dead", signal: "wrong", kind: "dead_link", weight: 1 };
  }
  if (row.last_read === "wrong_document") {
    return { label: "rejected", signal: "wrong", kind: "wrong_document", weight: 1 };
  }
  const extracted = row.last_extract_at ? new Date(row.last_extract_at) : null;
  if (extracted && now.getTime() - extracted.getTime() >= LINK_THIN_AFTER_HOURS * 3_600_000) {
    return { label: "thin", signal: "wrong", kind: "thin_link", weight: 1 };
  }
  return null;
}

export function linkFeedbackRow(row: LinkOutcomeRow, judgement: LinkJudgement, runId: number | null): FeedbackRow {
  const firstDocument = Number(row.first_document_id);
  return {
    aboutStage: "discover",
    aboutStrategy: row.found_by,
    aboutVersion: num(row.found_by_version),
    aboutAttemptId: num(row.found_attempt_id),
    signal: judgement.signal,
    kind: judgement.kind,
    reportedBy: "magellan",
    checkName: LINK_YIELD_CHECK,
    institutionId: Number(row.institution_id),
    sourceDocumentId: firstDocument,
    sourceUrl: row.url,
    weight: judgement.weight,
    evidence: {
      label: judgement.label,
      role: row.role,
      live_fees: num(row.live_fees) ?? 0,
      live_categories: row.live_categories ?? [],
      knox_fees: num(row.knox_fees) ?? 0,
      last_document_id: Number(row.last_document_id),
      last_status: row.last_status,
      last_status_code: num(row.last_status_code),
      last_read: row.last_read,
    },
    runId,
    // Keyed on the link's first document, so re-fetches of the same address re-judge one row.
    dedupeKey: `${LINK_YIELD_CHECK}:doc:${firstDocument}`,
  };
}

/** True when the stored row already says the same thing. */
function unchanged(row: LinkOutcomeRow, judgement: LinkJudgement): boolean {
  return row.current_signal === judgement.signal &&
    row.current_kind === judgement.kind &&
    num(row.current_weight) === judgement.weight;
}

export function linkYieldSlot(now = new Date()): number {
  return now.getUTCHours() % LINK_YIELD_SLOTS;
}

/**
 * Judges the links of one slot of banks (about a 24th of them) and writes changed
 * judgements to `pipeline_feedback`. Reads use the per-bank indexes on documents,
 * attempts and live fees. Never blocks the step it runs in.
 */
export async function recordLinkOutcomes(
  db: SqlTag,
  options: { runId: number | null; stateCode?: string | null; dryRun?: boolean; now?: Date },
): Promise<LinkOutcomeResult> {
  const now = options.now ?? new Date();
  const slot = linkYieldSlot(now);
  const result: LinkOutcomeResult = {
    ready: false,
    slot,
    links: 0,
    judged: { good: 0, thin: 0, rejected: 0, dead: 0 },
    undecided: 0,
    unchanged: 0,
    written: 0,
  };
  try {
    if (!(await feedbackSchemaReady(db))) return result;
    result.ready = true;
    const stateCode = options.stateCode ? options.stateCode.trim().toUpperCase() : null;
    const rows = await inSavepoint(db, (scope) => scope<LinkOutcomeRow[]>`
      WITH banks AS (
        SELECT inst.id, inst.fee_schedule_url
          FROM institution_sources inst
         WHERE COALESCE(inst.status, 'active') = 'active'
           AND inst.id % ${LINK_YIELD_SLOTS} = ${slot}
           AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode})
      ),
      links AS (
        SELECT banks.id AS institution_id, banks.fee_schedule_url AS url, 'main' AS role, NULL::text AS found_by
          FROM banks
         WHERE banks.fee_schedule_url IS NOT NULL AND btrim(banks.fee_schedule_url) <> ''
        UNION
        SELECT extra.institution_id, extra.url, extra.document_role, extra.found_by_strategy
          FROM institution_additional_sources extra
          JOIN banks ON banks.id = extra.institution_id
      ),
      docs AS MATERIALIZED (
        SELECT links.institution_id, links.url, links.role, links.found_by, doc.id AS document_id,
               doc.status, doc.status_code
          FROM links
          JOIN source_documents doc ON doc.institution_id = links.institution_id AND doc.document_url = links.url
      ),
      per_link AS (
        SELECT institution_id, url, role, max(found_by) AS found_by,
               min(document_id) AS first_document_id, max(document_id) AS last_document_id,
               (array_agg(status ORDER BY document_id DESC))[1] AS last_status,
               (array_agg(status_code ORDER BY document_id DESC))[1] AS last_status_code
          FROM docs
         GROUP BY institution_id, url, role
      ),
      reads AS (
        SELECT docs.institution_id, docs.url,
               (array_agg(pa.outcome ORDER BY pa.id DESC) FILTER (WHERE pa.stage = 'read'))[1] AS last_read,
               max(pa.created_at) FILTER (WHERE pa.stage = 'extract') AS last_extract_at
          FROM docs
          JOIN pipeline_attempts pa
            ON pa.institution_id = docs.institution_id
           AND pa.stage IN ('read', 'extract')
           AND pa.source_document_id = docs.document_id
         GROUP BY docs.institution_id, docs.url
      ),
      knox AS (
        SELECT docs.institution_id, docs.url, count(*) AS knox_fees
          FROM docs
          JOIN raw_fee_observations fr ON fr.source_document_id = docs.document_id
         GROUP BY docs.institution_id, docs.url
      ),
      live AS (
        SELECT docs.institution_id, docs.url,
               count(DISTINCT fp.canonical_fee_key) AS live_fees,
               array_agg(DISTINCT fp.canonical_fee_key) AS live_categories
          FROM docs
          JOIN published_fee_records fp ON fp.institution_id = docs.institution_id AND fp.rolled_back_at IS NULL
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id AND fr.source_document_id = docs.document_id
         GROUP BY docs.institution_id, docs.url
      )
      SELECT per_link.institution_id, per_link.url, per_link.role,
             per_link.first_document_id, per_link.last_document_id,
             per_link.last_status, per_link.last_status_code,
             reads.last_read, reads.last_extract_at,
             knox.knox_fees, live.live_fees, live.live_categories,
             COALESCE(per_link.found_by, found.strategy) AS found_by,
             found.strategy_version AS found_by_version,
             found.id AS found_attempt_id,
             current.signal AS current_signal, current.kind AS current_kind, current.weight AS current_weight
        FROM per_link
        LEFT JOIN reads ON reads.institution_id = per_link.institution_id AND reads.url = per_link.url
        LEFT JOIN knox ON knox.institution_id = per_link.institution_id AND knox.url = per_link.url
        LEFT JOIN live ON live.institution_id = per_link.institution_id AND live.url = per_link.url
        LEFT JOIN LATERAL (
          SELECT pa.id, pa.strategy, pa.strategy_version
            FROM pipeline_attempts pa
           WHERE pa.institution_id = per_link.institution_id
             AND pa.stage = 'discover'
             AND pa.outcome = 'ok'
             AND pa.detail->>'url' = per_link.url
           ORDER BY pa.id DESC
           LIMIT 1
        ) found ON TRUE
        LEFT JOIN pipeline_feedback current
          ON current.dedupe_key = ${`${LINK_YIELD_CHECK}:doc:`} || per_link.first_document_id
    `);
    result.links = rows.length;
    const writes: FeedbackRow[] = [];
    for (const row of rows) {
      const judgement = judgeLink(row, now);
      if (!judgement) {
        result.undecided += 1;
        continue;
      }
      result.judged[judgement.label] += 1;
      if (unchanged(row, judgement)) {
        result.unchanged += 1;
        continue;
      }
      writes.push(linkFeedbackRow(row, judgement, options.runId));
    }
    if (!options.dryRun && writes.length > 0) {
      result.written = await inSavepoint(db, (scope) => recordFeedback(scope, writes));
    }
  } catch (error) {
    // Learning must never block the discovery step it runs in.
    console.error("recordLinkOutcomes failed:", error);
  }
  return result;
}
