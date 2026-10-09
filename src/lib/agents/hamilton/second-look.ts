import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";

type SqlTag = typeof sql;

/**
 * A takedown is a last resort (James, Oct 7): a live fee that fails a Hamilton check is
 * not taken down the first time. The first failure is logged as `takedown_pending` in the
 * shared learning store (`pipeline_feedback`); the fee is taken down only when the same
 * check fails it again on a later run, at least SECOND_LOOK_MIN_MINUTES later, so a fresh
 * read of the page or a fixed rule can clear it first. A fee that passes after a first
 * failure is logged `takedown_cleared`. Every decision stays in the log; nothing is deleted.
 */
// 12 hours: of 1,345 source-check takedowns later restored (Oct 6-7), 453 came back within an
// hour and 1,311 within 12 hours, mostly as same-day reader fixes landed.
export const SECOND_LOOK_MIN_MINUTES = 12 * 60;
export const PENDING_KIND = "takedown_pending";
export const CONFIRMED_KIND = "takedown_confirmed";
export const CLEARED_KIND = "takedown_cleared";
/**
 * The log's audit trail (UAT, Oct 9 2026). The row at `secondLookDedupeKey` carries a fee's
 * current state (pending, confirmed, cleared), because every reader of "is this fee under a
 * pending takedown" (reports, outreach, alerts, the lane scheduler, Knox's lessons) tests
 * `kind = 'takedown_pending'` / `'takedown_confirmed'` on it. Each state change also appends
 * one row keyed by the run, which is never rewritten: a first look (`flag_recorded`), its clear
 * (`flag_cleared`) or its confirmation (`flag_confirmed`), each naming the first look's run,
 * time and reason. History is appended, never overwritten.
 */
export const FLAG_RECORDED_KIND = "flag_recorded";
export const FLAG_CLEARED_KIND = "flag_cleared";
export const FLAG_CONFIRMED_KIND = "flag_confirmed";

export interface SecondLookCandidate {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey?: string | null;
  amount?: number | null;
  sourceDocumentId?: number | null;
  reason: string;
}

export interface PendingFlag {
  feePublishedId: number;
  kind: string;
  flagRunId: number | null;
  flaggedAt: Date | null;
  reason: string | null;
}

export interface SecondLookPlan<T extends SecondLookCandidate> {
  /** Failed on an earlier run too: take down now. */
  confirmed: Array<{ candidate: T; first: PendingFlag }>;
  /** First failure (or the first look is too recent): log, keep live. */
  flagged: T[];
  /** Pending and still waiting for their second look. */
  waiting: T[];
}

export function secondLookDedupeKey(check: string, feePublishedId: number): string {
  return `hamilton.second_look:${check}:pub:${feePublishedId}`;
}

/** The key of one appended audit row: the state row's key, the event and the run that wrote it. */
export function secondLookEventKey(check: string, feePublishedId: number, event: "flag" | "cleared" | "confirmed", runId: number | null): string {
  return `${secondLookDedupeKey(check, feePublishedId)}:${event}:${runId ?? "unknown"}`;
}

/**
 * Pure: which failing fees are confirmed by a second look. A pending flag confirms only
 * when it came from another run, at least `minMinutes` before `now`.
 */
export function planSecondLook<T extends SecondLookCandidate>(
  failing: T[],
  pending: Map<number, PendingFlag>,
  runId: number,
  now: Date,
  minMinutes = SECOND_LOOK_MIN_MINUTES,
): SecondLookPlan<T> {
  const plan: SecondLookPlan<T> = { confirmed: [], flagged: [], waiting: [] };
  for (const candidate of failing) {
    const flag = pending.get(candidate.feePublishedId);
    if (!flag || flag.kind !== PENDING_KIND || !flag.flaggedAt) {
      plan.flagged.push(candidate);
      continue;
    }
    const ageMinutes = (now.getTime() - flag.flaggedAt.getTime()) / 60_000;
    if (flag.flagRunId !== runId && ageMinutes >= minMinutes) plan.confirmed.push({ candidate, first: flag });
    else plan.waiting.push(candidate);
  }
  return plan;
}

export interface SecondLookResult<T extends SecondLookCandidate> {
  confirmed: T[];
  flagged: number;
  waiting: number;
  cleared: number;
}

interface FlagRow {
  fee_published_id: number | string;
  kind: string;
  evidence: { flag_run_id?: number | string | null; flagged_at?: string | null; reason?: string | null } | null;
}

/**
 * Runs the second look for one check. `failing` are the fees the check would take down
 * this run; `passing` are fees it checked and passed (clears their pending flags). Returns
 * only the fees to take down now. A dry run reads the log and writes nothing. If the log
 * cannot be read, nothing is taken down.
 */
