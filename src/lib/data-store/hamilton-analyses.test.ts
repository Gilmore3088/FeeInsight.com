import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { sql } from "./connection";
import { getSavedAnalysisResponse } from "./hamilton-analyses";

const mockSql = vi.mocked(sql);
const legacy = {
  title: "Legacy",
  confidence: { level: "high", basis: ["Old matcher"] },
  hamiltonView: "Synthetic.",
  whatThisMeans: "",
  whyItMatters: [],
  evidence: { metrics: [] },
  exploreFurther: [],
};

beforeEach(() => mockSql.mockReset());

describe("saved Hamilton analysis compatibility read", () => {
  it("returns null for a missing or inaccessible saved row", async () => {
    mockSql.mockResolvedValueOnce([] as never);
    expect(await getSavedAnalysisResponse(7, "missing")).toBeNull();
  });

  it("downgrades a legacy high rating from a JSON string without rewriting storage", async () => {
    mockSql.mockResolvedValueOnce([{ response_json: JSON.stringify(legacy) }] as never);
    const response = await getSavedAnalysisResponse(7, "legacy");
    expect(response?.confidence.level).toBe("medium");
    expect(response?.confidence.basis.join(" ")).toContain("predates record-bound");
    expect(legacy.confidence.level).toBe("high");
  });

  it("also normalizes already-parsed JSONB objects", async () => {
    mockSql.mockResolvedValueOnce([{ response_json: legacy }] as never);
    expect((await getSavedAnalysisResponse(7, "legacy"))?.confidence.level).toBe("medium");
  });

  it("preserves high only when the stored artifact carries the new evidence contract", async () => {
    mockSql.mockResolvedValueOnce([{
      response_json: {
        ...legacy,
        factEvidence: { version: 1, generatedAt: "2026-10-10T00:00:00Z", facts: [], derivations: [], limitations: [] },
      },
    }] as never);
    expect((await getSavedAnalysisResponse(7, "new"))?.confidence.level).toBe("high");
  });
});
