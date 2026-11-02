import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
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
 * never reached unless it tripped a trigger. On prod (read-only, Nov 2), 14,104 current text
 * fingerprints (one per text per bank) were last read below v155; 7,103 of them stand behind live
 * fees, 1,468 of those because an older copy of the page still carries the live fees. On Nov 1, 782
 * of 2,060 reads repeated a read made at v140 or later.
 *
 * The backlog gives every extract step a few slots for current texts last read below today's
 * rules version: texts behind live fees first (fees on the text's own document or on an older copy
 * of its page), then the oldest rules version first. Reading the current copy is what moves a live
 * fee off a superseded copy: its rows go to Darwin, and the normal verify, publish and newer-copy
 * checks take it from there. A read only adds rows (the raw dedupe index keeps existing ones).
 * Rules only: no provider call, so it never waits on provider budget.
 *
 * The same query counts current documents behind live fees that nothing has checked in
 * KNOX_REREAD_REFETCH_DAYS. With the switch on, Magellan's live-source refetch also selects their
 * pages (`selectStaleLiveSources`, `refetchRequestDays`), under its own exclusions and retry waits.
 */

/**
 * The switch. Off (the default), state-lane extract steps count the backlog and report what they
 * would read (`reread_backlog` in the step detail), and Magellan's live-source refetch selects as
 * before. On, the extract step reads the backlog's rows and the refetch takes the 90-day pages. On
 * can move live fees (new reads reach Darwin and publish), so it waits for James's yes on the dry run.
 */
export const KNOX_REREAD_BACKLOG_LIVE = false;
/**
 * Slots the backlog may take from a step's usual batch. Never more than the usual rows above
 * `limit - KNOX_REREAD_BACKLOG_PER_STEP`, and none of them when the limit is this or less (a one-bank
 * run with a small limit keeps every row it asked for and gets only its spare slots).
 */
export const KNOX_REREAD_BACKLOG_PER_STEP = 10;
/**
 * Most backlog rows a step reads, its spare slots included. State-lane extract steps (317 in the
 * week to Nov 1, under one a day per state) read 29.2 texts on average against a limit of 50, so
 * 20 slots usually come out of spare room: at about 0.3 s a read (mean 299 ms, p95 916 ms), up to 10
 * spare reads add about 3 s to a mean step. At 20 a lane step, Texas (526 behind-live texts, 0.86
 * lane steps a day) clears its behind-live share in about 31 days and its whole backlog in about 60.
 */
export const KNOX_REREAD_BACKLOG_MAX_PER_STEP = 20;
/** A current document behind live fees that nothing checked in this many days is counted (and, on, refetched). */
export const KNOX_REREAD_REFETCH_DAYS = 90;
/**
 * The planner's own statement timeout, set inside its savepoint. The planner took 0.55 s for Texas,
 * the largest lane, and 1.4 s unscoped on prod (Nov 2).
 */
export const KNOX_REREAD_BACKLOG_TIMEOUT_MS = 5_000;

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

/** Why the backlog was not counted this step. */
export type RereadBacklogNotCounted =
  /** No attempt log or current-copy columns (or a dry run): there is no rules version to compare. */
  | "no_schema"
  /** Switch off and a one-bank run: the count runs on state lanes only, to keep its cost off repairs. */
  | "off_one_bank"
  /** The planner query failed or timed out; it was rolled back to its savepoint. */
  | "failed";

export interface RereadBacklogReport {
  live: boolean;
  /** False when nothing was counted; every count below is then null (unknown), never 0. */
  counted: boolean;
  notCounted: RereadBacklogNotCounted | null;
  /** Current text fingerprints in scope last read below today's rules version (or never). */
  due: number | null;
  /** Of them, behind live fees. */
  dueBehindLive: number | null;
  /** Of them, current copies whose older copy carries live fees. */
  dueOlderCopy: number | null;
  /** Current documents behind live fees, at active banks, not checked in KNOX_REREAD_REFETCH_DAYS. */
  documentsUnchecked90: number | null;
  /** Backlog slots this step had (`rereadBacklogSlots`). */
  slots: number;
  /** Backlog rows this step would read (switch off) or picked (switch on). */
  queued: number | null;
  /** Rows the step actually read from the backlog (0 while off). */
  read: number;
  /** The oldest rules version among the queued rows; null when none is queued or one was never read. */
  oldestQueuedVersion: number | null;
  /** A queued row was never read by any rules version. */
  queuedNeverRead: boolean;
}

export function notCountedRereadBacklog(reason: RereadBacklogNotCounted, live: boolean = KNOX_REREAD_BACKLOG_LIVE): RereadBacklogReport {
  return {
    live, counted: false, notCounted: reason, due: null, dueBehindLive: null, dueOlderCopy: null, documentsUnchecked90: null,
    slots: 0, queued: null, read: 0, oldestQueuedVersion: null, queuedNeverRead: false,
  };
}

