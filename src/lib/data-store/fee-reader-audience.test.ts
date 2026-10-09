import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("./connection", () => {
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(parts.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ""), ""));
    return [];
  }), { unsafe: vi.fn((text: string, params?: unknown[]) => {
    if (params) { state.queries.push(text); return Promise.resolve([]); }
    return text;
  }) });
  return { sql, getSql: () => sql };
});
import { getCheapestAndMostExpensive, getFeeCategoryDetail, getRecentPriceChanges, getPriceMovementSummary, getAuditTrail, getFeeHistory } from "./fees";
import { consumerPriceMoveSql } from "./consumer-price-moves";

beforeEach(() => { state.queries.length = 0; });

function expectMoveBoundary(query: string) {
  expect(query).toContain("like_for_like IS TRUE");
  expect(query).toContain("FROM published_fee_catalog consumer_live");
  expect(query).toContain("consumer_live.fee_audience IN ('consumer', 'both')");
  expect(query).toContain("consumer_previous.fee_audience = consumer_live.fee_audience");
  expect(query).toContain("consumer_previous.quarantined_at IS NULL");
  expect(query).toContain("previous_fee_published_id");
  expect(query).toContain("pending.kind = 'takedown_pending'");
}

describe("public fee reader applicability", () => {
  it("filters both extremes and category observations through the same consumer boundary", async () => {
    await getCheapestAndMostExpensive("nsf");
    await getFeeCategoryDetail("nsf");
    const queries = state.queries.filter((text) => text.includes("FROM published_fee_catalog ef"));
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query).toContain("ef.source_document_id IS NOT NULL");
      expect(query).toContain("ef.fee_audience IN ('consumer', 'both')");
      expect(query).toContain("ef.amount >= 0");
      expect(query).not.toContain("ef.amount > 0");
    }
    expectMoveBoundary(state.queries[3]);
  });

  it("requires a live same-audience publication pair for both movement APIs", async () => {
    await getRecentPriceChanges(90, "nsf");
    await getPriceMovementSummary(90);
    expect(state.queries).toHaveLength(2);
    for (const query of state.queries) expectMoveBoundary(query);
    expect(state.queries[0]).toContain("fce.fee_category = $2");
    expect(() => consumerPriceMoveSql("x; DROP TABLE fees")).toThrow("Invalid price-move table alias");
  });

  it("does not erase audit and institution snapshot history with a comparison filter", async () => {
    await getAuditTrail(97662);
    await getFeeHistory(47, "nsf");
    expect(state.queries[0]).toContain("FROM fee_reviews");
    expect(state.queries[1]).toContain("FROM institution_fee_snapshot_records");
    for (const query of state.queries) expect(query).not.toContain("fee_audience IN");
  });
});
