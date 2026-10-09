import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ queries: [] as string[], replies: [] as unknown[][] }));
vi.mock("./connection", () => {
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(parts.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ""), ""));
    return state.replies.shift() ?? [];
  }), { unsafe: vi.fn((text: string) => text) });
  return { sql, getSql: () => sql };
});
import { getCustomReportMarketData } from "./custom-report-market";

beforeEach(() => { state.queries.length = 0; state.replies.length = 0; });

describe("competitive report consumer boundary", () => {
  it("applies audience/source eligibility before source validation without weakening cap or price guards", async () => {
    state.replies.push(
      [{ id: 47, institution_name: "Test Subject", city: "Nashville", state_code: "TN", charter_type: "bank", cert_number: "123", asset_size: null }],
      [{ county_fips: "47037", city: "Nashville", state: "TN", year: 2026, basis: "branch_counties" }],
      [{ institution_id: 50, institution_name: "Test Peer", city: "Nashville", state_code: "TN", charter_type: "bank", market_deposits: "100", line: null, amount: null, fee_name: null, source_url: null, source_document_id: null, updated_at: null, takedown_pending: null }],
    );
    const result = await getCustomReportMarketData(47);
    const query = state.queries.find((text) => text.includes("FROM published_fee_catalog c"));
    expect(query).toContain("c.source_document_id IS NOT NULL");
    expect(query).toContain("c.fee_audience IN ('consumer', 'both')");
    expect(query).toContain("COALESCE(c.is_fee_cap, false) = false");
    expect(query).toContain("c.fee_name ~* r.inc AND c.fee_name !~* r.exc");
    expect(query).toContain("c.amount = 0 AND r.allow_zero");
    expect(query).toContain("pf.kind = 'takedown_pending'");
    expect(result?.lines).toEqual([]);
    expect(result?.competitors[0].market_deposits).toBe(100000);
    expect(state.queries).toHaveLength(3); // No alternate institution document is fetched to invent missing fees.
  });
});
