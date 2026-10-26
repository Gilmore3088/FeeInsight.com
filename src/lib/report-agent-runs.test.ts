import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, startAgentRunMock, assertAutomationEnabledMock, assertPipelineEnabledMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  startAgentRunMock: vi.fn(),
  assertAutomationEnabledMock: vi.fn(),
  assertPipelineEnabledMock: vi.fn(),
}));

vi.mock("./data-store/connection", () => ({
  sql: sqlMock,
}));
vi.mock("./automation-control", () => ({
  assertAutomationEnabled: assertAutomationEnabledMock,
  assertPipelineEnabled: assertPipelineEnabledMock,
}));
vi.mock("./agents/run-store", () => ({
  startAgentRun: startAgentRunMock,
}));

import { triggerReportJob } from "./report-agent-runs";

describe("agentic report job envelope", () => {
  beforeEach(() => {
    sqlMock.mockReset().mockResolvedValue([]);
    startAgentRunMock.mockReset().mockResolvedValue({
      run: { id: 501 },
      reused: false,
      steps: [],
    });
    assertAutomationEnabledMock.mockReset().mockResolvedValue({ enabled: true });
    assertPipelineEnabledMock.mockReset().mockResolvedValue({ enabled: true });
  });

  it("creates a Hamilton report run and links it to report_jobs", async () => {
    await expect(triggerReportJob(
      "report-1",
      "monthly_pulse",
      { state: "CA" },
      "admin",
    )).resolves.toEqual({ success: true, agentRunId: 501 });

    expect(startAgentRunMock).toHaveBeenCalledWith(expect.objectContaining({
      agent: "hamilton",
      kind: "report",
      triggeredBy: "admin",
      idempotencyKey: "report:report-1",
      params: expect.objectContaining({
        report_job_id: "report-1",
        report_type: "monthly_pulse",
        state: "CA",
      }),
    }));
    expect(sqlMock).toHaveBeenCalledOnce();
    expect(sqlMock.mock.calls[0][0].join(" ")).toContain("UPDATE report_jobs");
    expect(sqlMock.mock.calls[0][0].join(" ")).toContain("agent_run_id");
  });

  it("does not create a run when automation safety is stopped", async () => {
    assertAutomationEnabledMock.mockRejectedValueOnce(new Error("Emergency stop is active"));

    await expect(triggerReportJob(
      "report-2",
      "national_index",
      {},
      "admin",
    )).resolves.toEqual({
      success: false,
      error: "Emergency stop is active",
    });

    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("queues deterministic research under the pipeline control without consulting provider safety", async () => {
    const params = { edition: "research_v1", research: { scope: "national", cadence: "quarterly" } };
    expect((await triggerReportJob("research-1", "national_index", params, "admin")).success).toBe(true);
    expect(assertAutomationEnabledMock).not.toHaveBeenCalled();
    expect(assertPipelineEnabledMock).toHaveBeenCalledOnce();
    expect(startAgentRunMock.mock.calls[0][0].steps.map((step: { key: string }) => step.key)).toEqual(["research-render", "research-verify", "report-close"]);
  });

  it("refuses research when its deterministic pipeline is paused", async () => {
    assertPipelineEnabledMock.mockRejectedValueOnce(new Error("Pipeline is paused"));
    const result = await triggerReportJob("research-2", "national_index", { edition: "research_v1", research: { scope: "national", cadence: "quarterly" } }, "admin");
    expect(result).toEqual({ success: false, error: "Pipeline is paused" });
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("does not create legacy peer brief runs outside Hamilton Reports", async () => {
    await expect(triggerReportJob(
      "report-3",
      "peer_brief",
      {},
      "admin",
    )).resolves.toEqual({
      success: false,
      error:
        "Legacy peer brief generation has moved to Hamilton Reports because peer briefs require a selected institution, evidence policy, and peer baseline. Use /pro/reports?intent=peer-brief instead.",
    });

    expect(assertAutomationEnabledMock).not.toHaveBeenCalled();
    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
