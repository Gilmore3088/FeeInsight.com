import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { getSql } from "@/lib/data-store/connection";
import { checkFreshness } from "@/lib/report-engine/freshness";
import { triggerReportJob } from "@/lib/report-agent-runs";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * Scheduled public reports (Vercel cron): the National Fee Index each quarter and the
 * Monthly Pulse each month. Each call queues one report job and its visible Hamilton
 * run; the agents tick renders it, and an admin publishes it from /admin/hamilton/reports.
 * A report of the same type queued in the last SCHEDULE_GAP_DAYS is not queued again.
 */
const SCHEDULED_REPORTS = {
  national_index: { gapDays: 60 },
  monthly_pulse: { gapDays: 20 },
} as const;

type ScheduledReportType = keyof typeof SCHEDULED_REPORTS;

function isScheduledReportType(value: string | null): value is ScheduledReportType {
  return value !== null && Object.prototype.hasOwnProperty.call(SCHEDULED_REPORTS, value);
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const reportType = new URL(request.url).searchParams.get("type");
  if (!isScheduledReportType(reportType)) {
    return NextResponse.json(
      { error: `type must be one of: ${Object.keys(SCHEDULED_REPORTS).join(", ")}` },
      { status: 400 },
    );
  }

  const sql = getSql();
  const gapDays = SCHEDULED_REPORTS[reportType].gapDays;
  const recent = await sql<Array<{ id: string }>>`
    SELECT id FROM report_jobs
     WHERE report_type = ${reportType}
       AND status <> 'failed'
       AND created_at > NOW() - make_interval(days => ${gapDays})
     LIMIT 1
  `;
  if (recent[0]) {
    return NextResponse.json({ ok: true, queued: false, reason: "recent_job_exists", jobId: recent[0].id });
  }

  // Stale fee data is recorded as a failed job, so the reports page shows why nothing ran.
  const freshness = await checkFreshness("national");
  const rows = await sql<Array<{ id: string }>>`
    INSERT INTO report_jobs (report_type, status, params, error)
    VALUES (
      ${reportType},
      ${freshness.fresh ? "pending" : "failed"},
      ${JSON.stringify({ scheduled: true })},
      ${freshness.fresh ? null : `Scheduled report skipped: ${freshness.reason}`}
    )
    RETURNING id
  `;
  const jobId = rows[0]?.id;
  if (!jobId) {
    return NextResponse.json({ error: "Failed to create report job" }, { status: 500 });
  }
  if (!freshness.fresh) {
    return NextResponse.json({ ok: false, queued: false, reason: freshness.reason, jobId }, { status: 422 });
  }

  const trigger = await triggerReportJob(jobId, reportType, { scheduled: true }, "hamilton.report_schedule", "schedule");
  if (!trigger.success) {
    const error = trigger.error ?? "Report run was not accepted";
    await sql`UPDATE report_jobs SET status = 'failed', error = ${error} WHERE id = ${jobId}`;
    return NextResponse.json({ ok: false, queued: false, reason: error, jobId }, { status: 503 });
  }
  return NextResponse.json({ ok: true, queued: true, jobId, agentRunId: trigger.agentRunId });
}

export const GET = withApiRoutePolicy("api.admin.reports.schedule", "GET", handleGET);
