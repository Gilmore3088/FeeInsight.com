"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getSql } from "@/lib/data-store/connection";
import { triggerReportJob } from "@/lib/report-agent-runs";
import { parseResearchRequest, RESEARCH_EDITION } from "@/lib/research-database/types";

export async function customizeResearchReport(form: FormData) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) throw new Error("An active Hamilton subscription is required to prepare research.");
  const research = parseResearchRequest({ scope: "footprint", cadence: "quarterly", institutionId: Number(form.get("institutionId")) });
  const db = getSql();
  const origin = String(form.get("researchReport") ?? "");
  const [source] = origin ? await db`SELECT id FROM published_reports WHERE id::text = ${origin} AND is_public = true` : [];
  const params = { edition: RESEARCH_EDITION, research, originReportId: source?.id ?? null, institutionId: research.institutionId, evidencePolicy: "verified-only", audience: "pro", intent: "market-research", selectedInstitutionSource: "manual", selectedInstitutionSourceLabel: "Institution search" };
  const [job] = await db`INSERT INTO report_jobs (report_type, status, params, user_id) VALUES ('national_index', 'pending', ${db.json(JSON.parse(JSON.stringify(params)))}, ${user.id}) RETURNING id`;
  const result = await triggerReportJob(job.id, "national_index", params, user.username, "api");
  if (!result.success) await db`UPDATE report_jobs SET status = 'failed', error = ${result.error ?? "Research run could not start."} WHERE id = ${job.id} AND status = 'pending'`;
  redirect(`/pro/reports/research?job=${job.id}`);
}
