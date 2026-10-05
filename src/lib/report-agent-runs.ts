import { sql } from "./data-store/connection";
import { assertAutomationEnabled } from "./automation-control";
import { startAgentRun } from "./agents/run-store";
import type { ReportType } from "./report-engine/types";
import { assertLegacyGeneratableReportType } from "./report-engine/legacy-generation-policy";

export async function triggerReportJob(
  reportJobId: string,
  reportType: ReportType,
  params: Record<string, unknown>,
  triggeredBy: string,
  triggerSource: "admin" | "api" | "schedule" = "admin",
): Promise<{ success: boolean; agentRunId?: number; error?: string }> {
  const reportPolicy = assertLegacyGeneratableReportType(reportType);
  if (!reportPolicy.ok) {
    return { success: false, error: reportPolicy.error };
  }

  try {
    await assertAutomationEnabled("Hamilton report generation");
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  const result = await startAgentRun({
    agent: "hamilton",
    kind: "report",
    title: `Generate ${reportType.replace(/_/g, " ")} report`,
    params: {
      report_job_id: reportJobId,
      report_type: reportType,
      ...params,
      source: "report_agent_runs",
    },
    triggeredBy,
    triggerSource,
    idempotencyKey: `report:${reportJobId}`,
    steps: [
      {
        key: "report-render",
        agent: "hamilton",
        title: "Write and render the report",
      },
      {
        key: "report-close",
        agent: "hamilton",
        title: "Close the report job",
      },
    ],
    summary: "Hamilton report run accepted: render, store, then ready to publish from the reports page.",
  });
  await sql`
    UPDATE report_jobs
       SET agent_run_id = ${result.run.id},
           status = 'pending',
           error = NULL
     WHERE id = ${reportJobId}
  `;
  return { success: true, agentRunId: result.run.id };
}
