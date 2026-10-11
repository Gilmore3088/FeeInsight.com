import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportArtifactMetadata, ReportSummaryResponse } from "@/lib/hamilton/types";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), institution: vi.fn(), sql: vi.fn(), report: vi.fn(), preview: vi.fn(), generate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: mocks.institution }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/hamilton/pro-tables", () => ({
  getHamiltonReportById: mocks.report,
  getHamiltonScenarioById: async () => null,
  getPublishedReports: async () => [],
  getRecentHamiltonReports: async () => [],
}));
vi.mock("@/lib/data-store/saved-peers", () => ({ getSavedPeerSets: async () => [] }));
vi.mock("@/lib/hamilton/active-peer-set", () => ({ getActivePeerSet: async () => null }));
vi.mock("./actions", () => ({
  generateReport: mocks.generate,
  previewReportPeerCoverage: mocks.preview,
  loadActiveScenarios: async () => [],
  loadScenarioById: async () => null,
}));
vi.mock("@/components/hamilton/basket/AddToReportButton", () => ({ useReportBasket: () => [] }));
vi.mock("@/components/hamilton/landing/LandingResearchEntry", () => ({ LandingResearchEntry: () => null }));

import ReportsPage from "./page";
import { buildReportPeerCoveragePreview } from "@/lib/hamilton/report-evidence";

const metadata: ReportArtifactMetadata = {
  evidencePolicy: "verified-only", selectedSource: "url", selectedSourceLabel: "URL selected",
  peerSetId: null, peerBaselineSource: "national", peerBaselineLabel: "Original Space Coast baseline",
  peerFallbackReason: null, selectedVerifiedFeeCount: 1, selectedProvisionalFeeCount: 0, selectedFeeDeltaCount: 1,
};
const savedReport: ReportSummaryResponse = {
  title: "Space Coast Credit Union fee report", executiveSummary: ["Space Coast published evidence."],
  snapshot: [], strategicRationale: "Original evidence.", tradeoffs: [], recommendation: "Review the schedule.",
  implementationNotes: [], exportControls: { pdfEnabled: true, shareEnabled: false },
  identityContext: { version: 1, researchInstitutionId: 8109, researchInstitutionName: "Space Coast Credit Union",
    accountInstitutionId: null, accountStatus: "unlinked", researchSelectionSource: "URL selected",
    peerBaselineLabel: "Original Space Coast baseline", peerBaselineSource: "national" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: 7, role: "premium", subscription_status: "active", institution_name: "Space Coast Credit Union", display_name: "Researcher" });
  // The real resolver sees no stored research preference. A profile label must not fill it in.
  mocks.sql.mockResolvedValue([]);
  mocks.institution.mockImplementation(async (id: number) => ({
    id, institution_name: id === 8109 ? "Space Coast Credit Union" : "Addition Financial Credit Union",
    charter_type: "credit_union", city: "Melbourne", state_code: "FL", asset_size: null, asset_size_tier: null,
    fed_district: 6, fee_publication_status: "verified", insight_readiness: "ready", published_fee_count: 1,
    provisional_fee_count: 0, confidence_summary: "Published schedule", source_needed_reason: "not_applicable",
  }));
  mocks.report.mockResolvedValue(null);
  mocks.preview.mockResolvedValue({ success: true, preview: buildReportPeerCoveragePreview({
    hasSelectedInstitution: true,
    selectedFees: [{ fee_name: "Wire", fee_category: "wire_transfer", amount: 35, review_status: "approved" }],
    indexEntries: [{ fee_category: "wire_transfer", median_amount: 30, p25_amount: 20, p75_amount: 40, institution_count: 20, maturity_tier: "strong" }],
    evidencePolicy: "provisional-first", peerBaselineSource: "national", peerBaselineLabel: "Original Space Coast baseline",
    peerFallbackReason: null, pipelineFeeCount: 0,
  }) });
  mocks.generate.mockResolvedValue({ success: true, reportId: "saved-space-coast", report: savedReport, artifactMetadata: metadata });
});
afterEach(cleanup);

