import { saveAnalysis, loadAnalysisRecord } from "@/app/pro/(hamilton)/analyze/actions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeResponse } from "@/lib/hamilton/types";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  canAccessPremium: vi.fn(),
  sql: vi.fn(),
  getInstitutionById: vi.fn(),
  loadHamiltonAccountContext: vi.fn(),
}));

vi.mock("@/lib/data-store", () => ({ getInstitutionById: mocks.getInstitutionById }));
vi.mock("@/lib/hamilton/account-context-store", () => ({ loadHamiltonAccountContext: mocks.loadHamiltonAccountContext }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/access", () => ({
  canAccessPremium: mocks.canAccessPremium,
}));

vi.mock("@/lib/data-store/connection", () => ({
  sql: mocks.sql,
}));

const responseJson: AnalyzeResponse = {
  title: "Wire fee position",
  confidence: { level: "medium", basis: [] },
  hamiltonView: "The $35 wire fee is provisional.",
  whatThisMeans: "Treat this as directional until approval.",
  whyItMatters: ["Provisional rows are excluded from verified scoring."],
  evidence: { metrics: [{ label: "Wire fee", value: "$35 provisional" }] },
  exploreFurther: ["Validate the source document."],
};

function saveParams(institutionId: string) {
  return {
    institutionId,
    analysisFocus: "Peer Compare",
    prompt: "Analyze wire fees",
    responseJson,
  };
}

describe("Analyze saveAnalysis", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7, role: "premium" });
    mocks.canAccessPremium.mockReturnValue(true);
    mocks.sql.mockResolvedValue([{ id: "analysis-1" }]);
    mocks.getInstitutionById.mockResolvedValue({ id: 2945, institution_name: "Research Bank A" });
    mocks.loadHamiltonAccountContext.mockResolvedValue({ status: "identified", institution: { id: 101, name: "Space Coast CU" }, profileLabel: null });
  });

  it("persists canonical numeric selected institution IDs", async () => {

    const result = await saveAnalysis(saveParams(" 2945 "));

    expect(result).toEqual({ id: "analysis-1" });
    expect(mocks.sql.mock.calls[0][2]).toBe("2945");
  });

  it("does not persist profile-name slugs as institution identity", async () => {

    const result = await saveAnalysis(saveParams("first-national-bank"));

    expect(result).toEqual({ id: "analysis-1" });
    expect(mocks.sql.mock.calls[0][2]).toBe("");
  });

  it("rebuilds fallback account identity on the server and labels save-time context", async () => {
    const forged = { version: 1 as const, researchInstitutionId: 999, accountInstitutionId: 999, accountStatus: "identified" as const, accountInstitutionName: "Forged Account", peerBaselineLabel: "Today's wrong cohort" };
    await saveAnalysis({ ...saveParams("2945"), responseJson: { ...responseJson, identityContext: forged } });
    const stored = JSON.parse(mocks.sql.mock.calls[0][6]) as AnalyzeResponse;
    expect(stored.identityContext).toMatchObject({ researchInstitutionId: 2945, researchInstitutionName: "Research Bank A", accountInstitutionId: 101, accountInstitutionName: "Space Coast CU", peerBaselineLabel: null });
    expect(stored.identityContext?.researchSelectionSource).toContain("Captured at save");
    expect(JSON.stringify(stored)).not.toContain("Forged Account");
    expect(JSON.stringify(stored)).not.toContain("Today's wrong cohort");
  });

  it("round-trips historical identity without re-reading current memberships or selection", async () => {
    const identityContext = { version: 1 as const, researchInstitutionId: 2945, accountInstitutionId: 101, accountStatus: "identified" as const, researchInstitutionName: "Research Bank A", accountInstitutionName: "Space Coast CU", peerBaselineLabel: "Original A cohort", peerSetId: 42 };
    const original = { ...responseJson, identityContext };
    mocks.sql.mockResolvedValue([{ id: "saved-a", response_json: JSON.stringify(original), institution_id: "2945", prompt: "Original question", analysis_focus: "Fees" }]);
    mocks.loadHamiltonAccountContext.mockResolvedValue({ status: "identified", institution: { id: 8109, name: "Current Bank B" }, profileLabel: null });
    const record = await loadAnalysisRecord("00000000-0000-0000-0000-000000000001");
    expect(record?.responseJson).toEqual(original);
    expect(record?.institutionId).toBe("2945");
    expect(mocks.loadHamiltonAccountContext).not.toHaveBeenCalled();
    expect(mocks.getInstitutionById).not.toHaveBeenCalled();
    expect(mocks.sql.mock.calls[0]).toContain(7);
  });

  it("loads saved analysis metadata with a canonical institution fallback", async () => {
    mocks.sql.mockResolvedValue([
      {
        response_json: JSON.stringify(responseJson),
        institution_id: "2945",
      },
    ]);

    const result = await loadAnalysisRecord("00000000-0000-0000-0000-000000000001");

    expect(result).toEqual({
      responseJson,
      institutionId: "2945",
    });
  });

  it("does not restore profile-name slugs as saved analysis institution context", async () => {
    mocks.sql.mockResolvedValue([
      {
        response_json: JSON.stringify(responseJson),
        institution_id: "first-national-bank",
      },
    ]);

    const result = await loadAnalysisRecord("00000000-0000-0000-0000-000000000001");

    expect(result).toEqual({
      responseJson,
      institutionId: null,
    });
  });
});
