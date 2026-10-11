import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as string[] }));

vi.mock("./connection", () => {
  const sql = Object.assign(
    vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.reduce(
        (out, part, index) => out + part + (index < values.length ? String(values[index]) : ""),
        "",
      );
      state.queries.push(text);
      if (text.includes("SELECT MAX(year) AS y")) return [{ y: 2026 }];
      return [];
    }),
    { unsafe: vi.fn((text: string) => text) },
  );
  return { sql, getSql: () => sql };
});

import { getCountyFeeMap, getStateVisualsData } from "./state-visuals";

beforeEach(() => {
  state.queries.length = 0;
});

function expectConsumerEvidence(query: string) {
  expect(query).toContain("source_document_id IS NOT NULL");
  expect(query).toContain("fee_audience IN ('consumer', 'both')");
  expect(query).toContain("amount >= 0");
  expect(query).not.toContain("amount > 0");
}

describe("state fee visual audience boundaries", () => {
  it("keeps a real zero in county coverage and uses the highest overdraft tier", async () => {
    await getCountyFeeMap("TN", "overdraft");

    const feeQueries = state.queries.filter((query) => query.includes("FROM published_fee_catalog"));
    expect(feeQueries).toHaveLength(2);
    for (const query of feeQueries) expectConsumerEvidence(query);
    for (const query of feeQueries) {
      expect(query).toContain("THEN MAX(ef.amount)");
      expect(query).toContain("percentile_cont(0.5)");
    }
  });

  it("uses the same consumer contract for state dots, county weighting and top deposit holders", async () => {
    await getStateVisualsData("TN");

    const feeQueries = state.queries.filter((query) => query.includes("FROM published_fee_catalog"));
    expect(feeQueries.length).toBeGreaterThanOrEqual(3);
    for (const query of feeQueries) expectConsumerEvidence(query);
    expect(feeQueries.some((query) => query.includes("THEN MAX(f.amount)"))).toBe(true);
    expect(feeQueries.some((query) => query.includes("MAX(ef.amount) AS amt"))).toBe(true);
  });
});
