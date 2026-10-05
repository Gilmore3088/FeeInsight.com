import { sql, withTransaction } from "@/lib/data-store/connection";
import { startAgentRun, type StartAgentRunResult } from "@/lib/agents/run-store";
import type {
  AgentRunStepDefinition,
  AgentRunTriggerSource,
} from "@/lib/agents/types";
import { normalizeStateCode, syncStateLaneProfiles } from "./state-lane-memory";
import { KNOX_EXTRACT_STRATEGY, KNOX_REEXTRACT_MAX_FEES } from "./knox/extract";
import { REREAD_MAX_KNOX_FEES, ROSETTA_READ_VERSION } from "./rosetta/read";
import { DARWIN_VERIFY_MAX_LIMIT, DARWIN_VERIFY_STRATEGY } from "./darwin/verify";

/**
 * Documents a lane reads and extracts per run. Twice the agents' default, so a state's
 * re-read backlog drains in fewer runs. Each document is re-read at most once per
 * reader version, so a bigger batch does not download any document more often.
 */
export const STATE_LANE_DOCUMENT_BATCH = 50;
/**
 * Cadence. Each state gets one full pass a month (the state expert refreshes its memory,
 * Magellan discovers and fetches, every later step runs). The first full pass of each
 * calendar quarter is a re-check (`recheck: 'quarterly'` in the run params): discovery
 * re-validates every link and re-searches dead and needs-human banks. Between full
 * passes, a lane runs hourly catch-up passes only while the state has free work left
 * (documents to re-read or re-extract, raw rows Darwin has not decided); otherwise it
 * sleeps until next month. Windows are UTC calendar months and quarters.
 *
 * While a state still has a free-work backlog, its lane runs again this soon.
 */
export const STATE_LANE_BACKLOG_RETRY_MINUTES = 60;

export type StateLaneRecheck = "quarterly";

export const STATE_LANE_STEPS: AgentRunStepDefinition[] = [
  {
    key: "enhance",
    agent: "atlas",
    title: "Refresh state source memory and lane health",
  },
  {
    key: "state-expert",
    agent: "atlas",
    title: "State expert: refresh the state's memory (regulator, platforms, strategies, peer levels)",
  },
  {
    key: "discover",
    agent: "magellan",
    title: "Find and verify missing fee schedule URLs",
  },
  {
    key: "discover-paid",
    agent: "magellan",
    title: "Paid last pass: find fee schedules the free finders missed",
  },
  {
    key: "fetch",
    agent: "magellan",
    title: "Fetch state source documents",
  },
  {
    key: "read",
    agent: "rosetta",
    title: "Read PDFs, HTML, and queued OCR candidates",
    input: { read_limit: STATE_LANE_DOCUMENT_BATCH },
  },
  {
    key: "read-paid",
    agent: "rosetta",
    title: "Paid last pass: read scans and pages the free readers could not",
  },
  {
    key: "extract",
    agent: "knox",
    title: "Extract fee observations from normalized source text",
    input: { extract_limit: STATE_LANE_DOCUMENT_BATCH },
  },
  {
    key: "extract-paid",
    agent: "knox",
    title: "Paid last pass: extract fees the rules missed in dense documents",
  },
  {
    key: "classify",
    agent: "darwin",
    title: "Verify state raw fee observations",
    // Darwin's per-step maximum. At the default 100 a lane cleared about 75 fees per pass
    // while Knox re-extraction queued thousands an hour (2026-10-05: 16,471 waiting).
    // A 500-row pass takes seconds and lanes still run one at a time.
    input: { verify_limit: DARWIN_VERIFY_MAX_LIMIT },
  },
  {
    key: "publish",
    agent: "hamilton",
    title: "Publish verified state fee intelligence",
  },
  {
    key: "public-discovery",
    agent: "magellan",
    title: "Inventory and check state public discovery pages",
    input: { public_discovery_limit: 20 },
  },
  {
    key: "public-cluster",
    agent: "darwin",
    title: "Cluster state public discovery findings",
  },
  {
    key: "public-diagnose",
    agent: "hamilton",
    title: "Summarize state public discovery diagnosis",
  },
];

/**
 * Steps an hourly backlog run takes: re-read, re-extract, verify and publish the
 * documents the state already has. Magellan's discover, fetch and public-discovery
 * steps stay on the state's full crawl cadence, so backlog runs never search or
 * crawl bank websites. A re-read downloads a document that is not in the vault once
 * per reader version; Knox, Darwin and Hamilton work from stored rows only.
 */
