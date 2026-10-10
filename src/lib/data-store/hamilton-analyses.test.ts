import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./connection", () => ({ sql: db.query }));

import { getSavedAnalysisResponse } from "./hamilton-analyses";

const legacy = {
  title: "Legacy",
  confidence: { level: "high", basis: ["Old matcher"] },
  hamiltonView: "Synthetic.",
  whatThisMeans: "",
  whyItMatters: [],
  evidence: { metrics: [] },
  exploreFurther: [],
};

beforeEach(() => db.query.mockReset());

describe("saved Hamilton analysis compatibility read", () => {
  it("returns null for a missing or inaccessible saved row", async () => {
    db.query.mockResolvedValueOnce([]);
    expect(await getSavedAnalysisResponse(7, "missing")).toBeNull();
  });

  it("downgrades a legacy high rating from a JSON string without rewriting storage", async () => {
    db.query.mockResolvedValueOnce([{ response_json: JSON.stringify(legacy) }]);
    const response = await getSavedAnalysisResponse(7, "legacy");
    expect(response?.confidence.level).toBe("medium");
    expect(response?.confidence.basis.join(" ")).toContain("predates record-bound");
    expect(legacy.confidence.level).toBe("high");
  });

  it("also normalizes already-parsed JSONB objects", async () => {
    db.query.mockResolvedValueOnce([{ response_json: legacy }]);
    expect((await getSavedAnalysisResponse(7, "legacy"))?.confidence.level).toBe("medium");
  });

  it("never treats an attached but empty evidence contract as claim verification", async () => {
    const stored = {
      ...legacy,
      factEvidence: { version: 1, generatedAt: "2026-10-10T00:00:00Z", facts: [], derivations: [], limitations: [] },
    };
    db.query.mockResolvedValueOnce([{ response_json: stored }]);
    const displayed = await getSavedAnalysisResponse(7, "new");
    expect(displayed?.confidence.level).toBe("medium");
    expect(displayed?.confidence.basis.join(" ")).toContain("does not by itself verify every sentence");
    expect(stored.confidence.level).toBe("high");
  });
});
