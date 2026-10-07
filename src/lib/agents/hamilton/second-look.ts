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
  options: { check: string; runId: number; failing: T[]; passing?: number[]; dryRun: boolean; now?: Date },
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
  const plan = planSecondLook(failing, pending, runId, now);
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
    ...plan.flagged.map((fee) => ({
      ...base(fee),
      signal: "wrong" as const,
      kind: PENDING_KIND,
      weight: 0,
      evidence: { flag_run_id: runId, flagged_at: now.toISOString(), reason: fee.reason },
    })),
    ...plan.confirmed.map(({ candidate, first }) => ({
      ...base(candidate),
      signal: "wrong" as const,
      kind: CONFIRMED_KIND,
      weight: 0,
      evidence: {
        flag_run_id: first.flagRunId,
        flagged_at: first.flaggedAt?.toISOString() ?? null,
        reason: first.reason,
        confirm_run_id: runId,
        confirmed_at: now.toISOString(),
        confirm_reason: candidate.reason,
      },
    })),
    ...cleared.map((id) => {
      const first = pending.get(id)!;
      return {
        aboutStage: "publish" as const,
        aboutStrategy: check,
        reportedBy: "hamilton" as const,
        checkName: check,
        feePublishedId: id,
        runId,
        dedupeKey: secondLookDedupeKey(check, id),
        signal: "right" as const,
        kind: CLEARED_KIND,
        weight: 1,
        evidence: {
          flag_run_id: first.flagRunId,
          flagged_at: first.flaggedAt?.toISOString() ?? null,
          reason: first.reason,
          cleared_run_id: runId,
          cleared_at: now.toISOString(),
        },
      };
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
