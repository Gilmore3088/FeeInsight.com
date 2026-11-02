import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildCommitteePacket } from "@/lib/hamilton/committee-packet";
import { fullPacketInput } from "@/lib/hamilton/committee-packet.fixture";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  premium: vi.fn(() => true),
  resolve: vi.fn(),
  loadCommitteePacket: vi.fn(),
  renderToBuffer: vi.fn(),
  getHamiltonReportById: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.premium }));
vi.mock("@/lib/api-hardening/audit", () => ({
  getRequestSubjectKey: () => "test",
  recordApiRouteAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/hamilton/pro-tables", () => ({ getHamiltonReportById: mocks.getHamiltonReportById }));
vi.mock("@/app/pro/(hamilton)/reports/actions", () => ({ loadPublishedReport: vi.fn() }));
vi.mock("@/lib/hamilton/saved-analysis-record", () => ({ readSavedAnalysisRecord: vi.fn() }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("@/lib/hamilton/committee-packet-data", () => ({ loadCommitteePacket: mocks.loadCommitteePacket }));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: mocks.renderToBuffer }));
vi.mock("@/components/hamilton/reports/PdfDocument", () => ({ PdfDocument: () => null }));
vi.mock("@/components/hamilton/reports/AnalysisPdfDocument", () => ({ AnalysisPdfDocument: () => null }));
vi.mock("@/components/hamilton/reports/MonthlyBriefingPdf", () => ({ MonthlyBriefingPdf: () => null }));
vi.mock("@/components/hamilton/reports/ReportBuilderPdf", () => ({ ReportBuilderPdf: () => null }));

import { POST } from "./route";

function post(body: unknown) {
  return POST(new NextRequest("http://localhost/api/pro/report-pdf", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/pro/report-pdf for the Reports builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7, role: "premium", subscription_status: "active" });
    mocks.premium.mockReturnValue(true);
    mocks.resolve.mockResolvedValue({ institution: { id: 323, name: "Synthetic Bank" } });
    mocks.loadCommitteePacket.mockResolvedValue(buildCommitteePacket(fullPacketInput()));
    mocks.renderToBuffer.mockResolvedValue(Buffer.from("%PDF"));
  });

  it("renders the layout the browser sends from the packet read on the server", async () => {
    const res = await post({ type: "report_builder", institutionId: 323, peerSetId: "41", layout: "committee:board:8:A4:trend,summary,-above" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/committee-fee-review-\d{4}-\d{2}-\d{2}-a4\.pdf/);
    expect(mocks.loadCommitteePacket).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, institutionId: 323, peerSetId: 41 }));
    const element = mocks.renderToBuffer.mock.calls[0][0] as { props: { doc: { pageSize: string; pages: { sections: { view: { key: string } }[] }[] } } };
    expect(element.props.doc.pageSize).toBe("A4");
    expect(element.props.doc.pages.flatMap((p) => p.sections.map((s) => s.view.key))).toEqual(["trend", "summary"]);
  });

  it("refuses a missing institution, an unknown one and a reader without Pro", async () => {
    expect((await post({ type: "report_builder", layout: "board" })).status).toBe(400);
    mocks.resolve.mockResolvedValue({ institution: null });
    expect((await post({ type: "report_builder", institutionId: 99 })).status).toBe(404);
    mocks.premium.mockReturnValue(false);
    expect((await post({ type: "report_builder", institutionId: 323 })).status).toBe(403);
    expect(mocks.renderToBuffer).not.toHaveBeenCalled();
  });
});