/**
 * Pure: the backlog's slots in a step whose usual selection returned `usualCount` rows of `limit`.
 * The usual batch keeps at least `limit - KNOX_REREAD_BACKLOG_PER_STEP` rows (all of them when the
 * limit is KNOX_REREAD_BACKLOG_PER_STEP or less); the backlog takes the rest, up to
 * KNOX_REREAD_BACKLOG_MAX_PER_STEP. So a step never reads more than its limit.
 */
export function rereadBacklogSlots(limit: number, usualCount: number): number {
  const bounded = Math.max(0, Math.floor(limit));
  const usual = Math.max(0, Math.min(Math.floor(usualCount), bounded));
  const usualKeep = bounded <= KNOX_REREAD_BACKLOG_PER_STEP ? usual : Math.min(usual, bounded - KNOX_REREAD_BACKLOG_PER_STEP);
  return Math.max(0, Math.min(KNOX_REREAD_BACKLOG_MAX_PER_STEP, bounded - usualKeep));
}

/**
 * Runs a read inside a savepoint with its own statement timeout. A failed or cancelled statement in
 * the run-ledger transaction would abort the whole step; the savepoint rolls back only this read
 * (the timeout with it). After a successful read the previous timeout is put back, since a
 * transaction-local setting survives RELEASE SAVEPOINT (the `darwin/document-owner.ts` pattern).
 * Returns `{ ok: false }` on any error. Outside a transaction (or with a test double) the read runs
 * directly, and the timeout is set only when there is a transaction to scope it.
 */
export async function boundedRead<T>(
  db: SqlTag,
  timeoutMs: number,
  work: (scope: SqlTag) => Promise<T>,
  label: string,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const inTransaction = typeof (db as unknown as { savepoint?: unknown }).savepoint === "function";
  try {
    const value = await inSavepoint(db, async (scope) => {
      if (!inTransaction) return work(scope);
      const [prior] = await scope<Array<{ value: string | null }>>`
        SELECT current_setting('statement_timeout') AS value,
               set_config('statement_timeout', ${`${Math.max(1, Math.floor(timeoutMs))}ms`}, true) AS applied
      `;
      const result = await work(scope);
      if (prior?.value != null) await scope`SELECT set_config('statement_timeout', ${prior.value}, true)`;
      return result;
    });
    return { ok: true, value };
  } catch (error) {
    console.error(`${label} failed:`, error instanceof Error ? error.message : error);
    return { ok: false, error };
  }
}

function scopeSql(params: Array<number | string>, options: { institutionId?: number; stateCode?: string }, column: string, inst: string): string {
  const clauses: string[] = [];
  if (options.institutionId) clauses.push(`AND ${column} = $${params.push(options.institutionId)}`);
  const state = normalizeStateCode(options.stateCode);
  if (state) clauses.push(`AND upper(btrim(${inst}.state_code)) = $${params.push(state)}`);
  return clauses.join("\n         ");
}

/**
 * The backlog query: current texts (not superseded) last read below today's rules version, one per
 * text fingerprint per institution (the twin with the most live fees), behind-live first, then the
 * oldest version, then the most live fees. Window columns carry the scoped totals, so one query both
 * picks the rows and counts the backlog. Live fees are read once into CTEs, scoped to the lane: a
 * per-row lookup of older copies took 12.7 s on prod, the CTEs 1.4 s unscoped and 0.55 s for Texas.
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
  const liveScope = scopeSql(params, options, "fp.institution_id", "live_inst");
  const docScope = scopeSql(params, options, "doc.institution_id", "inst");
  const textScope = scopeSql(params, options, "adt.institution_id", "inst");
  const query = `
    WITH live_doc AS MATERIALIZED (
      SELECT fr.source_document_id AS doc_id, count(*)::int AS live_fees
        FROM published_fee_records fp
        JOIN institution_sources live_inst ON live_inst.id = fp.institution_id
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fr.source_document_id IS NOT NULL
         ${liveScope}
       GROUP BY fr.source_document_id
    ), older_live AS MATERIALIZED (
      SELECT older_copy.superseded_by_id AS doc_id, sum(live.live_fees)::int AS live_fees
        FROM live_doc live
        JOIN source_documents older_copy ON older_copy.id = live.doc_id
       WHERE older_copy.superseded_by_id IS NOT NULL
       GROUP BY older_copy.superseded_by_id
    ), unchecked AS (
      SELECT count(*)::int AS documents
        FROM live_doc live
        JOIN source_documents doc ON doc.id = live.doc_id AND doc.superseded_by_id IS NULL
        JOIN institution_sources inst ON inst.id = doc.institution_id
       WHERE COALESCE(doc.last_checked_at, doc.crawled_at) < NOW() - make_interval(days => ${refetchParam}::int)
         AND COALESCE(inst.status, 'active') = 'active'
         ${docScope}
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
         ${textScope}
       ORDER BY adt.institution_id, adt.text_hash,
                COALESCE(own.live_fees, 0) + COALESCE(older.live_fees, 0) DESC, adt.id DESC
    ), totals AS (
      SELECT count(*) AS backlog_due,
             count(*) FILTER (WHERE candidate.backlog_live_fees > 0) AS backlog_due_behind_live,
             count(*) FILTER (WHERE candidate.backlog_older_copy_fees > 0) AS backlog_due_older_copy
        FROM candidate
    ), picked AS (
      SELECT candidate.*
        FROM candidate
       ORDER BY (candidate.backlog_live_fees > 0) DESC,
                candidate.backlog_read_version ASC NULLS FIRST,
                candidate.backlog_live_fees DESC,
                candidate.document_text_id ASC
       LIMIT ${limitParam}
    )
    -- The totals row always comes back, so an empty backlog still reports its counts (0, known).
    SELECT picked.*, totals.backlog_due, totals.backlog_due_behind_live, totals.backlog_due_older_copy,
           unchecked.documents AS backlog_refetch_due
      FROM totals
      CROSS JOIN unchecked
      LEFT JOIN picked ON TRUE
     ORDER BY (picked.backlog_live_fees > 0) DESC NULLS LAST,
              picked.backlog_read_version ASC NULLS FIRST,
              picked.backlog_live_fees DESC,
              picked.document_text_id ASC
  `;
  return { query, params };
}

/**
 * Picks this step's backlog rows (at most `slots`) and counts the scoped backlog, inside a savepoint
 * with its own timeout (`boundedRead`). Read-only. On failure the report says `failed` and every
 * count is null; the step goes on with its usual batch.
 */
