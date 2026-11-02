import type { sql } from "@/lib/data-store/connection";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";

type SqlTag = typeof sql;

/**
 * Knox's re-read backlog (Pipeline wiring audit, Nov 2, gap 10): rule changes rarely reached old texts.
 *
 * Knox re-reads a current copy only when one of its triggers asks (thin text, $10B+ bank, missing
 * fees, older copy still live, a read below KNOX_STALE_READ_BELOW_VERSION, priority bank), and the
 * extract step's order puts priority banks, the v97 floor and large banks first. Each rules bump
 * (v137 to v155 in the week to Nov 2) re-queued those same texts, so a text read at v97-v154 was
 * never reached unless it tripped a trigger. On prod (read-only, Nov 2), 14,939 of 15,000 current
 * texts were last read below v155; 7,146 of them stand behind live fees, 1,490 of those because an
 * older copy of the page still carries the live fees. On Nov 1, 782 of 2,060 reads repeated a read
 * made at v140 or later.
 *
 * The backlog reserves a few slots of every extract step for current texts last read below today's
 * rules version: texts behind live fees first (fees on the text's own document or on an older copy
 * of its page), then the oldest rules version first. Reading the current copy is what moves a live
 * fee off a superseded copy: its rows go to Darwin, and the normal verify, publish and newer-copy
 * checks take it from there. A read only adds rows (the raw dedupe index keeps existing ones), and
 * the step's own limit bounds it: backlog rows replace the tail of the step's usual batch, so the
 * step reads no more texts than before and the tick's price for an extract step (run-store
 * STEP_EXPECTED_MS) still holds. Rules only: no provider call, so it never waits on provider budget.
 *
 * The same pass reports current documents behind live fees that nothing has checked in
 * KNOX_REREAD_REFETCH_DAYS; Magellan's live-source refetch takes them as refetch requests when the
 * switch is on (`selectStaleLiveSources`, `refetchRequestDays`).
 */

/**
 * The switch. Off (the default), each extract step counts the backlog and reports what it would
 * queue (`reread_backlog` in the step detail), and Magellan's live-source refetch selects as before.
 * On, the extract step reads the backlog's rows and the refetch takes the requests. On can move live
 * fees (new reads reach Darwin and publish), so it waits for James's yes on the dry run.
 */
export const KNOX_REREAD_BACKLOG_LIVE = false;
/**
 * Backlog slots per extract step, taken out of the step's own limit (25 by default, 50 on state
 * lanes). Extract steps averaged 29 reads at about 0.3 s each over Oct 30-Nov 1, with 74 steps a day;
 * 10 slots are at most 740 backlog reads a day while leaving most of each batch to first reads and
 * the other triggers.
 */
export const KNOX_REREAD_BACKLOG_PER_STEP = 10;
/** A current document behind live fees that nothing checked in this many days is a refetch request. */
export const KNOX_REREAD_REFETCH_DAYS = 90;

export interface RereadBacklogRow {
  document_text_id: number | string;
  source_document_id: number | string;
  institution_id: number | string;
  source_url: string | null;
  normalized_text: string;
  text_hash: string | null;
  document_kind?: string | null;
  institution_name?: string | null;
  format?: string | null;
  best_strategy?: unknown;
  strategy_stats?: unknown;
  do_not_retry?: unknown;
  expected_fee_count?: number | string | null;
  /** Live fees on this text's document plus on older copies of its page. */
  backlog_live_fees: number | string;
  /** Of them, on older copies. */
  backlog_older_copy_fees: number | string;
  /** The newest rules version that read this text; null when none has. */
  backlog_read_version: number | string | null;
  /** Window totals over the whole (scoped) backlog. */
  backlog_due: number | string;
  backlog_due_behind_live: number | string;
  backlog_due_older_copy: number | string;
  backlog_refetch_due: number | string;
}

