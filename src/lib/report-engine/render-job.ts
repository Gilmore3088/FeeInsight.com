/**
 * The render step of a public report run (national_index, state_index, monthly_pulse).
 *
 * report-render:    assembles the data, writes Hamilton's sections (paid model calls),
 *                   renders the report HTML, stores it in R2 and saves the fee figures it
 *                   prints on the job (data_manifest.printed). The job stays 'rendering'.
 * report-reconcile: free and deterministic (#1066). Recomputes every printed fee figure
 *                   from live rows (reconcile.ts). Ties out: the job is complete. Any figure
 *                   that does not: the job is failed, with each figure and why recorded on
 *                   data_manifest.reconciliation and the first few in the job error.
 * report-close:     a free step after them; a job the earlier steps did not finish
 *                   (skipped by the provider stop or budget, or failed) is marked failed
 *                   with the reason, so a job never sits "pending" behind a finished run.
 *
 * Every status write is guarded by the status it expects (#1259, #1266), so a cancel sent
 * mid-step stands: the step is skipped and says so. Any other lost race is thrown, naming
 * the status the job is in.
 *
 * Failures throw, so the run ledger records the failed step with its reason.
 *
 * Publishing to the public catalog stays the admin's Publish button on
 * /admin/hamilton/reports, and it refuses a job without a reconciliation that tied out:
 * an AI-written public report gets a human look first, and its numbers a machine check.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { sql as sqlTag } from "@/lib/data-store/connection";
import { assembleAndRender } from "./assemble-and-render";
import { isLegacyGeneratableReportType } from "./legacy-generation-policy";
import {
  describeReconciliation,
  loadLiveFigures,
  parseReportManifest,
  reconcileFigures,
  type ReportJobManifest,
} from "./reconcile";
import type { ReportJobStatus } from "./types";

type SqlTag = typeof sqlTag;

export const DEFAULT_REPORTS_BUCKET = "bfi-reports";

export interface ReportArtifactStore {
  put(key: string, body: string, contentType: string): Promise<void>;
}

export function reportArtifactKey(reportType: string, jobId: string): string {
  return `reports/${reportType}/${jobId}.html`;
}

/** The same R2 credentials the document vault and report downloads use; null when unset. */
export function getReportArtifactStore(): ReportArtifactStore | null {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  const client = new S3Client({
    endpoint,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  const bucket = process.env.R2_BUCKET ?? DEFAULT_REPORTS_BUCKET;
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
  };
}

interface ReportJobRow {
  id: string;
  report_type: string;
  status: ReportJobStatus;
  params: Record<string, unknown> | string | null;
}

export interface ReportStepResult {
  status: "completed" | "skipped";
  summary: string;
  detail: Record<string, unknown>;
}

const REPORT_TITLES: Record<string, string> = {
  national_index: "National Fee Index",
  state_index: "State Fee Index",
  monthly_pulse: "Monthly Pulse",
};

async function loadJob(db: SqlTag, jobId: string): Promise<ReportJobRow | null> {
  const rows = await db<ReportJobRow[]>`
    SELECT id, report_type, status, params FROM report_jobs WHERE id = ${jobId} LIMIT 1
  `;
  return rows[0] ?? null;
}

function jobParams(job: ReportJobRow): Record<string, unknown> {
  if (!job.params) return {};
  if (typeof job.params === "string") {
    try {
      const parsed = JSON.parse(job.params) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return job.params;
}

export async function runReportRenderStep(
  db: SqlTag,
  jobId: string | null | undefined,
  deps: {
    render?: typeof assembleAndRender;
    store?: ReportArtifactStore | null;
  } = {},
): Promise<ReportStepResult> {
  if (!jobId) {
    throw new Error("Report run has no report job id.");
  }
  const job = await loadJob(db, jobId);
  if (!job) {
    throw new Error(`Report job ${jobId} was not found.`);
  }
  if (job.status === "complete") {
    return { status: "skipped", summary: "Report was already rendered.", detail: { report_job_id: jobId } };
  }
  if (job.status === "cancelled" || job.status === "cancel_requested") {
    return { status: "skipped", summary: "Report job was cancelled before rendering.", detail: { report_job_id: jobId } };
  }
  if (!isLegacyGeneratableReportType(job.report_type)) {
    throw new Error(`Report type ${job.report_type} is not rendered by this step.`);
  }
  const store = deps.store === undefined ? getReportArtifactStore() : deps.store;
  if (!store) {
    const message = "Report storage is not configured (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).";
    const write = await failOpenJob(db, jobId, message);
    if (write === "lost") return lostRace(db, jobId, "render", "failed", message, { report_job_id: jobId });
    throw new Error(message);
  }

  // assembleAndRender marks the job assembling, and failed (with the error) when it throws;
  // both writes leave a cancel in place (#1266). It throws without a paid call when a cancel
  // came first; a throw after a cancel is recorded as skipped, not failed (#1271).
  let rendered: Awaited<ReturnType<typeof assembleAndRender>>;
  try {
    rendered = await (deps.render ?? assembleAndRender)(job.report_type, jobParams(job), jobId);
  } catch (error) {
    const now = await currentStatus(db, jobId);
    if (now === "cancel_requested" || now === "cancelled") {
      return {
        status: "skipped",
        summary: `${PHASE_WORDS.render.cancelled} Assembly stopped (it is now ${now}): ${errorText(error)}`,
        detail: { report_job_id: jobId, report_type: job.report_type, report_status: now, lost_race: true },
      };
    }
    throw error;
  }
  const html = rendered.html;
  const detail = { report_job_id: jobId, report_type: job.report_type };
  // Only an open job moves on, so a cancel sent while Hamilton wrote the sections stands (#1266).
  const started = await db<Array<{ id: string }>>`
    UPDATE report_jobs SET status = 'rendering', error = NULL
     WHERE id = ${jobId} AND status IN ('pending','assembling','rendering') RETURNING id
  `;
  if (started.length === 0) {
    return lostRace(db, jobId, "render", "rendering", "The rendered report was not stored.", detail);
  }
  const key = reportArtifactKey(job.report_type, jobId);
  try {
    await store.put(key, html, "text/html; charset=utf-8");
  } catch (error) {
    const message = `Report rendered but could not be stored: ${errorText(error)}`;
    const write = await failRenderingJob(db, jobId, message);
    if (write === "not_rendering") return lostRace(db, jobId, "render", "failed", message, detail);
    throw new Error(message, { cause: error });
  }
  const manifest: ReportJobManifest = { ...(rendered.manifest ?? {}), printed: rendered.printed, reconciliation: null };
  // Stays 'rendering': the reconcile step completes it, or fails it with the figures that differ.
  const saved = await db<Array<{ id: string }>>`
    UPDATE report_jobs
       SET artifact_key = ${key}, data_manifest = ${db.json(JSON.parse(JSON.stringify(manifest)))}, error = NULL
     WHERE id = ${jobId} AND status = 'rendering'
     RETURNING id
  `;
  if (saved.length === 0) {
    // The HTML is already in R2 and the store has no delete, so the object stays there
    // unattached. Its key is named in the summary and the detail, so it can be found and
    // removed (#1271).
    return lostRace(
      db,
      jobId,
      "render",
      "rendered",
      `The stored report was not attached to the job; the uploaded HTML stays in storage, unattached, at ${key}.`,
      { ...detail, artifact_key: key, unattached_artifact_key: key },
    );
  }
  const title = REPORT_TITLES[job.report_type] ?? job.report_type;
  return {
    status: "completed",
    summary: `Rendered the ${title} report (${Math.round(html.length / 1024).toLocaleString("en-US")} KB) and stored it; its ${(rendered.printed?.figures.length ?? 0).toLocaleString("en-US")} printed fee figures are reconciled next.`,
    detail: {
      report_job_id: jobId,
      report_type: job.report_type,
      artifact_key: key,
      html_bytes: html.length,
      printed_figures: rendered.printed?.figures.length ?? 0,
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a guarded write did: wrote the row, lost the race (the job is no longer 'rendering'), or errored. */
type GuardedWrite = "written" | "not_rendering" | "error";

type SavedManifest = ReturnType<SqlTag["json"]>;

/**
 * Fail a job the reconcile step could not finish, so it never stays 'rendering' (#1249):
 * the step's failure ends the run, and report-close, which would clean it up, never runs.
 * Only a 'rendering' job is touched, so a cancel is never overwritten (#1259). Best effort:
 * when the database itself is down this write fails too, and the caller's error is what is
 * thrown.
 */
async function failRenderingJob(db: SqlTag, jobId: string, message: string): Promise<GuardedWrite> {
  try {
    const rows = await db<Array<{ id: string }>>`
      UPDATE report_jobs SET status = 'failed', error = ${message}
       WHERE id = ${jobId} AND status = 'rendering' RETURNING id
    `;
    return rows.length > 0 ? "written" : "not_rendering";
  } catch (error) {
    console.error(`[report-job] could not mark job ${jobId} failed:`, errorText(error));
    return "error";
  }
}

/**
 * Fail a job that is still open (pending, assembling or rendering), so a cancel is never
 * overwritten (#1266). "lost" means the job was no longer open. Best effort, like
 * failRenderingJob: a database error is logged and the caller throws its own reason.
 */
async function failOpenJob(db: SqlTag, jobId: string, message: string): Promise<"written" | "lost" | "error"> {
  try {
    const rows = await db<Array<{ id: string }>>`
      UPDATE report_jobs SET status = 'failed', error = ${message}
       WHERE id = ${jobId} AND status IN ('pending','assembling','rendering') RETURNING id
    `;
    return rows.length > 0 ? "written" : "lost";
  } catch (error) {
    console.error(`[report-job] could not mark job ${jobId} failed:`, errorText(error));
    return "error";
  }
}

/** The job's status now, for a step that lost a race; null when it cannot be read. */
async function currentStatus(db: SqlTag, jobId: string): Promise<string | null> {
  try {
    const rows = await db<Array<{ status: string }>>`SELECT status FROM report_jobs WHERE id = ${jobId} LIMIT 1`;
    return rows[0]?.status ?? null;
  } catch (error) {
    console.error(`[report-job] could not read job ${jobId} status:`, errorText(error));
    return null;
  }
}

type StepPhase = "render" | "reconcile" | "close";

const PHASE_WORDS: Record<StepPhase, { left: string; cancelled: string }> = {
  render: { left: "The job changed while it was rendered", cancelled: "Report job was cancelled during rendering." },
  reconcile: {
    left: "The job left rendering while it was reconciled",
    cancelled: "Report job was cancelled during reconciliation.",
  },
  close: { left: "The job changed while it was closed", cancelled: "Report job was cancelled while it was closed." },
};

/**
 * The job's status changed while the step ran, so the step's guarded write changed nothing.
 * A cancel is the expected cause: the step is skipped and says so. Anything else is
 * unexpected and is thrown, naming the status, so the run ledger shows it.
 */
async function lostRace(
  db: SqlTag,
  jobId: string,
  phase: StepPhase,
  wanted: string,
  reason: string,
  detail: Record<string, unknown>,
): Promise<ReportStepResult> {
  const now = await currentStatus(db, jobId);
  const words = PHASE_WORDS[phase];
  const note = `${words.left} (it is now ${now ?? "unknown"}), so it was not marked ${wanted}.`;
  if (now === "cancel_requested" || now === "cancelled") {
    return {
      status: "skipped",
      summary: `${words.cancelled} ${note} ${reason}`,
      detail: { ...detail, report_job_id: jobId, report_status: now, lost_race: true },
    };
  }
  throw new Error(`${reason} ${note}`);
}

/**
 * Fail the job with the step's reason and throw that reason (#1259): a failed write is
 * logged, never thrown in its place. A job a cancel already took is a skip, not a failure.
 */
async function failReconcile(
  db: SqlTag,
  jobId: string,
  message: string,
  options: { manifest?: SavedManifest; detail?: Record<string, unknown>; cause?: unknown } = {},
): Promise<ReportStepResult> {
  let write: GuardedWrite;
  if (options.manifest) {
    try {
      const rows = await db<Array<{ id: string }>>`
        UPDATE report_jobs SET status = 'failed', error = ${message}, data_manifest = ${options.manifest}
         WHERE id = ${jobId} AND status = 'rendering' RETURNING id
      `;
      write = rows.length > 0 ? "written" : "not_rendering";
    } catch (error) {
      // The findings could not be saved; still fail the job, with the reason.
      write = await failRenderingJob(db, jobId, `${message} (The findings could not be saved: ${errorText(error)})`);
    }
  } else {
    write = await failRenderingJob(db, jobId, message);
  }
  if (write === "not_rendering") return lostRace(db, jobId, "reconcile", "failed", message, options.detail ?? {});
  throw options.cause === undefined ? new Error(message) : new Error(message, { cause: options.cause });
}

export async function runReportReconcileStep(
  db: SqlTag,
  jobId: string | null | undefined,
  deps: { now?: Date; load?: typeof loadLiveFigures } = {},
): Promise<ReportStepResult> {
  if (!jobId) {
    throw new Error("Report run has no report job id.");
  }
  let rows: Array<ReportJobRow & { artifact_key: string | null; data_manifest: unknown }>;
  try {
    rows = await db<Array<ReportJobRow & { artifact_key: string | null; data_manifest: unknown }>>`
      SELECT id, report_type, status, params, artifact_key, data_manifest FROM report_jobs WHERE id = ${jobId} LIMIT 1
    `;
  } catch (error) {
    const message = `Reconcile could not read the report job: ${errorText(error)}`;
    await failRenderingJob(db, jobId, message);
    throw new Error(message, { cause: error });
  }
  const job = rows[0];
  if (!job) {
    throw new Error(`Report job ${jobId} was not found.`);
  }
  if (job.status === "cancelled" || job.status === "cancel_requested") {
    return { status: "skipped", summary: "Report job was cancelled before reconciling.", detail: { report_job_id: jobId } };
  }
  if (job.status !== "rendering" || !job.artifact_key) {
    // complete, failed or never rendered: the close step reports a job left unfinished.
    return {
      status: "skipped",
      summary: `Report job is ${job.status}; there is no rendered report to reconcile.`,
      detail: { report_job_id: jobId, report_status: job.status },
    };
  }
  const manifest = parseReportManifest(job.data_manifest) ?? {};
  const printed = manifest.printed;
  if (!printed || !Array.isArray(printed.figures)) {
    const message = "Reconciliation blocked the report: the render step saved no printed figures to check.";
    return failReconcile(db, jobId, message);
  }

  let live: Awaited<ReturnType<typeof loadLiveFigures>>;
  try {
    live = await (deps.load ?? loadLiveFigures)(db, printed);
  } catch (error) {
    // Never leave the job 'rendering': fail it with the reason so it can be retried.
    const message = `Reconcile could not read live data: ${errorText(error)}`;
    return failReconcile(db, jobId, message, { cause: error });
  }
  const result = reconcileFigures(printed, live, deps.now);
  const summary = describeReconciliation(result);
  const saved = db.json(JSON.parse(JSON.stringify({ ...manifest, reconciliation: result })));
  const detail = {
    report_job_id: jobId,
    report_type: job.report_type,
    ties_out: result.ties_out,
    figures_checked: result.figures_checked,
    figures_tied: result.figures_tied,
    finding_count: result.finding_count,
    findings: result.findings.slice(0, 20),
    drift: result.drift.slice(0, 20),
    unchecked: result.unchecked.length,
  };
  if (!result.ties_out) {
    // Thrown so the run ledger shows the step failed, with which figures and why.
    return failReconcile(db, jobId, summary, { manifest: saved, detail });
  }
  let completed: Array<{ id: string }>;
  try {
    // Only a job still 'rendering' completes, so a cancel sent during reconcile stands (#1259).
    completed = await db<Array<{ id: string }>>`
      UPDATE report_jobs
         SET status = 'complete', error = NULL, data_manifest = ${saved}, completed_at = NOW()
       WHERE id = ${jobId} AND status = 'rendering'
       RETURNING id
    `;
  } catch (error) {
    const message = `Reconciled, but the report could not be marked complete: ${errorText(error)}`;
    return failReconcile(db, jobId, message, { cause: error, detail });
  }
  if (completed.length === 0) return lostRace(db, jobId, "reconcile", "complete", summary, detail);
  return { status: "completed", summary: `${summary} It is ready to publish from the reports page.`, detail };
}

export async function runReportCloseStep(db: SqlTag, jobId: string | null | undefined): Promise<ReportStepResult> {
  if (!jobId) {
    return { status: "skipped", summary: "Report run has no report job id.", detail: {} };
  }
  const job = await loadJob(db, jobId);
  if (!job) {
    return { status: "skipped", summary: `Report job ${jobId} was not found.`, detail: { report_job_id: jobId } };
  }
  if (job.status === "complete" || job.status === "failed" || job.status === "cancelled") {
    return {
      status: "completed",
      summary: job.status === "complete" ? "Report job is complete." : `Report job ended as ${job.status}.`,
      detail: { report_job_id: jobId, report_status: job.status },
    };
  }
  if (job.status === "cancel_requested") {
    // A cancel the admin sent; cancelReport finishes it. Close never overwrites it (#1266).
    // Skipped, the same as a cancel that lands after this read (lostRace) (#1271).
    return {
      status: "skipped",
      summary: "Report job was cancelled; the cancel is left in place.",
      detail: { report_job_id: jobId, report_status: job.status },
    };
  }
  const reason =
    job.status === "rendering"
      ? "Report was rendered but not reconciled, so it cannot be published; retry the report."
      : job.status === "assembling"
        ? "Report was not rendered: the render step started but did not finish; retry the report."
        : "Report was not rendered: the render step did not run (paid steps paused or over budget).";
  // Only an open job is closed, so a cancel sent after the read above stands (#1266).
  const closed = await db<Array<{ id: string }>>`
    UPDATE report_jobs SET status = 'failed', error = ${reason}
     WHERE id = ${jobId} AND status IN ('pending','assembling','rendering') RETURNING id
  `;
  if (closed.length === 0) return lostRace(db, jobId, "close", "failed", reason, { report_job_id: jobId });
  return { status: "completed", summary: reason, detail: { report_job_id: jobId, report_status: "failed" } };
}
