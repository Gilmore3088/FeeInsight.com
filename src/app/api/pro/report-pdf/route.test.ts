import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getHamiltonReportById: vi.fn(),
  loadPublishedReport: vi.fn(),
  loadAnalysisRecord: vi.fn(),
  renderToBuffer: vi.fn(),
  getActivePeerSet: vi.fn(),
  loadAnswerBrief: vi.fn(),
}));

vi.mock("@/lib/hamilton/active-peer-set", () => ({ getActivePeerSet: mocks.getActivePeerSet }));
vi.mock("@/lib/hamilton/answer-brief", () => ({ loadAnswerBrief: mocks.loadAnswerBrief }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("@/lib/api-hardening/audit", () => ({
  getRequestSubjectKey: () => "test",
  recordApiRouteAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/hamilton/pro-tables", () => ({ getHamiltonReportById: mocks.getHamiltonReportById }));
vi.mock("@/app/pro/(hamilton)/reports/actions", () => ({ loadPublishedReport: mocks.loadPublishedReport }));
vi.mock("@/app/pro/(hamilton)/analyze/actions", () => ({ loadAnalysisRecord: mocks.loadAnalysisRecord }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: vi.fn().mockResolvedValue(null) }));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: mocks.renderToBuffer }));
vi.mock("@/components/hamilton/reports/PdfDocument", () => ({ PdfDocument: () => null }));
vi.mock("@/components/hamilton/reports/AnalysisPdfDocument", () => ({ AnalysisPdfDocument: () => null }));

import { POST } from "./route";

const REPORT_ID = "11111111-2222-3333-4444-555555555555";

function post(body: unknown) {
  return POST(new NextRequest("http://localhost/api/pro/report-pdf", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/pro/report-pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7, role: "premium", subscription_status: "active" });
    mocks.renderToBuffer.mockResolvedValue(Buffer.from("%PDF"));
  });

  it("refuses client-supplied report content without a record id", async () => {
    const res = await post({ report: { title: "Fabricated", executiveSummary: ["$1 overdraft"] } });
    expect(res.status).toBe(400);
    expect(mocks.renderToBuffer).not.toHaveBeenCalled();
  });

  it("returns 404 for a report the user does not own and that is not published", async () => {
    mocks.getHamiltonReportById.mockResolvedValue(null);
    mocks.loadPublishedReport.mockResolvedValue(null);
    const res = await post({ type: "report", reportId: REPORT_ID });
    expect(res.status).toBe(404);
    expect(mocks.getHamiltonReportById).toHaveBeenCalledWith(REPORT_ID, 7);
  });

  it("renders the stored report, not the request body", async () => {
    mocks.getHamiltonReportById.mockResolvedValue({ report_json: { title: "Stored" }, report_type: "peer_brief", artifact_metadata: null });
    const res = await post({ type: "report", reportId: REPORT_ID, report: { title: "Injected" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("loads analyses by id and scopes them to the user", async () => {
    mocks.loadAnalysisRecord.mockResolvedValue(null);
    expect((await post({ type: "analysis", analysisId: "not-a-uuid" })).status).toBe(400);
    expect((await post({ type: "analysis", analysisId: REPORT_ID })).status).toBe(404);
  });
  it("exports frozen A identity without substituting the active B peer group", async () => {
    const identityContext = { version: 1, researchInstitutionId: 2945, accountInstitutionId: 101, accountStatus: "identified", researchInstitutionName: "Research Bank A", accountInstitutionName: "Space Coast CU", peerBaselineLabel: "Original A cohort" };
    const analysis = { title: "Saved answer A", identityContext };
    mocks.loadAnalysisRecord.mockResolvedValue({ id: REPORT_ID, institutionId: "2945", analysisFocus: "Fees", responseJson: analysis });
    mocks.getActivePeerSet.mockResolvedValue({ id: 999, label: "Current B cohort" });
    const result = await post({ type: "analysis", analysisId: REPORT_ID, institutionId: 8109, identityContext: { accountInstitutionId: 999 } });
    expect(result.status).toBe(200);
    expect(mocks.renderToBuffer.mock.calls[0][0].props.analysis).toEqual(analysis);
    expect(mocks.renderToBuffer.mock.calls[0][0].props.brief).toBeUndefined();
    expect(mocks.getActivePeerSet).not.toHaveBeenCalled();
    expect(mocks.loadAnswerBrief).not.toHaveBeenCalled();
  });

});