export interface RereadBacklogReport {
  live: boolean;
  /** Current texts in scope last read below today's rules version (or never). */
  due: number;
  /** Of them, behind live fees. */
  dueBehindLive: number;
  /** Of them, current copies whose older copy carries live fees. */
  dueOlderCopy: number;
  /** Current documents behind live fees not checked in KNOX_REREAD_REFETCH_DAYS (refetch requests). */
  refetchDue: number;
  /** Backlog rows this step would read (switch off) or reads (switch on). */
  queued: number;
  /** Rows the step actually read from the backlog (0 while off). */
  read: number;
  /** The oldest rules version among the queued rows; null when none was read before. */
  oldestQueuedVersion: number | null;
  perStep: number;
}

export function emptyRereadBacklogReport(live: boolean = KNOX_REREAD_BACKLOG_LIVE): RereadBacklogReport {
  return { live, due: 0, dueBehindLive: 0, dueOlderCopy: 0, refetchDue: 0, queued: 0, read: 0, oldestQueuedVersion: null, perStep: KNOX_REREAD_BACKLOG_PER_STEP };
}

/**
 * The backlog query: current texts (not superseded) last read below today's rules version, one per
 * text fingerprint per institution (the twin with the most live fees), behind-live first, then the
 * oldest version, then the most live fees. Window columns carry the scoped totals, so one query both
 * picks the rows and counts the backlog. Live fees are read once into CTEs: a per-row lookup of older
 * copies took 12.7 s on prod, the CTEs 1.4 s (Nov 2, unscoped).
 */
