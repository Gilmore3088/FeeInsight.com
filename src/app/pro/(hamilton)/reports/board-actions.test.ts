import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), analysis: vi.fn(), report: vi.fn(), save: vi.fn(), sql: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("../analyze/actions", () => ({ loadAnalysisRecord: mocks.analysis }));
vi.mock("@/lib/hamilton/pro-tables", () => ({ getHamiltonReportById: mocks.report, saveHamiltonReport: mocks.save }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: mocks.run }));
import { saveBoardBrief } from "./board-actions";
import { boardBriefFromAnalysis } from "@/lib/hamilton/board-brief";
const edits = { title: "Board review", teamNote: "Our note", includeEvidence: true };
const response = { title: "Saved answer", confidence: { level: "medium" as const, basis: ["Limited"] }, hamiltonView: "Original answer", whatThisMeans: "Original context", whyItMatters: [], evidence: { metrics: [{ label: "Fee", value: "$0.00", note: "Published schedule · 2026-06-30" }] }, exploreFurther: ["Inspect terms"] };
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: 7, role: "user", subscription_status: "active", subscription_tier: "pro" }); mocks.save.mockResolvedValue("report-id"); mocks.run.mockResolvedValue(undefined); });
describe("private board brief writes", () => {
  it("denies unauthenticated saves before reading source artifacts", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await saveBoardBrief({ analysisId: "other", edits })).toMatchObject({ success: false });
    expect(mocks.analysis).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("refuses a missing/inaccessible source without accepting browser evidence", async () => {
    mocks.analysis.mockResolvedValue(null);
    expect(await saveBoardBrief({ analysisId: "other", edits })).toMatchObject({ success: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("uses the authenticated saved subject and evidence, with no research regeneration", async () => {
    mocks.analysis.mockResolvedValue({ id: "original", institutionId: "2", responseJson: response });
    expect(await saveBoardBrief({ analysisId: "original", edits })).toEqual({ success: true, reportId: "report-id" });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, institutionId: "2", reportType: "board_brief", evidencePolicy: "source-diligence", reportJson: expect.objectContaining({ executiveSummary: ["Original answer"] }) }));
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ provider_call_queued: false, analysis_id: "original" }) }));
  });
  it("rejects another user's report before the UPDATE", async () => {
    mocks.report.mockResolvedValue(null);
    expect(await saveBoardBrief({ reportId: "other", edits })).toMatchObject({ success: false });
    expect(mocks.report).toHaveBeenCalledWith("other", 7); expect(mocks.sql).not.toHaveBeenCalled();
  });
  it("scopes updates to user and board type while preserving frozen facts", async () => {
    const report = boardBriefFromAnalysis(response, "original", edits);
    mocks.report.mockResolvedValue({ report_type: "board_brief", report_json: report, institution_id: "2" }); mocks.sql.mockResolvedValue([{ id: "owned" }]);
    expect(await saveBoardBrief({ reportId: "owned", edits: { ...edits, teamNote: "Changed" } })).toEqual({ success: true, reportId: "owned" });
    const [strings, json, id, userId] = mocks.sql.mock.calls[0];
    expect(strings.join("")).toContain("AND user_id ="); expect(strings.join("")).toContain("report_type = 'board_brief'");
    expect(id).toBe("owned"); expect(userId).toBe(7); expect(JSON.parse(json).exhibits).toEqual(report.exhibits);
  });
});