export const STATE_LANE_BACKLOG_STEP_KEYS = ["read", "extract", "classify", "publish"] as const;
export const STATE_LANE_BACKLOG_STEPS: AgentRunStepDefinition[] = STATE_LANE_STEPS.filter((step) =>
  (STATE_LANE_BACKLOG_STEP_KEYS as readonly string[]).includes(step.key),
);

export type StateLaneMode = "full" | "backlog";

export interface StateLaneStartInput {
  stateCode: string;
  triggeredBy: string;
  triggerSource?: AgentRunTriggerSource;
  source?: "atlas.state_lane_scheduler" | "admin.state_lane";
  limit?: number;
  /** Admin runs only: ask for a quarterly re-check pass. The scheduler decides its own. */
  recheck?: StateLaneRecheck | null;
  /** The scheduler's cadence check, when it already made one. */
  cadence?: StateLaneCadence;
}

export interface StateLaneStartResult extends StartAgentRunResult {
  stateCode: string;
  idempotencyKey: string;
  mode: StateLaneMode;
  recheck: StateLaneRecheck | null;
}

export interface DueStateLaneScheduleResult {
  selected: number;
  scheduled: number;
  reused: number;
  /** Lanes with no full pass due and no backlog: put to sleep until next month. */
  idle: number;
  failed: Array<{ stateCode: string; error: string }>;
  results: Array<{
    stateCode: string;
    runId: number;
    status: string;
    reused: boolean;
    idempotencyKey: string;
  }>;
}

/** Hourly window: one catch-up run per state per hour at most. */
export function hourWindowKey(date = new Date()): string {
  return date.toISOString().slice(0, 13);
}

/** Monthly window (UTC) for the full pass. */
export function monthWindowKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/** Quarterly window (UTC) for the re-check pass, e.g. `2026-Q4`. */
export function quarterWindowKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** Start of the next UTC calendar month: when an idle lane's next full pass is due. */
export function nextMonthStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/**
 * Idempotency key for a lane run. Keys only dedupe runs that are still active, so the
 * window just has to cover one run: a full pass per state per month, a re-check per
 * quarter, a catch-up pass per hour.
 */
export function laneIdempotencyKey(
  stateCode: string,
  mode: StateLaneMode,
  recheck: StateLaneRecheck | null,
  date = new Date(),
): string {
  if (mode === "backlog") return `atlas:state-lane-backlog:${stateCode}:${hourWindowKey(date)}`;
  if (recheck === "quarterly") return `atlas:state-lane-recheck:${stateCode}:${quarterWindowKey(date)}`;
  return `atlas:state-lane:${stateCode}:${monthWindowKey(date)}`;
}

function boundedLaneLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(Math.max(Math.floor(parsed), 1), 10);
}

function isMissingStateLaneSchemaError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("agent_state_lanes") ||
    message.includes("institution_source_profiles") ||
    message.includes("does not exist") ||
    message.includes("undefined_table");
}

/**
 * True when the state has completed texts Rosetta has not re-read with the current
 * reader, or Knox has not extracted with the current rules, that are still thin (the
 * same tests the read and extract steps select on). False when the attempt log is
 * missing, so a lane never loops on a schema it cannot check.
 */