export async function secondLook<T extends SecondLookCandidate>(
  db: SqlTag,
  options: {
    check: string;
    runId: number;
    failing: T[];
    passing?: number[];
    dryRun: boolean;
    now?: Date;
    /** Minutes a first look must age before it confirms; Infinity logs first looks and confirms none. */
    minMinutes?: number;
  },
): Promise<SecondLookResult<T>> {
  const { check, runId, failing, dryRun } = options;
  const passing = options.passing ?? [];
  const empty: SecondLookResult<T> = { confirmed: [], flagged: 0, waiting: 0, cleared: 0 };
  if (failing.length === 0 && passing.length === 0) return empty;
  const keys = failing.map((fee) => secondLookDedupeKey(check, fee.feePublishedId));
  let rows: FlagRow[];
  try {
    if (!(await feedbackSchemaReady(db))) return { ...empty, waiting: failing.length };
    rows = await inSavepoint(db, (scope) => scope<FlagRow[]>`
      SELECT fee_published_id, kind, evidence
        FROM pipeline_feedback
       WHERE dedupe_key = ANY(${keys}::text[])
          OR (check_name = ${check} AND kind = ${PENDING_KIND} AND fee_published_id = ANY(${passing}::bigint[]))
    `);
  } catch (error) {
    // No log, no takedown: a fee is never taken down without its first look on record.
    console.error(`secondLook(${check}) read failed:`, error);
    return { ...empty, waiting: failing.length };
  }
  const pending = new Map<number, PendingFlag>(
    rows.map((row) => [
      Number(row.fee_published_id),
      {
        feePublishedId: Number(row.fee_published_id),
        kind: row.kind,
        flagRunId: row.evidence?.flag_run_id == null ? null : Number(row.evidence.flag_run_id),
        flaggedAt: row.evidence?.flagged_at ? new Date(row.evidence.flagged_at) : null,
        reason: row.evidence?.reason ?? null,
      },
    ]),
  );
  const now = options.now ?? new Date();
  const plan = planSecondLook(failing, pending, runId, now, options.minMinutes ?? SECOND_LOOK_MIN_MINUTES);
  const failingIds = new Set(failing.map((fee) => fee.feePublishedId));
  const cleared = passing.filter((id) => !failingIds.has(id) && pending.get(id)?.kind === PENDING_KIND);
  const result: SecondLookResult<T> = {
    confirmed: plan.confirmed.map((entry) => entry.candidate),
    flagged: plan.flagged.length,
    waiting: plan.waiting.length,
    cleared: cleared.length,
  };
  if (dryRun) return result;

  const base = (fee: SecondLookCandidate): Omit<FeedbackRow, "signal" | "kind" | "weight" | "evidence"> => ({
    aboutStage: "publish",
    aboutStrategy: check,
    reportedBy: "hamilton",
    checkName: check,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId ?? null,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey ?? null,
    amount: fee.amount ?? null,
    runId,
    dedupeKey: secondLookDedupeKey(check, fee.feePublishedId),
  });
  const writes: FeedbackRow[] = [
    // A first look is a suspicion, not proof: weight 0 keeps it out of learned counts.
    ...plan.flagged.flatMap((fee) => {
      const evidence = { flag_run_id: runId, flagged_at: now.toISOString(), reason: fee.reason };
      return [
        { ...base(fee), signal: "wrong" as const, kind: PENDING_KIND, weight: 0, evidence },
        // The audit row: never rewritten when the state row changes.
        { ...base(fee), signal: "wrong" as const, kind: FLAG_RECORDED_KIND, weight: 0, evidence, dedupeKey: secondLookEventKey(check, fee.feePublishedId, "flag", runId) },
      ];
    }),
    ...plan.confirmed.flatMap(({ candidate, first }) => {
      const evidence = {
        flag_run_id: first.flagRunId,
        flagged_at: first.flaggedAt?.toISOString() ?? null,
        reason: first.reason,
        confirm_run_id: runId,
        confirmed_at: now.toISOString(),
        confirm_reason: candidate.reason,
        flag_key: secondLookEventKey(check, candidate.feePublishedId, "flag", first.flagRunId),
      };
      return [
        { ...base(candidate), signal: "wrong" as const, kind: CONFIRMED_KIND, weight: 0, evidence },
        { ...base(candidate), signal: "wrong" as const, kind: FLAG_CONFIRMED_KIND, weight: 0, evidence, dedupeKey: secondLookEventKey(check, candidate.feePublishedId, "confirmed", runId) },
      ];
    }),
    ...cleared.flatMap((id) => {
      const first = pending.get(id)!;
      const row = {
        aboutStage: "publish" as const,
        aboutStrategy: check,
        reportedBy: "hamilton" as const,
        checkName: check,
        feePublishedId: id,
        runId,
        evidence: {
          flag_run_id: first.flagRunId,
          flagged_at: first.flaggedAt?.toISOString() ?? null,
          reason: first.reason,
          original_kind: PENDING_KIND,
          cleared_run_id: runId,
          cleared_at: now.toISOString(),
          flag_key: secondLookEventKey(check, id, "flag", first.flagRunId),
        },
      };
      return [
        // The state row: the fee is no longer under a pending takedown. Weight 1 counts the clear once.
        { ...row, dedupeKey: secondLookDedupeKey(check, id), signal: "right" as const, kind: CLEARED_KIND, weight: 1 },
        { ...row, dedupeKey: secondLookEventKey(check, id, "cleared", runId), signal: "right" as const, kind: FLAG_CLEARED_KIND, weight: 0 },
      ];
    }),
  ];
  try {
    await inSavepoint(db, (scope) => recordFeedback(scope as SqlTag, writes));
  } catch (error) {
    // The log is the precondition for a takedown; without it, take nothing down.
    console.error(`secondLook(${check}) write failed:`, error);
    return { ...result, confirmed: [] };
  }
  return result;
}

