/**
 * Durable Hamilton report runs (#1921, V5 item O1).
 *
 * A Pro report makes several paid calls (one per section, plus redrafts) inside one server
 * action that a deploy, a timeout or a closed tab can cut short. This module makes that work
 * replay-safe using the existing run ledger, with no new table:
 *
 * - One run per report request (`agent_runs`, run_kind `pro_request`, stage `pro.report`),
 *   keyed by `idempotency_key` = `hamilton-report:<hash of the reader and the request>`.
 *   The ledger's unique index on active keys means a request has at most one live run.
 * - One step per section, plus a save step (`agent_run_steps`). A finished section is
 *   saved on its step (`output_payload`) with a hash of the exact input it was written
 *   from. A replay reuses it only when the input hash matches, so a section is never
 *   written (or charged) twice for the same input.
 * - A lease (`lease_token`, `lease_until` in the run's params) means only one request works
 *   on a run at a time. A second request while the lease is live is told the report is still
 *   being written; one after it lapses (the first was cut off) takes the run over and
 *   resumes from the saved sections.
 * - The report's id is chosen when the run opens, and the save inserts that id once
 *   (`ON CONFLICT DO NOTHING`), so a replay after the save cannot save a second copy.
 *   The report row is written only after every section passed its checks, so a half-written
 *   report is never listed. The run is marked completed only after the save.
 * - A failed run (a section that failed under the retry policy) ends `failed` with the fault.
 *   A new request for the same report within an hour carries its finished sections over, so
 *   a retry pays only for what did not finish.
 *
 * pro_request runs are never picked up by the tick or the stale-step reaper (run-store.ts),
 * so a run in progress here is touched only by the reader's own requests.
 *
 * If the ledger cannot be written, `openReportRun` returns `unavailable` and the report is
 * written as before this change (no checkpoints), so a ledger outage never blocks a report.
 */

import { createHash, randomUUID } from "node:crypto";
import { sql } from "@/lib/data-store/connection";
import type { HamiltonFault } from "./task-faults";

type SqlTag = typeof sql;

/** Longer than the report page's maxDuration (300s), so a live request is never taken over. */
export const REPORT_RUN_LEASE_MS = 330_000;
/** A failed run's finished sections are carried into a new run for this long. */
export const REPORT_RUN_CARRY_MINUTES = 60;
/** A run left running this long was never resumed: it is closed as failed. */
export const REPORT_RUN_ABANDONED_HOURS = 24;

export const REPORT_RUN_STAGE = "pro.report";
export const REPORT_SAVE_STEP = "pro.report.save";

export function reportSectionStepKey(index: number): string {
  return `pro.report.section.${index + 1}`;
}

/** Stable JSON: object keys sorted, so the same request always hashes the same. */
export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The run's idempotency key: the reader and everything the request asked for. */
export function reportTaskKey(userId: number, params: unknown): string {
  return `hamilton-report:${sha256(stableJson({ userId, params })).slice(0, 40)}`;
}

/** What a section was written from. A saved section is reused only for the same hash. */
export function sectionInputHash(input: unknown): string {
  return sha256(stableJson(input));
}

/** A finished section as saved on its step. Only JSON: no functions. */
export interface ReportSectionCheckpoint<TOutput = unknown> {
  inputHash: string;
  output: TOutput;
  /** Usage of the calls that produced it (all drafts), for the report's usage record. */
  providerResponses: Array<{ usage: unknown; model: string }>;
  /** The run it was first written in, when carried over. */
  writtenInRun?: number;
}

export interface ReportRunHandle {
  runId: number;
  leaseToken: string;
  reportId: string;
  taskKey: string;
  stepIds: Map<string, number>;
  checkpoints: Map<string, ReportSectionCheckpoint>;
  resumed: boolean;
  carriedFromRun: number | null;
}

export type ReportRunOpen =
  | { kind: "opened" | "resumed"; run: ReportRunHandle }
  | { kind: "busy"; runId: number }
  | { kind: "already_saved"; run: ReportRunHandle }
  | { kind: "unavailable"; reason: string };

export class ReportRunLeaseLostError extends Error {
  constructor(runId: number) {
    super(`Report run ${runId} was taken over by another request; this one stopped without saving.`);
    this.name = "ReportRunLeaseLostError";
  }
}

