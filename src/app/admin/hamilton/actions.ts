"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { PUBLISHED_REPORTS_TAG } from "@/lib/data-store/published-reports";
import { getSql, withTransaction } from "@/lib/data-store/connection";
import { requireAuth } from "@/lib/auth";
import { cancelAgentRun } from "@/lib/agents/run-store";
import { triggerReportJob } from "@/lib/report-agent-runs";
import type { ReportType } from "@/lib/report-engine/types";
import { assertLegacyGeneratableReportType } from "@/lib/report-engine/legacy-generation-policy";
import { reconciliationTiesOut } from "@/lib/report-engine/reconcile";

// Slug generation helper — title to URL-safe slug
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

/**
 * Publish a completed report job to the public catalog.
 * T-16-08: requireAuth enforced before any DB write.
 * T-16-11: generateSlug strips non-alphanumeric chars; parameterized query.
 */
export async function publishReport(
  jobId: string,
  title: string,
  reportType: ReportType,
  isPublic: boolean = true,
): Promise<{ success: boolean; slug?: string; error?: string }> {
  await requireAuth("edit");

  const slug = generateSlug(title);

  try {
    // #1066/#1259: only a complete job whose printed fee figures tied out to live data
    // publishes. The check and the insert run in one transaction with the job row locked
    // (FOR UPDATE), so the job cannot change between them. The tie-out test is
    // reconciliationTiesOut itself, which also reads a manifest stored as a JSON string.
    const outcome = await withTransaction(async (tx): Promise<{ slug: string } | { error: string }> => {
      const [job] = await tx<Array<{ status: string; data_manifest: unknown }>>`
        SELECT status, data_manifest FROM report_jobs WHERE id = ${jobId} FOR UPDATE
      `;
      if (!job) return { error: "Report job not found." };
      if (job.status !== "complete") return { error: `Report job is ${job.status}, not complete.` };
      if (!reconciliationTiesOut(job.data_manifest)) {
        return {
          error: "This report has no reconciliation that tied out to live data, so it cannot be published. Generate the report again to render and reconcile it.",
        };
      }
      const rows = await tx<Array<{ slug: string }>>`
        INSERT INTO published_reports (job_id, report_type, slug, title, is_public)
        VALUES (${jobId}, ${reportType}, ${slug}, ${title}, ${isPublic})
        ON CONFLICT (slug) DO NOTHING
        RETURNING slug
      `;
      if (rows[0]?.slug) return { slug: rows[0].slug };
      // Slug collision — append timestamp
      const fallbackSlug = `${slug}-${Date.now()}`;
      await tx`
        INSERT INTO published_reports (job_id, report_type, slug, title, is_public)
        VALUES (${jobId}, ${reportType}, ${fallbackSlug}, ${title}, ${isPublic})
      `;
      return { slug: fallbackSlug };
    });
    if ("error" in outcome) return { success: false, error: outcome.error };
    const finalSlug = outcome.slug;

    // Trigger ISR revalidation per D-04
    revalidateTag(PUBLISHED_REPORTS_TAG, "max");
    revalidatePath("/reports");
    revalidatePath(`/reports/${finalSlug}`, "page");
    revalidatePath("/admin/hamilton");

    return { success: true, slug: finalSlug };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Cancel a pending/assembling/rendering report job.
 * Sets status to 'failed' with a cancellation reason.
 */
export async function cancelReport(
  jobId: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAuth("cancel_jobs");

  try {
    const sql = getSql();
    const [job] = await sql`
      SELECT id, status, agent_run_id
        FROM report_jobs
       WHERE id = ${jobId}
    `;
    if (!job || !["pending", "assembling", "rendering", "cancel_requested"].includes(String(job.status))) {
      return { success: false, error: "Job not found or already complete/failed" };
    }
    if (!job.agent_run_id) {
      return { success: false, error: "This report has no cancellable agent run" };
    }

    // Guarded (#1271): a job that finished between the read above and this write keeps its
    // status, and nothing is cancelled.
    const requested = await sql`
      UPDATE report_jobs
         SET status = 'cancel_requested', cancel_requested_at = NOW()
       WHERE id = ${jobId}
         AND status IN ('pending', 'assembling', 'rendering', 'cancel_requested')
       RETURNING id
    `;
    if (requested.length === 0) {
      return { success: false, error: "Job not found or already complete/failed" };
    }
    const cancelled = await cancelAgentRun(Number(job.agent_run_id), "hamilton-admin");
    if (!cancelled.success) {
      await sql`
        UPDATE report_jobs SET error = ${cancelled.error ?? "Backend cancellation failed"}
         WHERE id = ${jobId} AND status = 'cancel_requested'
      `;
      return cancelled;
    }
    await sql`
      UPDATE report_jobs
         SET status = 'cancelled', error = 'Cancelled by user', completed_at = NOW()
       WHERE id = ${jobId} AND status = 'cancel_requested'
    `;

    revalidatePath("/admin/hamilton");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Cancel all non-terminal report jobs at once.
 */
export async function cancelAllPending(): Promise<{ success: boolean; count?: number; error?: string }> {
  await requireAuth("cancel_jobs");

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT id FROM report_jobs
       WHERE status IN ('pending', 'assembling', 'rendering', 'cancel_requested')
    `;

    let count = 0;
    const errors: string[] = [];
    for (const row of rows) {
      const result = await cancelReport(String(row.id));
      if (result.success) count += 1;
      else errors.push(result.error ?? `Failed to cancel ${row.id}`);
    }

    revalidatePath("/admin/hamilton");
    return errors.length > 0
      ? { success: false, count, error: errors.join("; ") }
      : { success: true, count };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Retry a failed report job — creates a new job with the same type and params.
 * T-16-09: requireAuth first; WHERE status = 'failed' prevents misuse.
 * T-16-10: UUID mismatch returns no rows gracefully.
 */
export async function retryReport(
  jobId: string,
): Promise<{ success: boolean; newJobId?: string; error?: string }> {
  const user = await requireAuth("trigger_jobs");

  try {
    const sql = getSql();
    const rows = await sql<Array<{ report_type: string; params: unknown }>>`
      SELECT report_type, params FROM report_jobs
      WHERE id = ${jobId} AND status = 'failed'
      LIMIT 1
    `;

    if (!rows[0]) {
      return { success: false, error: "Job not found or not in failed state" };
    }

    const { report_type, params } = rows[0];
    const reportPolicy = assertLegacyGeneratableReportType(report_type as ReportType);
    if (!reportPolicy.ok) {
      return { success: false, error: reportPolicy.error };
    }

    const newRows = await sql<Array<{ id: string }>>`
      INSERT INTO report_jobs (report_type, status, params)
      VALUES (${report_type}, 'pending', ${JSON.stringify(params ?? {})})
      RETURNING id
    `;

    const newJobId = newRows[0]?.id;
    if (!newJobId) {
      return { success: false, error: "Failed to create retry job" };
    }

    const trigger = await triggerReportJob(
      newJobId,
      report_type as ReportType,
      (params ?? {}) as Record<string, unknown>,
      user.username,
      "admin",
    );
    if (!trigger.success) {
      revalidatePath("/admin/hamilton");
      return { success: false, error: trigger.error };
    }

    revalidatePath("/admin/hamilton");
    return { success: true, newJobId };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
