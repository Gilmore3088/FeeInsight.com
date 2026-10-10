import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ queries: [] as string[], replies: [] as unknown[][] }));
vi.mock("./connection", () => {
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(parts.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ""), ""));
    return state.replies.shift() ?? [];
  }), { unsafe: vi.fn((text: string) => text) });
  return { sql, getSql: () => sql };
});
import { getLocalMarketCompetitors, getLocalFeeMoves } from "./local-market";

beforeEach(() => { state.queries.length = 0; state.replies.length = 0; });

describe("local consumer evidence", () => {
  it("uses sourced consumer observations without dropping zero or averaging down the overdraft tier", async () => {
    state.replies.push([{ county_fips: 47037, year: 2026 }], [{ institution_id: 50, institution_name: "Test Bank", charter_type: "bank", deposits: 100, fee_category: "nsf", amount: "0.00", document_url: null, document_date: null }]);
    const result = await getLocalMarketCompetitors({ institutionId: 47, certNumber: null, city: "Nashville", stateCode: "TN", categories: ["nsf"] });
    expect(result?.competitors[0].fees.nsf).toBe(0);
    expect(result?.basis).toBe("hq_city");
    expect(result?.competitors[0].market_deposits).toBeNull();
    const query = state.queries[1];
    expect(query).toContain("c.source_document_id IS NOT NULL");
    expect(query).toContain("c.fee_audience IN ('consumer', 'both')");
    expect(query).toContain("THEN MAX(c.amount)");
    expect(query).toContain("c.amount >= 0");
    expect(query).not.toContain("c.amount > 0");
  });

  it("does not treat an audience correction or quarantined predecessor as a market move", async () => {
    await getLocalFeeMoves({ institutionIds: [47], categories: ["nsf"] });
    const query = state.queries[0];
    expect(query).toContain("c.like_for_like IS TRUE");
    expect(query).toContain("FROM published_fee_catalog nl");
    expect(query).toContain("nl.source_document_id IS NOT NULL");
    expect(query).toContain("nl.fee_audience IN ('consumer', 'both')");
    expect(query).toContain("previous.fee_audience = nl.fee_audience");
    expect(query).toContain("previous.quarantined_at IS NULL");
    expect(query).toContain("c.previous_fee_published_id");
    expect(query).toContain("pf.kind = 'takedown_pending'");
  });
});