export const REPORT_RUN_BUSY_MESSAGE =
  "This report is still being written from an earlier request. It will be in your reports when it is done; check again in a few minutes.";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseParams(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readCheckpoint(value: unknown): ReportSectionCheckpoint | null {
  const payload = parseParams(value);
  if (typeof payload.inputHash !== "string" || !("output" in payload)) return null;
  return {
    inputHash: payload.inputHash,
    output: payload.output,
    providerResponses: Array.isArray(payload.providerResponses) ? (payload.providerResponses as ReportSectionCheckpoint["providerResponses"]) : [],
    ...(typeof payload.writtenInRun === "number" ? { writtenInRun: payload.writtenInRun } : {}),
  };
}

async function loadSteps(db: SqlTag, runId: number): Promise<{ stepIds: Map<string, number>; checkpoints: Map<string, ReportSectionCheckpoint> }> {
  const rows = await db`
    SELECT id, step_key, status, output_payload FROM agent_run_steps
     WHERE agent_run_id = ${runId} ORDER BY sequence ASC, id ASC
  `;
  const stepIds = new Map<string, number>();
  const checkpoints = new Map<string, ReportSectionCheckpoint>();
  for (const row of rows) {
    const key = String(row.step_key);
    stepIds.set(key, Number(row.id));
    if (row.status === "completed" && key !== REPORT_SAVE_STEP) {
      const checkpoint = readCheckpoint(row.output_payload);
      if (checkpoint) checkpoints.set(key, checkpoint);
    }
  }
  return { stepIds, checkpoints };
}

async function event(db: SqlTag, runId: number, stepId: number | null, type: string, status: string, message: string, detail: Record<string, unknown>): Promise<void> {
  await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${runId}, ${stepId}, ${type}, ${status}, ${message}, ${JSON.stringify(detail)}::jsonb)
  `;
}

/** Close this reader's report runs nobody resumed for a day, so none sits "running" forever. Best effort. */
async function closeAbandonedRuns(db: SqlTag, userId: number): Promise<void> {
  const message = `Report run was interrupted and not resumed within ${REPORT_RUN_ABANDONED_HOURS} hours; no report was saved from it.`;
  const closed = await db`
    UPDATE agent_runs
       SET status = 'failed', error_summary = ${message}, summary = ${message}, completed_at = NOW(), updated_at = NOW()
     WHERE run_kind = 'pro_request' AND current_stage = ${REPORT_RUN_STAGE} AND status = 'running'
       AND triggered_by = ${`user:${userId}`}
       AND updated_at < NOW() - make_interval(hours => ${REPORT_RUN_ABANDONED_HOURS})
     RETURNING id
  `;
  for (const row of closed) await event(db, Number(row.id), null, "run.failed", "failed", message, { abandoned: true });
}

/** Copy a recent failed run's finished sections into the new run, so a retry pays only for the rest. */
async function carryFromFailedRun(db: SqlTag, run: ReportRunHandle): Promise<void> {
  const [failed] = await db`
    SELECT id FROM agent_runs
     WHERE idempotency_key = ${run.taskKey} AND status = 'failed' AND id <> ${run.runId}
       AND updated_at >= NOW() - make_interval(mins => ${REPORT_RUN_CARRY_MINUTES})
     ORDER BY updated_at DESC, id DESC LIMIT 1
  `;
  if (!failed) return;
  const fromRun = Number(failed.id);
  const { checkpoints } = await loadSteps(db, fromRun);
  for (const [key, checkpoint] of checkpoints) {
    const stepId = run.stepIds.get(key);
    if (!stepId) continue;
    const carried: ReportSectionCheckpoint = { ...checkpoint, writtenInRun: checkpoint.writtenInRun ?? fromRun };
    await db`
      UPDATE agent_run_steps
         SET status = 'completed', output_payload = ${JSON.stringify(carried)}::jsonb,
             summary = ${`Carried over from run ${fromRun}: already written for the same input.`},
             started_at = NOW(), completed_at = NOW(), updated_at = NOW()
       WHERE id = ${stepId}
    `;
    await event(db, run.runId, stepId, "section.carried", "completed", `Section carried over from run ${fromRun}.`, { from_run: fromRun, step_key: key });
    run.checkpoints.set(key, carried);
  }
  if (run.checkpoints.size > 0) run.carriedFromRun = fromRun;
}

export interface OpenReportRunInput {
  userId: number;
  institutionId: number | string | null;
  title: string;
  taskKey: string;
  sectionTitles: string[];
  detail?: Record<string, unknown>;
  now?: Date;
  db?: SqlTag;
}

/**
 * Open the report's run, or take over its unfinished one. Never throws: a ledger error returns
 * `unavailable`, and the caller writes the report without checkpoints, as before.
 */
export async function openReportRun(input: OpenReportRunInput): Promise<ReportRunOpen> {
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const leaseToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + REPORT_RUN_LEASE_MS).toISOString();
  try {
    await closeAbandonedRuns(db, input.userId).catch((error) => console.error("[report-run] abandoned-run sweep failed", errorText(error)));
    const reportId = randomUUID();
    const params = {
      operation: "report",
      user_id: input.userId,
      institution_id: input.institutionId ?? null,
      task_key: input.taskKey,
      report_id: reportId,
      lease_token: leaseToken,
      lease_until: leaseUntil,
      ...(input.detail ?? {}),
    };
    const stepKeys = [...input.sectionTitles.map((_, index) => reportSectionStepKey(index)), REPORT_SAVE_STEP];
    const inserted = await db`
      INSERT INTO agent_runs
        (agent_name, run_kind, title, summary, status, params_json, trigger_source, triggered_by,
         idempotency_key, backend, progress_current, progress_total, current_stage, started_at, updated_at)
      VALUES
        ('hamilton', 'pro_request', ${input.title}, 'Writing the report section by section.', 'running',
         ${JSON.stringify(params)}::jsonb, 'api', ${`user:${input.userId}`}, ${input.taskKey}, 'agentic_v1',
         0, ${stepKeys.length}, ${REPORT_RUN_STAGE}, NOW(), NOW())
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) {
      const runId = Number(inserted[0].id);
      const titles = [...input.sectionTitles.map((title) => `Write the ${title} section`), "Save the finished report"];
      for (const [index, key] of stepKeys.entries()) {
        await db`
          INSERT INTO agent_run_steps (agent_run_id, step_key, agent_name, title, status, sequence, input_payload)
          VALUES (${runId}, ${key}, 'hamilton', ${titles[index]}, 'queued', ${index + 1}, '{}'::jsonb)
        `;
      }
      await event(db, runId, null, "run.created", "running", "Report run opened; each finished section is saved before the next.", { task_key: input.taskKey, report_id: reportId, steps: stepKeys });
      const { stepIds } = await loadSteps(db, runId);
      const run: ReportRunHandle = { runId, leaseToken, reportId, taskKey: input.taskKey, stepIds, checkpoints: new Map(), resumed: false, carriedFromRun: null };
      await carryFromFailedRun(db, run).catch((error) => console.error("[report-run] carry-over failed", errorText(error)));
      return { kind: "opened", run };
    }

    // An active run already holds the key: take it over only when its lease has lapsed.
    const [active] = await db`
      SELECT id FROM agent_runs
       WHERE idempotency_key = ${input.taskKey} AND status IN ('queued', 'running', 'cancel_requested')
       ORDER BY started_at DESC LIMIT 1
    `;
    if (!active) return { kind: "unavailable", reason: "The report run could not be opened or found." };
    const runId = Number(active.id);
    const claimed = await db`
      UPDATE agent_runs
         SET params_json = params_json || ${JSON.stringify({ lease_token: leaseToken, lease_until: leaseUntil })}::jsonb,
             updated_at = NOW()
       WHERE id = ${runId} AND status = 'running'
         AND COALESCE((params_json->>'lease_until')::timestamptz, 'epoch'::timestamptz) < ${now.toISOString()}::timestamptz
       RETURNING params_json
    `;
    if (claimed.length === 0) return { kind: "busy", runId };
    const claimedParams = parseParams(claimed[0].params_json);
    const savedReportId = typeof claimedParams.report_id === "string" ? claimedParams.report_id : randomUUID();
    const { stepIds, checkpoints } = await loadSteps(db, runId);
    const run: ReportRunHandle = { runId, leaseToken, reportId: savedReportId, taskKey: input.taskKey, stepIds, checkpoints, resumed: true, carriedFromRun: null };
    const [saved] = await db`SELECT id FROM hamilton_reports WHERE id = ${savedReportId}::uuid LIMIT 1`;
    await event(db, runId, null, "run.resumed", "running",
      saved ? "Report run resumed after an interruption; the report was already saved." : `Report run resumed after an interruption; ${checkpoints.size} finished section(s) reused.`,
      { reused_sections: [...checkpoints.keys()], report_already_saved: Boolean(saved) });
    return saved ? { kind: "already_saved", run } : { kind: "resumed", run };
  } catch (error) {
    console.error("[report-run] could not open the report run", errorText(error));
    return { kind: "unavailable", reason: errorText(error) };
  }
}

