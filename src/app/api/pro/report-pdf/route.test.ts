import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getHamiltonReportById: vi.fn(),
  loadPublishedReport: vi.fn(),
  readSavedAnalysisRecord: vi.fn(),
  renderToBuffer: vi.fn(),
  getActivePeerSet: vi.fn(),
  loadAnswerBrief: vi.fn(),
  premium: vi.fn(() => true),
}));

vi.mock("@/lib/hamilton/active-peer-set", () => ({ getActivePeerSet: mocks.getActivePeerSet }));
vi.mock("@/lib/hamilton/answer-brief", () => ({ loadAnswerBrief: mocks.loadAnswerBrief }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.premium }));
vi.mock("@/lib/api-hardening/audit", () => ({
  getRequestSubjectKey: () => "test",
  recordApiRouteAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/hamilton/pro-tables", () => ({ getHamiltonReportById: mocks.getHamiltonReportById }));
vi.mock("@/app/pro/(hamilton)/reports/actions", () => ({ loadPublishedReport: mocks.loadPublishedReport }));
// The server read is mocked, the loaders above it are real: a route that strips the claims on the way would be caught.
vi.mock("@/lib/hamilton/saved-analysis-record", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/hamilton/saved-analysis-record")>()), readSavedAnalysisRecord: mocks.readSavedAnalysisRecord }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: vi.fn().mockResolvedValue(null) }));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: mocks.renderToBuffer }));
vi.mock("@/components/hamilton/reports/PdfDocument", () => ({ PdfDocument: () => null }));
vi.mock("@/components/hamilton/reports/AnalysisPdfDocument", () => ({ AnalysisPdfDocument: () => null }));
vi.mock("@/components/hamilton/reports/MonthlyBriefingPdf", () => ({ MonthlyBriefingPdf: function MonthlyBriefingPdf() { return null; } }));

import { POST } from "./route";
import { writtenAnswerSources } from "@/lib/hamilton/board-brief";
import { NARRATIVE_BINDING_VERSION } from "@/lib/hamilton/narrative-bound";
import { SAVED_CLAIMS_VERSION } from "@/lib/hamilton/saved-claims";

const REPORT_ID = "11111111-2222-3333-4444-555555555555";

function post(body: unknown) {
  return POST(new NextRequest("http://localhost/api/pro/report-pdf", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/pro/report-pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7, role: "premium", subscription_status: "active" });
    mocks.renderToBuffer.mockResolvedValue(Buffer.from("%PDF"));
    mocks.premium.mockReturnValue(true);
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

  it("prints a saved monthly briefing in its own layout, named for its month (#1897)", async () => {
    const briefing = { month: "2026-10", sections: [] };
    mocks.getHamiltonReportById.mockResolvedValue({ report_json: { title: "October briefing", monthlyBriefing: briefing }, report_type: "monthly_briefing", artifact_metadata: null });
    const res = await post({ type: "report", reportId: REPORT_ID });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="monthly-briefing-2026-10.pdf"');
    const element = mocks.renderToBuffer.mock.calls[0][0] as { type: { name: string }; props: { title: string; briefing: unknown } };
    expect(element.type.name).toBe("MonthlyBriefingPdf");
    expect(element.props).toMatchObject({ title: "October briefing", briefing });
  });

  it("loads analyses by id and scopes them to the user", async () => {
    mocks.readSavedAnalysisRecord.mockResolvedValue(null);
    expect((await post({ type: "analysis", analysisId: "not-a-uuid" })).status).toBe(400);
    expect((await post({ type: "analysis", analysisId: REPORT_ID })).status).toBe(404);
  });
  it("exports frozen A identity without substituting the active B peer group", async () => {
    const identityContext = { version: 1, researchInstitutionId: 2945, accountInstitutionId: 101, accountStatus: "identified", researchInstitutionName: "Research Bank A", accountInstitutionName: "Space Coast CU", peerBaselineLabel: "Original A cohort" };
    const analysis = { title: "Saved answer A", identityContext };
    mocks.readSavedAnalysisRecord.mockResolvedValue({ id: REPORT_ID, institutionId: "2945", analysisFocus: "Fees", responseJson: analysis });
    mocks.getActivePeerSet.mockResolvedValue({ id: 999, label: "Current B cohort" });
    const result = await post({ type: "analysis", analysisId: REPORT_ID, institutionId: 8109, identityContext: { accountInstitutionId: 999 } });
    expect(result.status).toBe(200);
    expect(mocks.renderToBuffer.mock.calls[0][0].props.analysis).toEqual(analysis);
    expect(mocks.renderToBuffer.mock.calls[0][0].props.brief).toBeUndefined();
    expect(mocks.getActivePeerSet).not.toHaveBeenCalled();
    expect(mocks.loadAnswerBrief).not.toHaveBeenCalled();
  });

  it("prints a written answer's sources from the claims saved with it (#1077, Cycle A defect 5)", async () => {
    // Synthetic saved answer: one supported fee sentence and the claim fact it cites.
    const factId = "fee:published:9";
    const binding = { version: NARRATIVE_BINDING_VERSION, supported: [{ text: "Research Bank charges $37 for an overdraft.", factIds: [factId] }], interpretation: [], omitted: [], limitations: [] };
    const analysis = {
      title: "Overdraft", confidence: { level: "medium", basis: [] }, hamiltonView: "Research Bank charges $37 for an overdraft.", whatThisMeans: "", whyItMatters: [],
      evidence: { metrics: [] }, exploreFurther: [], answerEvidence: { passed: true, problems: [] }, narrativeBinding: binding,
      claims: { version: SAVED_CLAIMS_VERSION, bindingVersion: NARRATIVE_BINDING_VERSION, claims: [{ text: binding.supported[0].text, outcome: "supported", factIds: [factId] }],
        facts: [{ id: factId, kind: "observed", value: 37, unit: "usd", institutionId: 2945, feeCategory: "overdraft", metric: null, reportingDate: null, periodBasis: null, asOf: null }],
        factsTruncated: false, corrections: [] },
    };
    mocks.readSavedAnalysisRecord.mockResolvedValue({ id: REPORT_ID, institutionId: "2945", analysisFocus: "Fees", responseJson: analysis });
    expect((await post({ type: "analysis", analysisId: REPORT_ID })).status).toBe(200);
    const rendered = mocks.renderToBuffer.mock.calls[0][0].props.analysis;
    expect(writtenAnswerSources(rendered).lines).toEqual([expect.objectContaining({ id: factId, value: 37, complete: true })]);
  });

});

describe("POST /api/pro/report-pdf for a cancelled account (#1999)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7, role: "viewer", subscription_status: "canceled" });
    mocks.premium.mockReturnValue(false);
    mocks.renderToBuffer.mockResolvedValue(Buffer.from("%PDF"));
  });

  it("should_download_own_saved_report_when_subscription_cancelled", async () => {
    mocks.getHamiltonReportById.mockResolvedValue({ report_json: { title: "Mine" }, report_type: "peer_brief", artifact_metadata: null });
    const res = await post({ type: "report", reportId: REPORT_ID });
    expect(res.status).toBe(200);
    expect(mocks.getHamiltonReportById).toHaveBeenCalledWith(REPORT_ID, 7);
    expect(mocks.loadPublishedReport).not.toHaveBeenCalled();
  });

  it("should_deny_another_users_report_when_subscription_cancelled", async () => {
    mocks.getHamiltonReportById.mockResolvedValue(null);
    const res = await post({ type: "report", reportId: REPORT_ID });
    expect(res.status).toBe(403);
    expect(mocks.loadPublishedReport).not.toHaveBeenCalled();
    expect(mocks.renderToBuffer).not.toHaveBeenCalled();
  });

  it("should_deny_answers_and_empty_requests_when_subscription_cancelled", async () => {
    expect((await post({ type: "analysis", analysisId: REPORT_ID })).status).toBe(403);
    expect((await post({})).status).toBe(403);
    expect(mocks.readSavedAnalysisRecord).not.toHaveBeenCalled();
    expect(mocks.renderToBuffer).not.toHaveBeenCalled();
  });
});
