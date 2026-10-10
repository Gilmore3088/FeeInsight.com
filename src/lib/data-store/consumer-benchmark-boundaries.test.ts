import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as string[], sample: 4 }));
vi.mock("./connection", () => {
  const sql = Object.assign(
    vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.reduce((s, part, index) => s + part + (index < values.length ? String(values[index]) : ""), "");
      state.queries.push(text);
      if (text.includes("FROM institution_sources WHERE id")) return [{ id: 47, institution_name: "Pinnacle Bank", state_code: "TN", charter_type: "bank", asset_size_tier: "regional" }];
      if (text.includes("SELECT DISTINCT ON (ef.fee_category)")) return [{ fee_category: "nsf", source_url: "https://example.test/consumer-source" }];
      return [];
    }),
    { unsafe: vi.fn((text: string) => text) },
  );
  return { sql, getSql: () => sql };
});
vi.mock("./custom-report-market", () => ({ getLocalMarketMembers: vi.fn(async () => null) }));
vi.mock("./fee-index", () => ({
  getInstitutionFeeValues: vi.fn(async () => new Map([["nsf", 0]])),
  getFeeValuesForInstitutions: vi.fn(async () => new Map()),
  getPeerIndexes: vi.fn(async () => Array.from({ length: 3 }, () => [{ fee_category: "nsf", institution_count: state.sample, median_amount: 30, p25_amount: 25, p75_amount: 35 }])),
}));
vi.mock("./regulatory-watch", () => ({ marketMediansFrom: vi.fn(() => new Map([["nsf", { count: state.sample, median: 30 }]])) }));

import { getInstitutionBenchmark, BENCHMARK_MIN_INSTITUTIONS } from "./benchmark-export";
import { getRateFeesByInstitution } from "./rate-fees";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "./fee-stats";

beforeEach(() => { state.queries.length = 0; state.sample = 4; });

function requireConsumer(query: string | undefined) {
  expect(query).toBeDefined();
  expect(query).toContain("ef.source_document_id IS NOT NULL");
  expect(query).toContain("ef.fee_audience IN ('consumer', 'both')");
  expect(query).not.toContain("ef.amount > 0");
}

describe("consumer benchmark evidence boundaries", () => {
  it("selects consumer source links and rate observations, not just consumer dollar amounts", async () => {
    const result = await getInstitutionBenchmark(47);
    requireConsumer(state.queries.find((text) => text.includes("SELECT DISTINCT ON (ef.fee_category)")));
    requireConsumer(state.queries.find((text) => text.includes("FROM published_fee_rate_catalog")));
    expect(result?.rows[0]).toMatchObject({ amount: 0, source_url: "https://example.test/consumer-source" });
  });

  it("preserves thin sample counts without displaying medians or a price position", async () => {
    expect(BENCHMARK_MIN_INSTITUTIONS).toBe(MIN_INSTITUTIONS_FOR_MEDIAN);
    const row = (await getInstitutionBenchmark(47))?.rows[0];
    expect(row).toMatchObject({ national: { institutions: 4, median: null, p25: null, p75: null }, local_market: { institutions: 4, median: null }, position: null });
    state.sample = 5;
    expect((await getInstitutionBenchmark(47))?.rows[0]).toMatchObject({ national: { institutions: 5, median: 30 }, local_market: { institutions: 5, median: 30 } });
  });

  it("keeps labeled business rate evidence available on institution pages", async () => {
    await getRateFeesByInstitution(47);
    const query = state.queries[0];
    expect(query).toContain("ef.fee_audience");
    expect(query).toContain("AND TRUE");
    expect(query).not.toContain("fee_audience IN");
    state.queries.length = 0;
    await getRateFeesByInstitution(47, "consumer");
    requireConsumer(state.queries[0]);
  });
});