function selectPeerReport() {
  fireEvent.click(screen.getByRole("radio", { name: /How the research institution's fees compare with peers/ }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Reports page canonical research context", () => {
  it("passes an explicit URL subject through coverage, generation and saved display without making it the default", async () => {
    render(await ReportsPage({ searchParams: Promise.resolve({ intent: "peer_benchmarking", instId: "8109" }) }));
    selectPeerReport();
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 8109 })));
    fireEvent.click(screen.getByRole("button", { name: "Write the report for your team" }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      institutionId: 8109, selectedInstitutionName: "Space Coast Credit Union", selectedSource: "url",
    })));
    expect(await screen.findByRole("heading", { name: savedReport.title })).toBeInTheDocument();
    expect(screen.getByText("Account institution: Not linked")).toBeInTheDocument();
    expect(screen.getByText(/Peer baseline: Original Space Coast baseline/)).toBeInTheDocument();
    expect(mocks.institution).toHaveBeenCalledWith(8109);
    expect(mocks.sql.mock.calls.every(([parts]) => !parts.join("").includes("INSERT"))).toBe(true);
  });

  it("does not label a profile name as a research subject or allow an unscoped institution report", async () => {
    render(await ReportsPage({ searchParams: Promise.resolve({ intent: "peer_benchmarking" }) }));
    selectPeerReport();
    expect(screen.getAllByText("No research institution selected").length).toBeGreaterThan(0);
    expect(screen.queryByText("Space Coast Credit Union")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write the report for your team" })).toBeDisabled();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("starts a fresh builder when URL research changes from Space Coast to Addition", async () => {
    const view = render(await ReportsPage({ searchParams: Promise.resolve({ intent: "peer_benchmarking", instId: "8109" }) }));
    selectPeerReport();
    fireEvent.click(screen.getByRole("button", { name: "Write the report for your team" }));
    await screen.findByRole("heading", { name: savedReport.title });
    view.rerender(await ReportsPage({ searchParams: Promise.resolve({ intent: "peer_benchmarking", instId: "2945" }) }));
    expect(screen.queryByRole("heading", { name: savedReport.title })).not.toBeInTheDocument();
    selectPeerReport();
    await waitFor(() => expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({ institutionId: 2945 })));
    expect(screen.getByRole("button", { name: "Write the report for your team" })).toBeEnabled();
  });

  it("reopens the authorized saved Space Coast report independently of an Addition URL/default", async () => {
    mocks.sql.mockResolvedValue([{ user_id: 7, selected_institution_id: 2945, selected_source: "manual" }]);
    mocks.report.mockResolvedValue({ id: "saved-space-coast", institution_id: "8109", report_type: "peer_benchmarking", report_json: JSON.parse(JSON.stringify(savedReport)), artifact_metadata: metadata });
    const page = await ReportsPage({ searchParams: Promise.resolve({ report_id: "saved-space-coast", instId: "2945" }) });
    render(page);
    expect(mocks.report).toHaveBeenCalledWith("saved-space-coast", 7);
    expect(screen.queryByText("Addition Financial Credit Union")).not.toBeInTheDocument();
    expect(screen.getByText("Research institution: Space Coast Credit Union")).toBeInTheDocument();
    expect(screen.getByText(/Peer baseline: Original Space Coast baseline/)).toBeInTheDocument();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("does not turn an unavailable private report into a new report for today's subject", async () => {
    render(await ReportsPage({ searchParams: Promise.resolve({ report_id: "unavailable-private-report", instId: "2945" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Saved report not found or unavailable.");
    expect(mocks.report).toHaveBeenCalledWith("unavailable-private-report", 7);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("ignores Space Coast's delayed coverage after Addition has received its own coverage", async () => {
    const originalPreview = (await mocks.preview()).preview;
    mocks.preview.mockClear();
    const oldCoverage = deferred<{ success: true; preview: typeof originalPreview }>();
    mocks.preview.mockReturnValueOnce(oldCoverage.promise).mockResolvedValue({
      success: true, preview: { ...originalPreview, peerBaselineLabel: "Addition cohort" },
    });
    const view = render(await ReportsPage({ searchParams: Promise.resolve({ intent: "peer_benchmarking", instId: "8109" }) }));
    selectPeerReport();
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
    view.rerender(await ReportsPage({ searchParams: Promise.resolve({ intent: "peer_benchmarking", instId: "2945" }) }));
    selectPeerReport();
    await screen.findByText("Addition cohort");
    await act(async () => oldCoverage.resolve({
      success: true, preview: { ...originalPreview, peerBaselineLabel: "Delayed Space Coast cohort" },
    }));
    expect(screen.getByText("Addition cohort")).toBeInTheDocument();
    expect(screen.queryByText("Delayed Space Coast cohort")).not.toBeInTheDocument();
    expect(mocks.preview.mock.calls.map(([params]) => params.institutionId)).toEqual([8109, 2945]);
  });

  it.each(["while Addition is writing", "after Addition is saved"])("isolates delayed Space Coast generation %s", async (timing) => {
    type Generation = { success: true; reportId: string; report: ReportSummaryResponse; artifactMetadata: ReportArtifactMetadata };
    const oldGeneration = deferred<Generation>();
    const newGeneration = deferred<Generation>();
    const additionReport: ReportSummaryResponse = {
      ...savedReport, title: "Addition Financial Credit Union fee report",
      identityContext: { ...savedReport.identityContext!, researchInstitutionId: 2945,
        researchInstitutionName: "Addition Financial Credit Union", peerBaselineLabel: "Addition cohort" },
    };
    const oldResult: Generation = { success: true, reportId: "saved-space-coast", report: savedReport, artifactMetadata: metadata };
    const newResult: Generation = { success: true, reportId: "saved-addition", report: additionReport,
      artifactMetadata: { ...metadata, peerBaselineLabel: "Addition cohort" } };
    mocks.generate.mockReturnValueOnce(oldGeneration.promise).mockReturnValueOnce(newGeneration.promise);
    const view = render(await ReportsPage({ searchParams: Promise.resolve({ intent: "peer_benchmarking", instId: "8109" }) }));
    selectPeerReport();
    fireEvent.click(screen.getByRole("button", { name: "Write the report for your team" }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    view.rerender(await ReportsPage({ searchParams: Promise.resolve({ intent: "peer_benchmarking", instId: "2945" }) }));
    selectPeerReport();
    fireEvent.click(screen.getByRole("button", { name: "Write the report for your team" }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));
    if (timing === "after Addition is saved") {
      await act(async () => newGeneration.resolve(newResult));
      expect(screen.getByRole("heading", { name: additionReport.title })).toBeInTheDocument();
    }
    await act(async () => oldGeneration.resolve(oldResult));
    expect(screen.queryByRole("heading", { name: savedReport.title })).not.toBeInTheDocument();
    if (timing === "while Addition is writing") {
      expect(screen.getByRole("button", { name: "Writing the report…" })).toBeDisabled();
      await act(async () => newGeneration.resolve(newResult));
    }
    expect(screen.getByRole("heading", { name: additionReport.title })).toBeInTheDocument();
    expect(mocks.generate.mock.calls.map(([params]) => params.institutionId)).toEqual([8109, 2945]);
  });
});
