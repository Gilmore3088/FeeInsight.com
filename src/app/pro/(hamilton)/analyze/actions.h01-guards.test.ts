import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeResponse } from "@/lib/hamilton/types";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  premium: vi.fn(),
  sql: vi.fn(),
  institution: vi.fn(),
  account: vi.fn(),
  snapshot: vi.fn(),
  recent: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.premium }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: mocks.institution }));
vi.mock("@/lib/hamilton/account-context-store", () => ({ loadHamiltonAccountContext: mocks.account }));
vi.mock("@/lib/hamilton/account-context", () => ({ accountIdentitySnapshot: mocks.snapshot }));
vi.mock("@/lib/hamilton/recent-analyses", () => ({ recentQuestions: mocks.recent }));

import { listSavedAnalyses, saveAnalysis } from "./actions";

const analysis = {
  title: "Synthetic research answer",
  confidence: { level: "medium", basis: ["Synthetic"] },
} as AnalyzeResponse;

const saveInput = {
  institutionId: "8109",
  analysisFocus: "Peer Position",
  prompt: "Synthetic research question",
  responseJson: analysis,
};

describe("H01 saved-analysis server action input and error boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: 11, role: "premium", subscription_status: "active" });
    mocks.premium.mockReturnValue(true);
    mocks.institution.mockResolvedValue({ id: 8109, institution_name: "Synthetic Research CU" });
    mocks.account.mockResolvedValue({ status: "unlinked", institution: null });
    mocks.snapshot.mockReturnValue({ version: 1, researchInstitutionId: 8109 });
    mocks.sql.mockResolvedValue([{ id: "saved-synthetic" }]);
    mocks.recent.mockReturnValue([]);
  });

  it("rejects noncanonical explicit subject IDs before institution lookup or saving", async () => {
    for (const institutionId of ["0008109", "8.109e3", "-8", "0", "text-8109", "9007199254740992"]) {
      expect(await saveAnalysis({ ...saveInput, institutionId }))
        .toEqual({ error: "Select a valid research institution." });
    }
    expect(await saveAnalysis({ ...saveInput, institutionId: 8109 as unknown as string }))
      .toEqual({ error: "Select a valid research institution." });
    expect(mocks.institution).not.toHaveBeenCalled();
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("keeps canonical subject identity when saving a valid analysis", async () => {
    expect(await saveAnalysis(saveInput)).toEqual({ id: "saved-synthetic" });
    expect(mocks.institution).toHaveBeenCalledWith(8109);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    expect(mocks.sql.mock.calls[0]).toContain("8109");
    expect(mocks.sql.mock.calls[0]).toContain(11);
  });

  it("files the prompt, not a browser title that states a figure, in the row and the saved response (#1077 defect 8)", async () => {
    const prompt = "How does my overdraft fee compare with peers?";
    await saveAnalysis({ ...saveInput, prompt, responseJson: { ...analysis, title: "Your overdraft fee sits about 21% above the peer median." } });
    const call = mocks.sql.mock.calls[0];
    expect(call[3]).toBe(prompt);
    expect(JSON.parse(call[6] as string).title).toBe(prompt);
  });

  it("keeps a figure-free browser title in the fallback save", async () => {
    await saveAnalysis(saveInput);
    const call = mocks.sql.mock.calls[0];
    expect(call[3]).toBe("Synthetic research answer");
    expect(JSON.parse(call[6] as string).title).toBe("Synthetic research answer");
  });

  it("never discloses driver or database details in a failed saved-analysis response", async () => {
    mocks.sql.mockRejectedValueOnce(new Error("Synthetic private schema: relation hidden_owner_records missing"));
    const result = await saveAnalysis(saveInput);
    expect(result).toEqual({ error: "Could not save this analysis. Please try again." });
    expect(JSON.stringify(result)).not.toContain("hidden_owner_records");
  });

  it("bounds client-controlled history requests while keeping the authenticated user filter", async () => {
    mocks.sql.mockResolvedValue([]);
    await listSavedAnalyses(Number.MAX_SAFE_INTEGER);
    expect(mocks.sql.mock.calls.at(-1)?.slice(1)).toEqual([11, 150]);
    expect(mocks.recent).toHaveBeenLastCalledWith([], 50);
    await listSavedAnalyses(-3);
    expect(mocks.sql.mock.calls.at(-1)?.slice(1)).toEqual([11, 30]);
    expect(mocks.recent).toHaveBeenLastCalledWith([], 10);
    await listSavedAnalyses(3);
    expect(mocks.sql.mock.calls.at(-1)?.slice(1)).toEqual([11, 9]);
    expect(mocks.recent).toHaveBeenLastCalledWith([], 3);
    await listSavedAnalyses(Number.NaN);
    expect(mocks.sql.mock.calls.at(-1)?.slice(1)).toEqual([11, 30]);
  });

  it("does not query private history for a signed-out user", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await listSavedAnalyses(50)).toEqual([]);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