interface LegacyClearedRow {
  dedupe_key: string;
  fee_published_id: number | string;
  institution_id: number | string | null;
  source_document_id: number | string | null;
  canonical_fee_key: string | null;
  amount: number | string | null;
  evidence: { flag_run_id?: number | string | null; flagged_at?: string | null; reason?: string | null; cleared_run_id?: number | string | null; cleared_at?: string | null } | null;
}

/**
 * Writes the audit row a clear made before this trail existed: a state row now `takedown_cleared`
 * whose first look (`flag_recorded`) is missing gets one, rebuilt from the evidence the clear kept
 * (the first look's run, time and reason), marked reconstructed and naming why it was cleared.
 * Idempotent: a fee with its first look on record is skipped. Returns the rows written. A dry run
 * counts and writes nothing. UAT, Oct 9 2026: the eval verdict v5 clear rewrote 378 first looks.
 */
export async function reconstructFirstLooks(
  db: SqlTag,
  options: { check: string; runId: number; clearedWhy: string; dryRun: boolean; now?: Date },
): Promise<number> {
  const { check } = options;
  let rows: LegacyClearedRow[];
  try {
    if (!(await feedbackSchemaReady(db))) return 0;
    rows = await inSavepoint(db, (scope) => scope<LegacyClearedRow[]>`
      SELECT s.dedupe_key, s.fee_published_id, s.institution_id, s.source_document_id, s.canonical_fee_key, s.amount, s.evidence
        FROM pipeline_feedback s
       WHERE s.check_name = ${check}
         AND s.kind = ${CLEARED_KIND}
         AND s.dedupe_key = ${`hamilton.second_look:${check}:pub:`} || s.fee_published_id::text
         AND NOT EXISTS (
               SELECT 1 FROM pipeline_feedback a
                WHERE a.check_name = ${check}
                  AND a.kind = ${FLAG_RECORDED_KIND}
                  AND a.fee_published_id = s.fee_published_id
                  AND COALESCE(a.evidence->>'flag_run_id', 'unknown') = COALESCE(s.evidence->>'flag_run_id', 'unknown'))
       ORDER BY s.fee_published_id
       LIMIT 2000
    `);
  } catch (error) {
    console.error(`reconstructFirstLooks(${check}) read failed:`, error);
    return 0;
  }
  if (rows.length === 0 || options.dryRun) return rows.length;
  const now = (options.now ?? new Date()).toISOString();
  const writes: FeedbackRow[] = rows.map((row) => {
    const feePublishedId = Number(row.fee_published_id);
    const flagRunId = row.evidence?.flag_run_id == null ? null : Number(row.evidence.flag_run_id);
    return {
      aboutStage: "publish",
      aboutStrategy: check,
      reportedBy: "hamilton",
      checkName: check,
      institutionId: row.institution_id == null ? null : Number(row.institution_id),
      sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
      feePublishedId,
      canonicalFeeKey: row.canonical_fee_key,
      amount: row.amount == null ? null : Number(row.amount),
      runId: options.runId,
      dedupeKey: secondLookEventKey(check, feePublishedId, "flag", flagRunId),
      signal: "wrong",
      kind: FLAG_RECORDED_KIND,
      weight: 0,
      evidence: {
        flag_run_id: flagRunId,
        flagged_at: row.evidence?.flagged_at ?? null,
        reason: row.evidence?.reason ?? null,
        original_kind: PENDING_KIND,
        reconstructed_at: now,
        reconstructed_from: row.dedupe_key,
        cleared_run_id: row.evidence?.cleared_run_id == null ? null : Number(row.evidence.cleared_run_id),
        cleared_at: row.evidence?.cleared_at ?? null,
        cleared_why: options.clearedWhy,
      },
    };
  });
  try {
    await inSavepoint(db, (scope) => recordFeedback(scope as SqlTag, writes));
  } catch (error) {
    console.error(`reconstructFirstLooks(${check}) write failed:`, error);
    return 0;
  }
  return writes.length;
}
