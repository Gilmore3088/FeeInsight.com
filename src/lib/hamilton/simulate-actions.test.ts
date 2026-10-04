import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  canAccessPremium: vi.fn(),
  sql: vi.fn(),
  completeHamiltonRefreshJobsForInstitution: vi.fn(),
  resolveHamiltonPeerIndex: vi.fn(),
  getInstitutionById: vi.fn(),
  getInstitutionFeeValues: vi.fn(),
}));

vi.mock("@/lib/data-store/fee-index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/fee-index")>()),
  getInstitutionFeeValues: mocks.getInstitutionFeeValues,
}));

vi.mock("@/lib/hamilton/peer-index", () => ({
  resolveHamiltonPeerIndex: mocks.resolveHamiltonPeerIndex,
}));

vi.mock("@/lib/data-store", () => ({
  getInstitutionById: mocks.getInstitutionById,
}));

function peerIndex(institutionCount: number) {
  return {
    entries: [{
      fee_category: "wire_transfer", median_amount: 30, p25_amount: 25, p75_amount: 35, min_amount: 10, max_amount: 50,
      approved_count: 60, institution_count: institutionCount,
    }],
    label: "National", source: "national", peerSetId: null, fallbackReason: null,
  };
}

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/access", () => ({
  canAccessPremium: mocks.canAccessPremium,
}));

vi.mock("@/lib/data-store/connection", () => ({
  sql: mocks.sql,
}));

vi.mock("@/lib/hamilton/refresh-jobs", () => ({
  completeHamiltonRefreshJobsForInstitution:
    mocks.completeHamiltonRefreshJobsForInstitution,
}));

function scenarioParams(institutionId: string) {
  return {
    institutionId,
    feeCategory: "wire_transfer",
    currentValue: 35,
    proposedValue: 30,
    resultJson: { interpretation: "Test scenario" },
    confidenceTier: "strong" as const,
    evidencePolicy: "verified-only" as const,
  };
}

describe("Simulate actions institution identity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7, role: "premium" });
    mocks.canAccessPremium.mockReturnValue(true);
    mocks.sql.mockResolvedValue([{ id: "scenario-1" }]);
    mocks.completeHamiltonRefreshJobsForInstitution.mockResolvedValue(1);
    mocks.resolveHamiltonPeerIndex.mockResolvedValue(peerIndex(25));
    mocks.getInstitutionById.mockResolvedValue(null);
  });

  it("does not fuzzy-match profile-name slugs when looking up institution fees", async () => {
    const { getInstitutionFee } = await import("@/app/pro/(hamilton)/simulate/actions");

    const result = await getInstitutionFee("first-national-bank", "wire_transfer");

    expect(result).toBeNull();
    expect(mocks.getInstitutionFeeValues).not.toHaveBeenCalled();
  });

  it("looks up institution fees by canonical numeric ID only", async () => {
    const { getInstitutionFee } = await import("@/app/pro/(hamilton)/simulate/actions");
    mocks.getInstitutionFeeValues.mockResolvedValue(new Map([["wire_transfer", 35]]));

    const result = await getInstitutionFee(" 2945 ", "wire_transfer");

    expect(result).toEqual({ amount: 35 });
    expect(mocks.getInstitutionFeeValues).toHaveBeenCalledWith(2945, ["wire_transfer"]);
  });

  it("persists canonical scenario institution IDs and completes matching refresh jobs", async () => {
    const { saveScenario } = await import("@/app/pro/(hamilton)/simulate/actions");

    const result = await saveScenario(scenarioParams("2945"));

    expect(result).toEqual({ id: "scenario-1" });
    expect(mocks.sql.mock.calls[0][2]).toBe("2945");
    expect(mocks.completeHamiltonRefreshJobsForInstitution).toHaveBeenCalledWith({
      institutionId: 2945,
      jobTypes: ["scenario_refresh", "watchlist_review"],
      completedByUserId: 7,
    });
  });

  it("normalizes transient saved-artifact source before persisting a new scenario", async () => {
    const { saveScenario } = await import("@/app/pro/(hamilton)/simulate/actions");

    const result = await saveScenario({
      ...scenarioParams("2945"),
      selectedSource: "artifact",
      selectedSourceLabel: "Saved artifact",
    });

    expect(result).toEqual({ id: "scenario-1" });
    expect(mocks.sql.mock.calls[0][9]).toBe("manual");
    expect(mocks.sql.mock.calls[0][10]).toBe("Manual");
  });

  it("does not persist profile-name slugs as scenario institution identity", async () => {
    const { saveScenario } = await import("@/app/pro/(hamilton)/simulate/actions");

    const result = await saveScenario(scenarioParams("first-national-bank"));

    expect(result).toEqual({ id: "scenario-1" });
    expect(mocks.sql.mock.calls[0][2]).toBe("");
    expect(mocks.completeHamiltonRefreshJobsForInstitution).not.toHaveBeenCalled();
  });

  it("recomputes the confidence tier on the server and ignores the client's value", async () => {
    const { saveScenario } = await import("@/app/pro/(hamilton)/simulate/actions");
    // 60 fee rows but only 3 institutions: insufficient under the statistics contract.
    mocks.resolveHamiltonPeerIndex.mockResolvedValue(peerIndex(3));

    const result = await saveScenario(scenarioParams("2945"));

    expect(result).toMatchObject({ error: expect.stringContaining("5 institutions") });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("returns null when the institution has no published fee in the category", async () => {
    const { getInstitutionFee } = await import("@/app/pro/(hamilton)/simulate/actions");
    mocks.getInstitutionFeeValues.mockResolvedValue(new Map());

    expect(await getInstitutionFee("2945", "wire_transfer")).toBeNull();
  });
});
