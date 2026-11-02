import { sql } from "@/lib/data-store/connection";
import { getAutomationControl } from "@/lib/automation-control";
import { startAgentRun } from "@/lib/agents/run-store";
import { DARWIN_RELEASE_STRATEGY } from "./release-held";
import { DARWIN_RELEASE_REVIEW_STRATEGY, RELEASE_REVIEW_FEES_PER_CALL, runDarwinReleaseReview, type ReleaseReviewResult } from "./release-review";

type Db = typeof sql;

/**
 * The one-off release-review sample (James, 2026-11-01, thread "Clear admin home page alerts").
 *
 * Releases are paused (`DARWIN_RELEASE_ACTS = false`, Oct 8), so the paid release review never runs
 * and the fees Darwin's release step marked "review" wait. 497 of the 580 such fees were already
 * reviewed at v17 (Oct 9-11, verdicts only) and 29 passed. This batch reviews the rest, with
 * `acts: false`: each fee gets a `verify.release_review` verdict and nothing is released or changed.
 *
 * Caps: a provider step (`darwin-release-review-sample`, in PROVIDER_STEP_KEYS), so the provider
 * stop and Darwin's own budget line (`agent:darwin`) hold every call. One run at a time, at most
 * SAMPLE_CALLS calls a run and SAMPLE_MAX_RUNS finished runs in all (about $0.10 expected, 15 calls
 * at most). It stops once no unreviewed "review" fee is left.
 */
export const SAMPLE_SOURCE = "darwin.release_review_sample";
export const SAMPLE_STEP_KEY = "darwin-release-review-sample";
export const SAMPLE_BATCH_ID = "2026-11-01";
/** 5 calls of 25 fees cover the ~107 unreviewed verdicts in one run. */
export const SAMPLE_CALLS = 5;
/**
 * Runs after which nothing more is queued, whatever is left. 3 at first; runs 17912 and 17929 (and
 * 17946 if it starts before #2856 deploys) failed before settlement could record a verdict, so one
 * more is allowed. Worst case 4 runs of 5 calls, about $0.40 in all.
 */
export const SAMPLE_MAX_RUNS = 4;

export interface ReleaseReviewSampleSchedule {
  scheduled: boolean;
  runId: number | null;
  /** Why nothing was queued: "active", "done", "capped" or "provider_stop". */
  reason?: string;
}

/** Fees marked "review" by the release step, still held, with no lasting v17 review verdict. */
export async function unreviewedReleaseFees(db: Db = sql): Promise<number> {
  const [row] = await db`
    SELECT count(DISTINCT rel.input_fingerprint)::int AS left
      FROM pipeline_attempts rel
     WHERE rel.stage = 'verify'
       AND rel.strategy = ${DARWIN_RELEASE_STRATEGY.strategy}
       AND rel.strategy_version = ${DARWIN_RELEASE_STRATEGY.version}
       AND rel.detail->>'verdict' = 'review'
       AND rel.detail->>'source_line' IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts done
          WHERE done.input_fingerprint = rel.input_fingerprint
            AND done.strategy = ${DARWIN_RELEASE_REVIEW_STRATEGY.strategy}
            AND done.strategy_version = ${DARWIN_RELEASE_REVIEW_STRATEGY.version}
            AND done.outcome NOT IN ('timeout', 'network_error', 'http_429', 'http_5xx', 'budget_blocked')
       )
       AND NOT EXISTS (
         SELECT 1 FROM verified_fee_observations fv
          WHERE fv.fee_raw_id = substring(rel.input_fingerprint from 5)::bigint
       )
  `;
  return Number(row?.left ?? 0);
}

/**
 * Queues one run of the sample while unreviewed fees are left and fewer than SAMPLE_MAX_RUNS runs
 * have finished, never two at once. Keyed by the ten-minute tick bucket.
 */
export async function scheduleReleaseReviewSample(db: Db = sql, now = new Date()): Promise<ReleaseReviewSampleSchedule> {
  const [active] = await db`
    SELECT id FROM agent_runs
     WHERE params_json->>'source' = ${SAMPLE_SOURCE}
       AND status IN ('queued', 'running', 'cancel_requested')
     ORDER BY id LIMIT 1
  `;
  if (active) return { scheduled: false, runId: Number(active.id), reason: "active" };
  const [finished] = await db`
    SELECT count(*)::int AS runs FROM agent_runs
     WHERE params_json->>'source' = ${SAMPLE_SOURCE}
  `;
  if (Number(finished?.runs ?? 0) >= SAMPLE_MAX_RUNS) return { scheduled: false, runId: null, reason: "capped" };
  if ((await unreviewedReleaseFees(db)) === 0) return { scheduled: false, runId: null, reason: "done" };
  if (!(await getAutomationControl()).enabled) return { scheduled: false, runId: null, reason: "provider_stop" };
  const bucket = Math.floor(now.getTime() / 600_000);
  const started = await startAgentRun({
    agent: "darwin",
    kind: "workflow",
    title: `Darwin: release-review sample ${SAMPLE_BATCH_ID} (verdicts only, nothing released)`,
    params: { source: SAMPLE_SOURCE, batch_id: SAMPLE_BATCH_ID },
    triggeredBy: SAMPLE_SOURCE,
    triggerSource: "schedule",
    idempotencyKey: `darwin:release-review-sample:${SAMPLE_BATCH_ID}:${bucket}`,
    steps: [{ key: SAMPLE_STEP_KEY, agent: "darwin" as const, title: "Review the held fees the release step marked for review, without releasing any" }],
  });
  return { scheduled: !started.reused, runId: started.run.id };
}

/** The step: one capped review with `acts: false`. A dry run lists what it would review. */
export async function runReleaseReviewSample(options: { runId: number; stepId?: number | null; dryRun?: boolean; db?: Db }): Promise<ReleaseReviewResult> {
  return runDarwinReleaseReview({ ...options, calls: SAMPLE_CALLS, acts: false });
}

export function releaseReviewSampleSummary(result: ReleaseReviewResult): string {
  if (result.dryRun) return `Would review ${result.selected} held fees (up to ${SAMPLE_CALLS * RELEASE_REVIEW_FEES_PER_CALL}), releasing none.`;
  if (result.budgetStopped && result.processed === 0) return `Release-review sample skipped: ${result.budgetReason ?? "budget cap"}.`;
  return `Release-review sample: ${result.passed} of ${result.succeeded} reviewed fees passed, ${result.failed} failed, ${result.deferred ?? 0} deferred, none released; $${(result.costMicrousd / 1_000_000).toFixed(2)} over ${result.calls} calls.`;
}