/** Renew the lease and fail loudly when another request took the run over. */
async function holdLease(db: SqlTag, run: ReportRunHandle, stage: string, progress: number | null): Promise<void> {
  const leaseUntil = new Date(Date.now() + REPORT_RUN_LEASE_MS).toISOString();
  const rows = await db`
    UPDATE agent_runs
       SET params_json = params_json || ${JSON.stringify({ lease_until: leaseUntil })}::jsonb,
           progress_current = COALESCE(${progress}, progress_current),
           summary = ${stage}, updated_at = NOW()
     WHERE id = ${run.runId} AND status = 'running' AND params_json->>'lease_token' = ${run.leaseToken}
     RETURNING id
  `;
  if (rows.length === 0) throw new ReportRunLeaseLostError(run.runId);
}

/** Mark a section started, so the ledger shows which one was in progress if the request is cut off. */
export async function startReportSection(run: ReportRunHandle, key: string, db: SqlTag = sql): Promise<void> {
  await holdLease(db, run, `Writing ${key}.`, null);
  const stepId = run.stepIds.get(key) ?? null;
  await db`UPDATE agent_run_steps SET status = 'running', started_at = NOW(), updated_at = NOW() WHERE id = ${stepId}`;
}

/** Save a finished section before anything else runs. Throws ReportRunLeaseLostError if the run was taken over. */
export async function saveReportSection(run: ReportRunHandle, key: string, checkpoint: ReportSectionCheckpoint, db: SqlTag = sql): Promise<void> {
  const done = [...run.checkpoints.keys(), key].filter((item, index, all) => all.indexOf(item) === index).length;
  await holdLease(db, run, `Saved ${done} section(s).`, done);
  const stepId = run.stepIds.get(key) ?? null;
  const payload = JSON.parse(JSON.stringify(checkpoint)) as ReportSectionCheckpoint;
  await db`
    UPDATE agent_run_steps
       SET status = 'completed', output_payload = ${JSON.stringify(payload)}::jsonb,
           summary = 'Section written and saved.', error_summary = NULL, completed_at = NOW(), updated_at = NOW()
     WHERE id = ${stepId}
  `;
  await event(db, run.runId, stepId, "section.saved", "completed", "Section written and saved.", { step_key: key, input_hash: checkpoint.inputHash, provider_responses: checkpoint.providerResponses.length });
  run.checkpoints.set(key, payload);
}

