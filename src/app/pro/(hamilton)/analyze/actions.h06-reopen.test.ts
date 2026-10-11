import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), sql: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));

import { loadAnalysis } from "./actions";
import { CLAIM_BINDING_LIMITATION, LEGACY_HIGH_CONFIDENCE_LIMITATION } from "@/lib/hamilton/evidence-contract";

const SAVED_ID = "00000000-0000-4000-8000-000000000001";

function storedRow(response: Record<string, unknown>) {
  return [{ id: SAVED_ID, response_json: JSON.stringify(response), institution_id: "8109", analysis_focus: null, prompt: "Synthetic" }];
}

const legacyHigh = {
  title: "Synthetic legacy answer",
  confidence: { level: "high", basis: ["3 figures traced to Hamilton's data"] },
  hamiltonView: "Synthetic.",
  whatThisMeans: "",
  whyItMatters: [],
  evidence: { metrics: [] },
  exploreFurther: [],
};

describe("H06-AC4 reopening a saved answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: 11 });
  });

  it("should_show_legacy_high_confidence_as_medium_with_its_limitation", async () => {
    mocks.sql.mockResolvedValueOnce(storedRow(legacyHigh));
    const reopened = await loadAnalysis(SAVED_ID);
    expect(reopened?.confidence.level).toBe("medium");
    expect(reopened?.confidence.basis).toContain(LEGACY_HIGH_CONFIDENCE_LIMITATION);
    expect(reopened?.confidence.basis).toContain("3 figures traced to Hamilton's data");
  });

  it("should_not_let_an_evidence_bundle_alone_earn_high_confidence", async () => {
    const factEvidence = { version: 1, generatedAt: "2026-10-10T00:00:00Z", facts: [], derivations: [], limitations: [] };
    mocks.sql.mockResolvedValueOnce(storedRow({ ...legacyHigh, factEvidence }));
    const reopened = await loadAnalysis(SAVED_ID);
    expect(reopened?.confidence.level).toBe("medium");
    expect(reopened?.confidence.basis).toContain(CLAIM_BINDING_LIMITATION);
  });

  it("should_leave_medium_and_low_answers_unchanged_and_never_write_storage", async () => {
    const medium = { ...legacyHigh, confidence: { level: "medium", basis: ["Synthetic"] } };
    mocks.sql.mockResolvedValueOnce(storedRow(medium));
    expect((await loadAnalysis(SAVED_ID))?.confidence).toEqual(medium.confidence);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });
});
