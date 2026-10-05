/**
 * The render step of a public report run (national_index, state_index, monthly_pulse).
 *
 * report-render: assembles the data, writes Hamilton's sections (paid model calls),
 * renders the report HTML, stores it in R2 and marks the report_jobs row complete.
 * report-close:  a free step after it; a job the render step did not finish (skipped by
 * the provider stop or budget, or failed) is marked failed with the reason, so a job
 * never sits "pending" behind a finished run.
 *
 * Failures throw, so the run ledger records the failed step with its reason.
 *
 * Publishing to the public catalog stays the admin's Publish button on
 * /admin/hamilton/reports: an AI-written public report gets a human look first.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { sql as sqlTag } from "@/lib/data-store/connection";
import { assembleAndRender } from "./assemble-and-render";
import { isLegacyGeneratableReportType } from "./legacy-generation-policy";
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
    await db`UPDATE report_jobs SET status = 'failed', error = ${message} WHERE id = ${jobId}`;
    throw new Error(message);
  }

  // assembleAndRender marks the job assembling, and failed (with the error) when it throws.
  const html = await (deps.render ?? assembleAndRender)(job.report_type, jobParams(job), jobId);
  await db`UPDATE report_jobs SET status = 'rendering', error = NULL WHERE id = ${jobId}`;
  const key = reportArtifactKey(job.report_type, jobId);
  try {
    await store.put(key, html, "text/html; charset=utf-8");
  } catch (error) {
    const message = `Report rendered but could not be stored: ${error instanceof Error ? error.message : String(error)}`;
    await db`UPDATE report_jobs SET status = 'failed', error = ${message} WHERE id = ${jobId}`;
    throw new Error(message);
  }
  await db`
    UPDATE report_jobs
       SET status = 'complete', artifact_key = ${key}, error = NULL, completed_at = NOW()
     WHERE id = ${jobId}
  `;
  const title = REPORT_TITLES[job.report_type] ?? job.report_type;
  return {
    status: "completed",
    summary: `Rendered the ${title} report (${Math.round(html.length / 1024).toLocaleString("en-US")} KB) and stored it; it is ready to publish from the reports page.`,
    detail: { report_job_id: jobId, report_type: job.report_type, artifact_key: key, html_bytes: html.length },
  };
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
  const reason = "Report was not rendered: the render step did not finish (paid steps paused or over budget).";
  await db`UPDATE report_jobs SET status = 'failed', error = ${reason} WHERE id = ${jobId}`;
  return { status: "completed", summary: reason, detail: { report_job_id: jobId, report_status: "failed" } };
}