export function rereadBacklogQuery(options: {
  limit: number;
  institutionId?: number;
  stateCode?: string;
}): { query: string; params: Array<number | string> } {
  const params: Array<number | string> = [];
  const limitParam = `$${params.push(Math.max(0, Math.floor(options.limit)))}`;
  const strategyParam = `$${params.push(KNOX_RULES_STRATEGY.strategy)}`;
  const versionParam = `$${params.push(KNOX_RULES_STRATEGY.version)}`;
  const refetchParam = `$${params.push(KNOX_REREAD_REFETCH_DAYS)}`;
  const scope: string[] = [];
  const docScope: string[] = [];
  if (options.institutionId) {
    const institutionParam = `$${params.push(options.institutionId)}`;
    scope.push(`AND adt.institution_id = ${institutionParam}`);
    docScope.push(`AND doc.institution_id = ${institutionParam}`);
  }
  const state = normalizeStateCode(options.stateCode);
  if (state) {
    const stateParam = `$${params.push(state)}`;
    scope.push(`AND upper(btrim(inst.state_code)) = ${stateParam}`);
    docScope.push(`AND upper(btrim(inst.state_code)) = ${stateParam}`);
  }
  const query = `
    WITH live_doc AS MATERIALIZED (
      SELECT fr.source_document_id AS doc_id, count(*)::int AS live_fees
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fr.source_document_id IS NOT NULL
       GROUP BY fr.source_document_id
    ), older_live AS MATERIALIZED (
      SELECT older_copy.superseded_by_id AS doc_id, sum(live.live_fees)::int AS live_fees
        FROM live_doc live
        JOIN source_documents older_copy ON older_copy.id = live.doc_id
       WHERE older_copy.superseded_by_id IS NOT NULL
       GROUP BY older_copy.superseded_by_id
    ), refetch AS (
      SELECT count(*)::int AS due
        FROM live_doc live
        JOIN source_documents doc ON doc.id = live.doc_id AND doc.superseded_by_id IS NULL
        JOIN institution_sources inst ON inst.id = doc.institution_id
       WHERE COALESCE(doc.last_checked_at, doc.crawled_at) < NOW() - make_interval(days => ${refetchParam}::int)
         AND COALESCE(inst.status, 'active') = 'active'
         ${docScope.join("\n         ")}
    ), candidate AS (
      SELECT DISTINCT ON (adt.institution_id, adt.text_hash)
             adt.id AS document_text_id,
             adt.source_document_id,
             adt.institution_id,
             adt.source_url,
             adt.normalized_text,
             adt.text_hash,
             adt.document_kind,
             inst.institution_name,
             profile.format,
             profile.best_strategy,
             profile.strategy_stats,
             profile.do_not_retry,
             profile.expected_fee_count,
             COALESCE(own.live_fees, 0) + COALESCE(older.live_fees, 0) AS backlog_live_fees,
             COALESCE(older.live_fees, 0) AS backlog_older_copy_fees,
             last_read.version AS backlog_read_version
        FROM agent_source_texts adt
        JOIN institution_sources inst ON inst.id = adt.institution_id
        JOIN source_documents doc ON doc.id = adt.source_document_id AND doc.superseded_by_id IS NULL
        LEFT JOIN institution_source_profiles profile ON profile.institution_id = adt.institution_id
        LEFT JOIN live_doc own ON own.doc_id = adt.source_document_id
        LEFT JOIN older_live older ON older.doc_id = adt.source_document_id
        LEFT JOIN LATERAL (
          SELECT max(pa.strategy_version) AS version
            FROM pipeline_attempts pa
           WHERE pa.stage = 'extract'
             AND pa.strategy = ${strategyParam}
             AND pa.institution_id = adt.institution_id
             AND pa.input_fingerprint = adt.text_hash
        ) last_read ON TRUE
       WHERE adt.status = 'completed'
         AND adt.normalized_text IS NOT NULL
         AND adt.char_count > 0
         AND adt.text_hash IS NOT NULL
         AND COALESCE(last_read.version, 0) < ${versionParam}
         ${scope.join("\n         ")}
       ORDER BY adt.institution_id, adt.text_hash,
                COALESCE(own.live_fees, 0) + COALESCE(older.live_fees, 0) DESC, adt.id DESC
    )
    SELECT candidate.*,
           count(*) OVER () AS backlog_due,
           count(*) FILTER (WHERE candidate.backlog_live_fees > 0) OVER () AS backlog_due_behind_live,
           count(*) FILTER (WHERE candidate.backlog_older_copy_fees > 0) OVER () AS backlog_due_older_copy,
           (SELECT due FROM refetch) AS backlog_refetch_due
      FROM candidate
     ORDER BY (candidate.backlog_live_fees > 0) DESC,
              candidate.backlog_read_version ASC NULLS FIRST,
              candidate.backlog_live_fees DESC,
              candidate.document_text_id ASC
     LIMIT ${limitParam}
  `;
  return { query, params };
}

/** Postgres returns no window row for an empty backlog; the refetch count is then read alone. */
async function refetchDueOnly(db: SqlTag, options: { institutionId?: number; stateCode?: string }): Promise<number> {
  const state = normalizeStateCode(options.stateCode) ?? null;
  const rows = await db<Array<{ due: number | string }>>`
    WITH live_doc AS (
      SELECT DISTINCT fr.source_document_id AS doc_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL AND fr.source_document_id IS NOT NULL
    )
    SELECT count(*)::int AS due
      FROM live_doc live
      JOIN source_documents doc ON doc.id = live.doc_id AND doc.superseded_by_id IS NULL
      JOIN institution_sources inst ON inst.id = doc.institution_id
     WHERE COALESCE(doc.last_checked_at, doc.crawled_at) < NOW() - make_interval(days => ${KNOX_REREAD_REFETCH_DAYS}::int)
       AND COALESCE(inst.status, 'active') = 'active'
       AND (${options.institutionId ?? null}::bigint IS NULL OR doc.institution_id = ${options.institutionId ?? null}::bigint)
       AND (${state}::text IS NULL OR upper(btrim(inst.state_code)) = ${state}::text)
  `;
  return Number(rows[0]?.due ?? 0);
}