/** Record a section that failed under the retry policy, with its fault and every try. */
export async function failReportSection(
  run: ReportRunHandle,
  key: string,
  fault: HamiltonFault,
  attempts: Array<{ attempt: number; fault: string | null }>,
  db: SqlTag = sql,
): Promise<void> {
  try {
    const stepId = run.stepIds.get(key) ?? null;
    const summary = `Section failed (${fault.kind}) after ${attempts.length} tr${attempts.length === 1 ? "y" : "ies"}.`;
    await db`
      UPDATE agent_run_steps SET status = 'failed', summary = ${summary}, error_summary = ${fault.detail},
             completed_at = NOW(), updated_at = NOW()
       WHERE id = ${stepId}
    `;
    await event(db, run.runId, stepId, "section.failed", "failed", summary, { step_key: key, fault: fault.kind, retryable: fault.retryable, attempts, detail: fault.detail });
  } catch (error) {
    console.error("[report-run] could not record the section failure", errorText(error));
  }
}

async function closeRun(db: SqlTag, run: ReportRunHandle, status: "completed" | "failed", summary: string, detail: Record<string, unknown>): Promise<boolean> {
  const error = status === "failed" ? summary : null;
  const rows = await db`
    UPDATE agent_runs
       SET status = ${status}, summary = ${summary}, error_summary = ${error},
           params_json = params_json || ${JSON.stringify(detail)}::jsonb,
           completed_at = NOW(), updated_at = NOW()
     WHERE id = ${run.runId} AND status = 'running' AND params_json->>'lease_token' = ${run.leaseToken}
     RETURNING id
  `;
  if (rows.length === 0) return false;
  if (status === "completed") {
    await db`
      UPDATE agent_run_steps SET status = 'completed', summary = ${summary}, completed_at = NOW(), updated_at = NOW()
       WHERE agent_run_id = ${run.runId} AND step_key = ${REPORT_SAVE_STEP}
    `;
  } else {
    await db`
      UPDATE agent_run_steps SET status = 'skipped', summary = 'Not run: an earlier step failed.', updated_at = NOW()
       WHERE agent_run_id = ${run.runId} AND status IN ('queued', 'running')
    `;
  }
  await event(db, run.runId, null, `run.${status}`, status, summary, detail);
  return true;
}

/** The report is saved: close the run. Best effort; the saved report stands either way. */
export async function completeReportRun(run: ReportRunHandle, summary: string, detail: Record<string, unknown>, db: SqlTag = sql): Promise<boolean> {
  try {
    return await closeRun(db, run, "completed", summary, detail);
  } catch (error) {
    console.error("[report-run] could not close the run as completed", errorText(error));
    return false;
  }
}

/** End the run with its failure recorded. Best effort; never replaces the reader's error. */
export async function failReportRun(run: ReportRunHandle, summary: string, detail: Record<string, unknown>, db: SqlTag = sql): Promise<boolean> {
  try {
    return await closeRun(db, run, "failed", summary, detail);
  } catch (error) {
    console.error("[report-run] could not close the run as failed", errorText(error));
    return false;
  }
}