export async function planRereadBacklog(
  db: SqlTag,
  options: { slots: number; institutionId?: number; stateCode?: string; live?: boolean; timeoutMs?: number },
): Promise<{ rows: RereadBacklogRow[]; report: RereadBacklogReport }> {
  const live = options.live ?? KNOX_REREAD_BACKLOG_LIVE;
  const slots = Math.max(0, Math.floor(options.slots));
  const { query, params } = rereadBacklogQuery({ limit: slots, institutionId: options.institutionId, stateCode: options.stateCode });
  const read = await boundedRead(db, options.timeoutMs ?? KNOX_REREAD_BACKLOG_TIMEOUT_MS,
    (scope) => scope.unsafe<RereadBacklogRow[]>(query, params), "Knox re-read backlog");
  if (!read.ok) return { rows: [], report: { ...notCountedRereadBacklog("failed", live), slots } };
  const found = Array.isArray(read.value) ? read.value : [];
  const totals = found[0];
  if (!totals) return { rows: [], report: { ...notCountedRereadBacklog("failed", live), slots } };
  const rows = found.filter((row) => row.document_text_id != null).slice(0, slots);
  const versions = rows.map((row) => row.backlog_read_version).filter((value) => value != null).map(Number);
  const queuedNeverRead = rows.some((row) => row.backlog_read_version == null);
  return {
    rows,
    report: {
      live,
      counted: true,
      notCounted: null,
      due: Number(totals.backlog_due ?? 0),
      dueBehindLive: Number(totals.backlog_due_behind_live ?? 0),
      dueOlderCopy: Number(totals.backlog_due_older_copy ?? 0),
      documentsUnchecked90: Number(totals.backlog_refetch_due ?? 0),
      slots,
      queued: rows.length,
      read: 0,
      oldestQueuedVersion: versions.length > 0 ? Math.min(...versions) : null,
      queuedNeverRead,
    },
  };
}

/**
 * Pure: this step's batch with the backlog in it. Backlog rows go first and the usual batch fills
 * what is left of `limit`; a text already in the backlog (same document text, or the same text at
 * the same institution) is not read twice. The caller passes at most `rereadBacklogSlots` backlog
 * rows, so the usual batch keeps its share. Off, the usual batch is returned unchanged.
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

/**
 * One sentence for the step summary, or null when there is nothing to say (a one-bank run with the
 * switch off, or no schema). A failed count says so; it never prints an unknown as 0.
 */
export function rereadBacklogSummary(report: RereadBacklogReport): string | null {
  if (!report.counted) {
    return report.notCounted === "failed"
      ? `Re-read backlog (${report.live ? "live" : "off"}): not counted this step (the count failed or timed out and was rolled back; the usual batch was read).`
      : null;
  }
  const oldest = report.queued
    ? report.queuedNeverRead
      ? "; the oldest queued was never read"
      : report.oldestQueuedVersion != null ? `; the oldest queued was last read at v${report.oldestQueuedVersion}` : ""
    : "";
  const step = report.live
    ? `read ${report.read} this step (${report.slots} slots)`
    : `would read ${report.queued} this step (${report.slots} slots)`;
  return `Re-read backlog (${report.live ? "live" : "off, counted only"}): ${report.due?.toLocaleString()} current texts last read below rules v${KNOX_RULES_STRATEGY.version}, ${report.dueBehindLive?.toLocaleString()} behind live fees (${report.dueOlderCopy?.toLocaleString()} whose older copy carries them); ${step}${oldest}. ${report.documentsUnchecked90?.toLocaleString()} documents behind live fees have not been checked in ${KNOX_REREAD_REFETCH_DAYS}+ days.`;
}