/**
 * Picks this step's backlog rows (at most `perStep`) and counts the scoped backlog. Read-only.
 * Off, the rows are only counted; the caller reads them only when the report says `live`.
 */
export async function planRereadBacklog(
  db: SqlTag,
  options: { perStep?: number; institutionId?: number; stateCode?: string; live?: boolean },
): Promise<{ rows: RereadBacklogRow[]; report: RereadBacklogReport }> {
  const live = options.live ?? KNOX_REREAD_BACKLOG_LIVE;
  const perStep = Math.max(0, Math.floor(options.perStep ?? KNOX_REREAD_BACKLOG_PER_STEP));
  const report = { ...emptyRereadBacklogReport(live), perStep };
  // One row is enough to read the window totals when nothing is queued.
  const { query, params } = rereadBacklogQuery({ limit: Math.max(perStep, 1), institutionId: options.institutionId, stateCode: options.stateCode });
  const found = await db.unsafe<RereadBacklogRow[]>(query, params);
  const first = found[0];
  if (first) {
    report.due = Number(first.backlog_due ?? 0);
    report.dueBehindLive = Number(first.backlog_due_behind_live ?? 0);
    report.dueOlderCopy = Number(first.backlog_due_older_copy ?? 0);
    report.refetchDue = Number(first.backlog_refetch_due ?? 0);
  } else {
    report.refetchDue = await refetchDueOnly(db, options);
  }
  const rows = found.slice(0, perStep);
  report.queued = rows.length;
  const versions = rows.map((row) => row.backlog_read_version).filter((value) => value != null).map(Number);
  report.oldestQueuedVersion = rows.some((row) => row.backlog_read_version == null) || versions.length === 0
    ? null
    : Math.min(...versions);
  return { rows, report };
}

/**
 * Pure: this step's batch with the backlog in it. Backlog rows go first and the usual batch fills
 * what is left of `limit`; a text already in the backlog (same document text, or the same text at
 * the same institution) is not read twice. Off, the usual batch is returned unchanged.
 */
export function mergeRereadBacklog<T extends { document_text_id: number | string; institution_id: number | string; text_hash: string | null }>(
  usual: readonly T[],
  backlog: readonly T[],
  limit: number,
  live: boolean,
): { rows: T[]; fromBacklog: number } {
  if (!live || backlog.length === 0) return { rows: [...usual], fromBacklog: 0 };
  const seenIds = new Set<number>();
  const seenTexts = new Set<string>();
  const rows: T[] = [];
  const take = (row: T) => {
    const id = Number(row.document_text_id);
    const text = row.text_hash ? `${Number(row.institution_id)}:${row.text_hash}` : null;
    if (seenIds.has(id) || (text && seenTexts.has(text))) return false;
    seenIds.add(id);
    if (text) seenTexts.add(text);
    rows.push(row);
    return true;
  };
  let fromBacklog = 0;
  for (const row of backlog) {
    if (rows.length >= limit) break;
    if (take(row)) fromBacklog += 1;
  }
  for (const row of usual) {
    if (rows.length >= limit) break;
    take(row);
  }
  return { rows, fromBacklog };
}

/** One line for the step summary. */
export function rereadBacklogSummary(report: RereadBacklogReport): string {
  const head = `Re-read backlog (${report.live ? "live" : "off, counted only"}): ${report.due.toLocaleString()} current texts last read below rules v${KNOX_RULES_STRATEGY.version}, ${report.dueBehindLive.toLocaleString()} behind live fees (${report.dueOlderCopy.toLocaleString()} whose older copy carries them)`;
  const step = report.live
    ? `; read ${report.read} this step (at most ${report.perStep})`
    : `; would read ${report.queued} this step (at most ${report.perStep})`;
  return `${head}${step}; ${report.refetchDue.toLocaleString()} documents behind live fees unchecked ${KNOX_REREAD_REFETCH_DAYS}+ days${report.live ? " requested for refetch" : " would be requested for refetch"}.`;
}
