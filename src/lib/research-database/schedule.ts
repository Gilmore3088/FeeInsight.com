import { getSql } from "@/lib/data-store/connection";
import { triggerReportJob } from "@/lib/report-agent-runs";
import { RESEARCH_EDITION, parseResearchRequest } from "./types";

/** Quarterly drafts allow time for quarter-end filings; source coverage remains independently gated. */
export function dueResearchEditions(now: Date) {
  const month = now.getUTCMonth() + 1;
  const period = now.toISOString().slice(0, 7);
  return [
    { key: `research:monthly:${period}`, cadence: "monthly" as const },
    ...([3, 6, 9, 12].includes(month) ? [{ key: `research:quarterly:${period}`, cadence: "quarterly" as const }] : []),
  ];
}

export async function scheduleResearchReports(now = new Date()) {
  if (process.env.RESEARCH_SCHEDULE_ENABLED !== "true") return { enabled: false, jobs: [] as string[] };
  const db = getSql();
  const jobs: string[] = [];
  for (const edition of dueResearchEditions(now)) {
    const research = parseResearchRequest({ scope: "national", cadence: edition.cadence });
    const params = { edition: RESEARCH_EDITION, research, scheduleKey: edition.key };
    const type = research.cadence === "monthly" ? "monthly_pulse" : "national_index";
    const id = await db.begin(async transaction => {
      const tx = transaction as unknown as typeof db;
      await tx`SELECT pg_advisory_xact_lock(hashtext('research-publication-schedule'))`;
      const [existing] = await tx`SELECT id FROM report_jobs WHERE params->>'scheduleKey' = ${edition.key} LIMIT 1`;
      if (existing) return null;
      const [job] = await tx`INSERT INTO report_jobs (report_type, status, params) VALUES (${type}, 'pending', ${tx.json(JSON.parse(JSON.stringify(params)))}) RETURNING id`;
      return String(job.id);
    });
    if (!id) continue;
    const result = await triggerReportJob(id, type, params, "research.publication.schedule", "schedule");
    if (!result.success) await db`UPDATE report_jobs SET status = 'failed', error = ${result.error ?? "Research scheduling failed."} WHERE id = ${id} AND status = 'pending'`;
    jobs.push(id);
  }
  return { enabled: true, jobs };
}