export async function stateHasDocumentBacklog(stateCode: string): Promise<boolean> {
  try {
    const [row] = await sql<{ backlog: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
          FROM agent_source_texts adt
          JOIN institution_sources inst ON inst.id = adt.institution_id
         WHERE adt.status = 'completed'
           AND adt.char_count > 0
           AND upper(btrim(inst.state_code)) = ${stateCode}
           AND (
             (
               (SELECT COUNT(*) FROM raw_fee_observations fr
                 WHERE fr.source = 'knox'
                   AND fr.source_document_id = adt.source_document_id) < ${KNOX_REEXTRACT_MAX_FEES}
               AND NOT EXISTS (
                 SELECT 1 FROM pipeline_attempts pa
                  WHERE pa.stage = 'extract'
                    AND pa.institution_id = adt.institution_id
                    AND pa.input_fingerprint = adt.text_hash
                    AND pa.strategy = ${KNOX_EXTRACT_STRATEGY.strategy}
                    AND pa.strategy_version = ${KNOX_EXTRACT_STRATEGY.version}
               )
             )
             OR (
               (SELECT COUNT(*) FROM raw_fee_observations fr
                 WHERE fr.source = 'knox'
                   AND fr.source_document_id = adt.source_document_id
                   AND fr.outlier_flags ? 'needs_darwin_verification') < ${REREAD_MAX_KNOX_FEES}
               AND NOT EXISTS (
                 SELECT 1 FROM pipeline_attempts pa
                  WHERE pa.stage = 'read'
                    AND pa.institution_id = adt.institution_id
                    AND pa.input_fingerprint = adt.source_hash
                    AND pa.strategy_version >= ${ROSETTA_READ_VERSION}
               )
             )
           )
      ) OR EXISTS (
        -- Raw rows Darwin has not decided under the current rules (the rows its
        -- verify step selects), so a large extraction drains hourly, not next month.
        SELECT 1
          FROM raw_fee_observations fr
          JOIN institution_sources inst ON inst.id = fr.institution_id
         WHERE fr.source = 'knox'
           AND fr.outlier_flags ? 'needs_darwin_verification'
           AND upper(btrim(inst.state_code)) = ${stateCode}
           AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
                AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
                AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
           )
      ) AS backlog
    `;
    return Boolean(row?.backlog);
  } catch (error) {
    console.error("stateHasDocumentBacklog failed:", error);
    return false;
  }
}

export interface StateLaneCadence {
  /** No full pass started (and not failed) this UTC calendar month. */
  fullDue: boolean;
  /** No quarterly re-check pass started (and not failed) this UTC calendar quarter. */
  recheckDue: boolean;
}

/**
 * Which passes a state is due. A full pass that is queued, running or completed this
 * month counts; a failed or cancelled one does not, so the lane tries again. When the
 * check fails the lane takes a full pass (no re-check), the safe default.
 */
export async function stateLaneCadence(stateCode: string): Promise<StateLaneCadence> {
  try {
    const [row] = await sql<{ full_this_month: boolean; recheck_this_quarter: boolean }[]>`
      SELECT
        EXISTS (
          SELECT 1 FROM public.agent_runs run
           WHERE run.run_kind = 'workflow_lane'
             AND upper(btrim(run.state_code)) = ${stateCode}
             AND COALESCE(run.params_json->>'lane_mode', 'full') = 'full'
             AND run.status IN ('queued', 'running', 'cancel_requested', 'completed')
             AND run.started_at >= date_trunc('month', NOW(), 'UTC')
        ) AS full_this_month,
        EXISTS (
          SELECT 1 FROM public.agent_runs run
           WHERE run.run_kind = 'workflow_lane'
             AND upper(btrim(run.state_code)) = ${stateCode}
             AND COALESCE(run.params_json->>'lane_mode', 'full') = 'full'
             AND run.params_json->>'recheck' = 'quarterly'
             AND run.status IN ('queued', 'running', 'cancel_requested', 'completed')
             AND run.started_at >= date_trunc('quarter', NOW(), 'UTC')
        ) AS recheck_this_quarter
    `;
    return {
      fullDue: !row?.full_this_month,
      recheckDue: !row?.recheck_this_quarter,
    };
  } catch (error) {
    console.error("stateLaneCadence failed:", error);
    return { fullDue: true, recheckDue: false };
  }
}

async function markLaneScheduled(stateCode: string, runId: number, backlog: boolean): Promise<void> {
  await sql`
    UPDATE public.agent_state_lanes
       SET last_agent_run_id = ${runId},
           last_run_at = NOW(),
           next_run_after = CASE
             WHEN ${backlog} THEN NOW() + ${STATE_LANE_BACKLOG_RETRY_MINUTES} * INTERVAL '1 minute'
             ELSE ${nextMonthStart().toISOString()}::timestamptz
           END,
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE state_code = ${stateCode}
  `;
}

/** Nothing due and no backlog: the lane sleeps until next month's full pass. */
async function markLaneIdle(stateCode: string): Promise<void> {
  await sql`
    UPDATE public.agent_state_lanes
       SET next_run_after = ${nextMonthStart().toISOString()}::timestamptz,
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE state_code = ${stateCode}
  `;
}

async function markLaneLaunchBlocked(stateCode: string, runId: number): Promise<void> {
  await sql`
    UPDATE public.agent_state_lanes
       SET last_agent_run_id = ${runId},
           next_run_after = NOW() + INTERVAL '30 minutes',
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE state_code = ${stateCode}
  `;
}

async function markLaneScheduleFailure(stateCode: string): Promise<void> {
  await sql`
    UPDATE public.agent_state_lanes
       SET failure_count = failure_count + 1,
           next_run_after = NOW() + INTERVAL '1 hour',
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE state_code = ${stateCode}
  `;
}

export async function startStateLaneRun(
  input: StateLaneStartInput,
): Promise<StateLaneStartResult> {
  const stateCode = normalizeStateCode(input.stateCode);
  if (!stateCode) throw new Error("Invalid state code for state lane run");

  await syncStateLaneProfiles(sql, stateCode);
  // Only the scheduler starts backlog runs; a run an admin starts always crawls.
  const source = input.source ?? "atlas.state_lane_scheduler";
  const scheduled = source === "atlas.state_lane_scheduler";
  const cadence = scheduled ? input.cadence ?? (await stateLaneCadence(stateCode)) : null;
  const mode: StateLaneMode = cadence && !cadence.fullDue ? "backlog" : "full";
  const recheck: StateLaneRecheck | null = mode !== "full"
    ? null
    : cadence
      ? (cadence.recheckDue ? "quarterly" : null)
      : (input.recheck === "quarterly" ? "quarterly" : null);
  const idempotencyKey = laneIdempotencyKey(stateCode, mode, recheck);
  const parsedLimit = Number(input.limit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), 500)
    : undefined;
  const result = await startAgentRun({
    agent: "atlas",
    kind: "workflow_lane",
    title: mode === "backlog"
      ? `Atlas ${stateCode} state lane backlog pass`
      : recheck
        ? `Atlas ${stateCode} state lane (quarterly re-check)`
        : `Atlas ${stateCode} state lane`,
    stateCode,
    params: {
      scope: "state",
      state_code: stateCode,
      limit,
      source,
      lane_mode: mode,
      ...(recheck ? { recheck } : {}),
    },
    triggeredBy: input.triggeredBy,
    triggerSource: input.triggerSource ?? "schedule",
    idempotencyKey,
    steps: mode === "backlog" ? STATE_LANE_BACKLOG_STEPS : STATE_LANE_STEPS,
    summary: mode === "backlog"
      ? `Atlas backlog pass accepted for ${stateCode}: re-read, re-extract, verify and publish stored documents only. Discovery and fetch wait for the next full lane run.`
      : `Atlas state lane accepted for ${stateCode}${recheck ? " as the quarterly re-check: discovery re-validates every link and re-searches dead and needs-human banks" : ""}. All worker selectors are scoped to institution_sources.state_code.`,
  });
  if (result.run.status === "blocked") {
    await markLaneLaunchBlocked(stateCode, result.run.id);
  } else {
    await markLaneScheduled(stateCode, result.run.id, await stateHasDocumentBacklog(stateCode));
  }
  return { ...result, stateCode, idempotencyKey, mode, recheck };
}

export async function scheduleDueStateLaneRuns({
  limit = 2,
  triggeredBy = "atlas.scheduler",
}: {
  limit?: number;
  triggeredBy?: string;
} = {}): Promise<DueStateLaneScheduleResult> {
  const safeLimit = boundedLaneLimit(limit);
  await syncStateLaneProfiles(sql);

  let dueRows: Array<{ state_code: string }>;
  try {
    dueRows = await withTransaction(async (tx) => tx<{ state_code: string }[]>`
      WITH due AS (
        SELECT state_code
          FROM public.agent_state_lanes
         WHERE next_run_after <= NOW()
           AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
           -- One run per state at a time: a backlog lane waits for its previous run.
           AND NOT EXISTS (
             SELECT 1 FROM public.agent_runs active
              WHERE active.id = agent_state_lanes.last_agent_run_id
                AND active.status IN ('queued', 'running', 'cancel_requested')
           )
         ORDER BY priority_score DESC, next_run_after ASC, state_code ASC
         LIMIT ${safeLimit}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE public.agent_state_lanes lane
         SET lease_token = gen_random_uuid(),
             lease_expires_at = NOW() + INTERVAL '15 minutes',
             updated_at = NOW()
        FROM due
       WHERE lane.state_code = due.state_code
      RETURNING lane.state_code
    `);
  } catch (error) {
    if (isMissingStateLaneSchemaError(error)) {
      return {
        selected: 0,
        scheduled: 0,
        reused: 0,
        idle: 0,
        failed: [],
        results: [],
      };
    }
    throw error;
  }

  const output: DueStateLaneScheduleResult = {
    selected: dueRows.length,
    scheduled: 0,
    reused: 0,
    idle: 0,
    failed: [],
    results: [],
  };

  for (const row of dueRows) {
    const stateCode = String(row.state_code);
    try {
      const cadence = await stateLaneCadence(stateCode);
      if (!cadence.fullDue && !(await stateHasDocumentBacklog(stateCode))) {
        await markLaneIdle(stateCode);
        output.idle += 1;
        continue;
      }
      const result = await startStateLaneRun({
        stateCode,
        triggeredBy,
        triggerSource: "schedule",
        source: "atlas.state_lane_scheduler",
        cadence,
      });
      output.scheduled += 1;
      if (result.reused) output.reused += 1;
      output.results.push({
        stateCode,
        runId: result.run.id,
        status: result.run.status,
        reused: result.reused,
        idempotencyKey: result.idempotencyKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.failed.push({ stateCode, error: message });
      await markLaneScheduleFailure(stateCode);
    }
  }

  return output;
}
