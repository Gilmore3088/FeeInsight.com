/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readSavedAnalysisRecord: vi.fn(), getInstitutionOwnFees: vi.fn() }));
vi.mock("./saved-analysis-record", () => ({ readSavedAnalysisRecord: mocks.readSavedAnalysisRecord }));
vi.mock("@/lib/data-store/fee-index", () => ({ getInstitutionOwnFees: mocks.getInstitutionOwnFees }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: vi.fn() }));
vi.mock("./peer-index", () => ({ resolveHamiltonPeerIndex: vi.fn() }));

import { authenticatedReportFindings, boardBriefFindings, reportAddedFindings } from "./report-findings";

const SAVED = "11111111-2222-3333-4444-555555555555";
const OTHER = "22222222-3333-4444-5555-666666666666";
const peers = {
  entries: [{ fee_category: "nsf", fee_family: null, median_amount: 30, p25_amount: 25, p75_amount: 34, min_amount: 10, max_amount: 40, institution_count: 12, observation_count: 12, approved_count: 12, bank_count: 0, cu_count: 12, maturity_tier: "strong" as const, last_updated: "2026-10-12" }],
  label: "Similar credit unions",
  institutionName: "Lakeshore Test Credit Union",
};
const now = new Date("2026-10-25T12:00:00Z");

beforeEach(() => {
  mocks.readSavedAnalysisRecord.mockReset();
  mocks.getInstitutionOwnFees.mockReset();
  mocks.getInstitutionOwnFees.mockResolvedValue(new Map([["nsf", { category: "nsf", value: 27, price: 27, low: 27, high: 27, fees: [{ name: "NSF", amount: 27 }] }]]));
  mocks.readSavedAnalysisRecord.mockImplementation(async (id: string) => id === OTHER ? {
    id: OTHER,
    institutionId: "9701001",
    savedAt: "2026-10-20T09:00:00.000Z",
    responseJson: {
      title: "Overdraft at Lakeshore",
      confidence: { level: "medium", basis: ["Published schedule"] },
      hamiltonView: "Lakeshore charges $32 for an overdraft.",
      whatThisMeans: "",
      whyItMatters: [],
      evidence: { metrics: [{ label: "Overdraft fee", value: "$32" }] },
      exploreFurther: [],
    },
  } : null);
});

describe("added findings as a report reads them (#1899)", () => {
  it("rewrites a Position finding from the server's read; the browser's figures never reach the report", async () => {
    const [finding] = await authenticatedReportFindings(
      [{ id: "p1", source: "Position", title: "NSF: $99 against $1", detail: "Peers charge $1.", feeCategory: "nsf", institutionId: "9701001" }],
      "9701001", peers, { now },
    );
    expect(finding.title).toBe("NSF / Returned Item: $27.00 against a peer group median of $30.00");
    expect(JSON.stringify(finding)).not.toContain("$99");
    expect(finding.evidence?.chart).toMatchObject({ subject: 27, median: 30, peerCount: 12 });
    expect(mocks.getInstitutionOwnFees).toHaveBeenCalledWith(9701001, ["nsf"]);
  });

  it("carries a saved answer's evidence and leaves out an Ask finding with no saved answer", async () => {
    const found = await authenticatedReportFindings([
      { id: "a1", source: "Ask", title: "Browser title", detail: "Browser $5", institutionId: "9701001", savedAnalysisId: OTHER },
      { id: "a2", source: "Ask", title: "Unsaved", detail: "Browser $6", institutionId: "9701001" },
    ], "9701001", peers, { now });
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe("Overdraft at Lakeshore");
    expect(found[0].evidence?.figures).toEqual([{ label: "Overdraft fee", value: "$32" }]);
    expect(found[0].evidence?.dates).toBe("Answer saved Oct 20, 2026. Figures are as saved and were not refreshed.");
  });

  it("leaves out another institution's finding and a Position finding with nothing to re-read", async () => {
    const found = await authenticatedReportFindings([
      { id: "x", source: "Position", title: "Other bank", detail: "", feeCategory: "nsf", institutionId: "123" },
      { id: "y", source: "Position", title: "No category", detail: "", institutionId: "9701001" },
    ], "9701001", peers, { now });
    expect(found).toEqual([]);
  });

  it("a board brief leaves out its own answer and re-reads Test findings against the institution's peers", async () => {
    const loadPeers = vi.fn(async () => peers);
    const found = await boardBriefFindings([
      { id: "self", source: "Ask", title: "This brief", detail: "", institutionId: "9701001", savedAnalysisId: SAVED },
      { id: "t1", source: "Test", title: "NSF: $27 to $32", detail: "browser", feeCategory: "nsf", institutionId: "9701001", proposedFee: 32 },
    ], { analysisId: SAVED, institutionId: "9701001", userId: 9 }, { now, loadPeers });
    expect(loadPeers).toHaveBeenCalledWith(9701001);
    expect(found.map((f) => f.id)).toEqual(["t1"]);
    expect(found[0].title).toBe("NSF / Returned Item: test of $32.00 against a current published fee of $27.00");
    const [stored] = reportAddedFindings(found, false);
    expect(stored).toMatchObject({ source: "Test", evidence: { chart: { subject: 32, current: 27 } } });
    expect(stored).not.toHaveProperty("savedClaims");
  });

  it("a board brief with no basket reads nothing", async () => {
    const loadPeers = vi.fn();
    expect(await boardBriefFindings(undefined, { analysisId: SAVED, institutionId: "9701001", userId: 9 }, { loadPeers })).toEqual([]);
    expect(loadPeers).not.toHaveBeenCalled();
    expect(mocks.getInstitutionOwnFees).not.toHaveBeenCalled();
  });
});
