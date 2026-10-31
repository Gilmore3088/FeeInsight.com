import { beforeEach, describe, expect, it, vi } from "vitest";
import { institutionValueSql } from "@/lib/data-store/fee-stats";
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
    state.replies.push([{ city: "NASHVILLE" }], [{ county_fips: 47037, year: 2026 }], [{ institution_id: 50, institution_name: "Test Bank", charter_type: "bank", deposits: 100, fee_category: "nsf", amount: "0.00", document_url: null, document_date: null }]);
    const result = await getLocalMarketCompetitors({ institutionId: 47, certNumber: null, city: "Nashville", stateCode: "TN", categories: ["nsf"] });
    expect(result?.competitors[0].fees.nsf).toBe(0);
    expect(result?.basis).toBe("hq_city");
    expect(result?.competitors[0].market_deposits).toBeNull();
    const query = state.queries[2];
    expect(query).toContain("c.source_document_id IS NOT NULL");
    expect(query).toContain("c.fee_audience IN ('consumer', 'both', 'unknown')");
    expect(query).toContain(institutionValueSql("c"));
    expect(query).toContain("c.amount >= 0");
    expect(query).not.toContain("c.amount > 0");
  });

  it("does not treat an audience correction or quarantined predecessor as a market move", async () => {
    await getLocalFeeMoves({ institutionIds: [47], categories: ["nsf"] });
    const query = state.queries[0];
    expect(query).toContain("c.like_for_like IS TRUE");
    expect(query).toContain("FROM published_fee_catalog nl");
    expect(query).toContain("nl.source_document_id IS NOT NULL");
    expect(query).toContain("nl.fee_audience IN ('consumer', 'both', 'unknown')");
    expect(query).toContain("previous.fee_audience = nl.fee_audience");
    expect(query).toContain("previous.quarantined_at IS NULL");
    expect(query).toContain("c.previous_fee_published_id");
    expect(query).toContain("pf.kind = 'takedown_pending'");
  });
});

describe("sister charters in the local market (statistics rule 7, #1441)", () => {
  it("marks the charters that share one fee schedule under the lowest charter id, per fee", async () => {
    // The Laredo shape with invented amounts and addresses: three charters of one holding company read
    // the same schedule; a fourth institution in the market has its own.
    const line = (url: string) => JSON.stringify([{ fee_name: "NSF", amount: 30, schedule_keys: [`u:${url}`] }]);
    const row = (institution_id: number, institution_name: string, schedule_group: string, amount: string, url: string) => ({
      institution_id, institution_name, charter_type: "bank", deposits: 100, schedule_group, fee_category: "nsf", amount, lines: line(url), document_url: null, document_date: null,
    });
    state.replies.push([{ city: "LAREDO" }], [{ county_fips: 48479, year: 2026 }], [
      row(160, "IBC Laredo", "1", "30", "example.org/shared.pdf"),
      row(1319, "Commerce Bank Laredo", "1", "30", "example.org/shared.pdf"),
      row(1769, "IBC Zapata", "1", "30", "example.org/shared.pdf"),
      row(50, "Other Bank", "2", "25", "example.org/other.pdf"),
    ]);
    const result = await getLocalMarketCompetitors({ institutionId: 47, certNumber: null, city: "Laredo", stateCode: "TX", categories: ["nsf"] });
    const byId = new Map(result?.competitors.map((c) => [c.institution_id, c]));
    expect(byId.size).toBe(4);
    expect(byId.get(160)?.counted_as).toBeUndefined();
    expect(byId.get(1319)?.counted_as).toEqual({ nsf: 160 });
    expect(byId.get(1769)?.counted_as).toEqual({ nsf: 160 });
    expect(byId.get(50)?.counted_as).toBeUndefined();
    expect(state.queries[2]).toContain("AS schedule_group");
    expect(state.queries[2]).toContain("'schedule_keys'");
  });
});
