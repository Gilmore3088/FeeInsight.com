import { sql } from "./data-store/connection";
import { assertAutomationEnabled, assertPipelineEnabled } from "./automation-control";
import { parseResearchRequest, RESEARCH_EDITION } from "./research-database/types";
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
    if (params.edition === RESEARCH_EDITION) {
      parseResearchRequest(params.research);
      await assertPipelineEnabled("Hamilton research generation");
    } else await assertAutomationEnabled("Hamilton report generation");
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  const result = await startAgentRun({
    agent: "hamilton",
    kind: "report",
    title: params.edition === RESEARCH_EDITION ? "Prepare economic and market research" : `Generate ${reportType.replace(/_/g, " ")} report`,
    params: {
      report_job_id: reportJobId,
      report_type: reportType,
      ...params,
      source: "report_agent_runs",
    },
    triggeredBy,
    triggerSource,
    idempotencyKey: `report:${reportJobId}`,
    steps: params.edition === RESEARCH_EDITION ? [
      { key: "research-render", agent: "hamilton", title: "Assemble and freeze research evidence" },
      { key: "research-verify", agent: "hamilton", title: "Replay frozen research calculations" },
      { key: "report-close", agent: "hamilton", title: "Close research job" },
    ] : [
      {
        key: "report-render",
        agent: "hamilton",
        title: "Write and render the report",
      },
      {
        key: "report-reconcile",
        agent: "hamilton",
        title: "Reconcile every printed fee figure with live data",
      },
      {
        key: "report-close",
        agent: "hamilton",
        title: "Close the report job",
      },
    ],
    summary: params.edition === RESEARCH_EDITION ? "Research run accepted: freeze evidence, calculate figures, verify frozen-input replay, then await editorial approval." : "Hamilton report run accepted: render, store, reconcile every printed fee figure, then ready to publish from the reports page.",
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
