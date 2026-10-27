"use server";

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getSql } from "@/lib/data-store/connection";
import { triggerReportJob } from "@/lib/report-agent-runs";
import { parseResearchRequest, RESEARCH_EDITION } from "@/lib/research-database/types";

export async function createResearchReport(form: FormData) {
  const user = await requireAuth("trigger_jobs");
  const research = parseResearchRequest({ scope: form.get("scope"), cadence: form.get("cadence"), institutionId: form.get("institutionId") ? Number(form.get("institutionId")) : null });
  const reportType = research.cadence === "monthly" ? "monthly_pulse" : "national_index";
  const params = { edition: RESEARCH_EDITION, research };
  const db = getSql();
  const [job] = await db`INSERT INTO report_jobs (report_type, status, params, user_id) VALUES (${reportType}, 'pending', ${db.json(JSON.parse(JSON.stringify(params)))}, ${user.id}) RETURNING id`;
  const result = await triggerReportJob(job.id, reportType, params, user.username, "admin");
  if (!result.success) {
    await db`UPDATE report_jobs SET status = 'failed', error = ${result.error ?? "Research run could not start."} WHERE id = ${job.id} AND status = 'pending'`;
  }
  redirect(`/admin/hamilton/research-database/jobs/${job.id}`);
}
