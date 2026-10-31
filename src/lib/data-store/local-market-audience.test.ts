import { beforeEach, describe, expect, it, vi } from "vitest";
import { countedRepresentatives, holdingCompanySql, institutionValueSql, peerRowFilter } from "@/lib/data-store/fee-stats";
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
  const competitor = (institution_id: number, institution_name: string, amount: string) => ({
    institution_id, institution_name, charter_type: "bank", deposits: 100, fee_category: "nsf", amount,
    lines: JSON.stringify([{ fee_name: "NSF", amount: Number(amount) }]), document_url: null, document_date: null,
  });
  const linkRow = (institution_id: number, schedule_group: string, url: string) => ({ institution_id, fee_category: "nsf", schedule_keys: [`u:${url}`], schedule_group });

  it("marks the charters that share one fee schedule under the lowest charter id, per fee", async () => {
    // The Laredo shape with invented amounts and addresses: three charters of one holding company read
    // the same schedule; a fourth institution in the market has its own.
    state.replies.push([{ city: "LAREDO" }], [{ county_fips: 48479, year: 2026 }], [
      competitor(160, "First Example Bank Laredo", "30"),
      competitor(1319, "Sample Trust Laredo", "30"),
      competitor(1769, "First Example Bank Zapata", "30"),
      competitor(50, "Other Bank", "25"),
    ], [
      linkRow(160, "1", "example.org/shared.pdf"),
      linkRow(1319, "1", "example.org/shared.pdf"),
      linkRow(1769, "1", "example.org/shared.pdf"),
    ]);
    const result = await getLocalMarketCompetitors({ institutionId: 47, certNumber: null, city: "Laredo", stateCode: "TX", categories: ["nsf"] });
    const byId = new Map(result?.competitors.map((c) => [c.institution_id, c]));
    expect(byId.size).toBe(4);
    expect(byId.get(160)?.counted_as).toBeUndefined();
    expect(byId.get(1319)?.counted_as).toEqual({ nsf: 160 });
    expect(byId.get(1769)?.counted_as).toEqual({ nsf: 160 });
    expect(byId.get(50)?.counted_as).toBeUndefined();
  });

  it("picks the representative over the whole holding company, as the workspace's national read does", async () => {
    // A chain: 160 and 1769 share no schedule address, but sister charter 1319 publishes both
    // addresses. 1319 has no branch in this market, so the market's own rows never link 160 and
    // 1769; the national peer read sees 1319 and counts the three charters once, under 160.
    state.replies.push([{ city: "LAREDO" }], [{ county_fips: 48479, year: 2026 }], [
      competitor(160, "First Example Bank Laredo", "30"),
      competitor(1769, "First Example Bank Zapata", "32"),
      competitor(50, "Other Bank", "25"),
    ], [
      linkRow(160, "1", "example.org/one.pdf"),
      linkRow(1319, "1", "example.org/one.pdf"),
      linkRow(1319, "1", "example.org/two.pdf"),
      linkRow(1769, "1", "example.org/two.pdf"),
    ]);
    const result = await getLocalMarketCompetitors({ institutionId: 47, certNumber: null, city: "Laredo", stateCode: "TX", categories: ["nsf"] });
    const byId = new Map(result?.competitors.map((c) => [c.institution_id, c]));
    expect(byId.get(160)?.counted_as).toBeUndefined();
    expect(byId.get(1769)?.counted_as).toEqual({ nsf: 160 });
    expect(byId.get(50)?.counted_as).toBeUndefined();
    // The market's rows alone (the old rule) leave the two charters unlinked: that is the drift.
    const marketOnly = countedRepresentatives([linkRow(160, "1", "example.org/one.pdf"), linkRow(1769, "1", "example.org/two.pdf")]);
    expect(marketOnly?.get(1769)).toBe(1769);
    // The linking read is every charter of the competitors' holding companies, under the peer read's row filter, the subject left out.
    const query = state.queries[3];
    expect(query).toContain(peerRowFilter("ef", "ct"));
    expect(query).toContain(`${holdingCompanySql("ct")} IN (`);
    expect(query).toContain("ef.institution_id <> 47");
    expect(query).toContain("AS schedule_keys");
    expect(query).toContain("AS schedule_group");
  });

  it("does not link anything without the holding company read", async () => {
    state.replies.push([{ city: "LAREDO" }], [{ county_fips: 48479, year: 2026 }], [competitor(160, "First Example Bank Laredo", "30"), competitor(1319, "Sample Trust Laredo", "30")], []);
    const result = await getLocalMarketCompetitors({ institutionId: 47, certNumber: null, city: "Laredo", stateCode: "TX", categories: ["nsf"] });
    expect(result?.competitors.every((c) => c.counted_as === undefined)).toBe(true);
  });
});
