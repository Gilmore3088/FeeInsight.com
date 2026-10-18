import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ text: string; values: unknown[] }> = [];
let nextRows: unknown[] = [];

vi.mock("@/lib/data-store/connection", () => {
  const tx = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(strings.join("").includes("SET LOCAL") ? [] : nextRows);
  });
  return { sql: tx, withTransaction: (cb: (db: typeof tx) => Promise<unknown>) => cb(tx) };
});
vi.mock("@/lib/data-store/economy-aggregates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/economy-aggregates")>()),
  getInstitutionHqLocation: vi.fn(),
}));
vi.mock("@/lib/data-store/fee-index", () => ({
  getNationalIndexCached: vi.fn(),
  getStateFeeIndexes: vi.fn(),
  getPeerIndex: vi.fn(),
  getInstitutionFeeRows: vi.fn(),
}));
vi.mock("@/lib/data-store/peer-sets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/peer-sets")>()),
  getPeerSubject: vi.fn(),
  resolvePeerRequest: vi.fn(),
  resolvePeerSet: vi.fn(),
}));

import { getInstitutionHqLocation } from "@/lib/data-store/economy-aggregates";
import { getInstitutionFeeRows, getNationalIndexCached, getPeerIndex, getStateFeeIndexes } from "@/lib/data-store/fee-index";
import { resolvePeerSet } from "@/lib/data-store/peer-sets";
import { QUERY_DATA_MAX_LIMIT, parseMeasure, periodMonths, queryData, queryDataInputSchema } from "./query-data";

const AREA = "area:bls-laus:laus_unemployment_rate";
const queries = () => calls.filter((c) => !c.text.includes("SET LOCAL"));
const lastQuery = () => queries().at(-1)!;

const ENTRY = {
  fee_category: "overdraft", fee_family: "Overdraft & NSF", median_amount: 30, p25_amount: 25, p75_amount: 35,
  min_amount: 10, max_amount: 38, institution_count: 40, observation_count: 60, approved_count: 60, bank_count: 30,
  cu_count: 10, maturity_tier: "strong" as const, last_updated: "2026-10-01",
};

beforeEach(() => {
  calls.length = 0;
  nextRows = [];
  vi.clearAllMocks();
});

describe("queryDataInputSchema", () => {
  it("rejects bad input", () => {
    const bad = [
      { measure: "area:bls-laus", scope: { kind: "national" } },
      { measure: "area:bls-laus:x'; DROP TABLE area_statistics;--", scope: { kind: "national" } },
      { measure: "SELECT 1", scope: { kind: "national" } },
      { measure: AREA, scope: { kind: "state" } },
      { measure: AREA, scope: { kind: "institution", id: "abc" } },
      { measure: AREA, scope: { kind: "peer_set" } },
      { measure: AREA, scope: { kind: "state", id: "TX", peer: { charter_type: "bank" } } },
      { measure: AREA, scope: { kind: "galaxy" } },
      { measure: AREA, scope: { kind: "national" }, extra: true },
      { measure: AREA, scope: { kind: "national" }, period: { from: "last year" } },
      { measure: AREA, scope: { kind: "national" }, limit: QUERY_DATA_MAX_LIMIT + 1 },
      { measure: AREA, scope: { kind: "national" }, limit: 0 },
      { measure: "fee:overdraft", scope: { kind: "peer_set", peer: { asset_min: 5, asset_max: 1 } } },
      { measure: "fee:overdraft", scope: { kind: "peer_set", peer: { sql: "1" } } },
    ];
    for (const input of bad) expect(queryDataInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it("accepts the documented shapes", () => {
    expect(queryDataInputSchema.safeParse({ measure: AREA, scope: { kind: "county", id: "48201" }, period: { from: "2024", to: "2026-09" }, limit: 200 }).success).toBe(true);
    expect(queryDataInputSchema.safeParse({ measure: "fee:overdraft", scope: { kind: "peer_set", id: "12", peer: { charter_type: "same", states: ["TX"] } } }).success).toBe(true);
  });

  it("parses a measure into source and series", () => {
    expect(parseMeasure(AREA)).toEqual({ kind: "area", source: "bls-laus", seriesKey: "laus_unemployment_rate" });
    expect(parseMeasure("fee:overdraft")).toEqual({ kind: "fee", category: "overdraft" });
  });
});

describe("queryData: area measures", () => {
  it("refuses bad input with the schema's reason and runs no SQL", async () => {
    const result = await queryData({ measure: AREA, scope: { kind: "national" }, limit: 500 });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuses a measure the catalog may not show", async () => {
    for (const measure of ["area:national-series:mortgage30", "area:state-bill-news:x", "area:kcfed-sb-lending:x", "area:fdic-sod:x"]) {
      const result = await queryData({ measure, scope: { kind: "national" } });
      expect(result.ok, measure).toBe(false);
      if (!result.ok) expect(result.reason.length, measure).toBeGreaterThan(10);
    }
    expect(calls).toHaveLength(0);
  });

  it("routes each scope to bound geo pairs, never into the SQL text", async () => {
    await queryData({ measure: AREA, scope: { kind: "national" } });
    expect(lastQuery().values.slice(0, 2)).toEqual([["nation"], ["US"]]);
    await queryData({ measure: AREA, scope: { kind: "state", id: "tx" } });
    expect(lastQuery().values.slice(0, 2)).toEqual([["state"], ["TX"]]);
    await queryData({ measure: AREA, scope: { kind: "county", id: "1001" } });
    expect(lastQuery().values.slice(0, 2)).toEqual([["county"], ["01001"]]);

    vi.mocked(getInstitutionHqLocation).mockResolvedValue({ state_code: "TX", cbsa_code: "26420", county_fips: "48201", basis: "sod", urban_rural: null });
    await queryData({ measure: AREA, scope: { kind: "institution", id: "12" } });
    expect(getInstitutionHqLocation).toHaveBeenCalledWith(12);
    // bls-laus has no metro figures, so the institution reads its HQ county and state.
    expect(lastQuery().values.slice(0, 2)).toEqual([["county", "state"], ["48201", "TX"]]);
    expect(lastQuery().values).toContain("bls-laus");
    expect(lastQuery().values).toContain("laus_unemployment_rate");
    for (const q of queries()) expect(q.text).not.toMatch(/laus_unemployment_rate|bls-laus|48201/);
  });

  it("refuses a level the source does not cover and a peer group", async () => {
    const metro = await queryData({ measure: AREA, scope: { kind: "metro", id: "26420" } });
    expect(metro).toMatchObject({ ok: false, reason: expect.stringContaining("no metro figures") });
    const peer = await queryData({ measure: AREA, scope: { kind: "peer_set", peer: { charter_type: "bank" } } });
    expect(peer).toMatchObject({ ok: false, reason: expect.stringContaining("not supported for public-data measures yet") });
    const badState = await queryData({ measure: AREA, scope: { kind: "state", id: "Texas" } });
    expect(badState.ok).toBe(false);
    expect(queries()).toHaveLength(0);
  });

  it("caps the limit and defaults it", async () => {
    await queryData({ measure: AREA, scope: { kind: "national" }, limit: 200 });
    expect(lastQuery().values.at(-1)).toBe(200);
    await queryData({ measure: AREA, scope: { kind: "national" } });
    expect(lastQuery().values.at(-1)).toBe(50);
  });

  it("returns rows with national for nation, the unit and a citation", async () => {
    nextRows = [
      { geo_type: "nation", geo_code: "US", geo_name: "United States", period: "2026-09", value: 4.2, unit: "percent", note: null, source_url: "https://www.bls.gov/x", fetched_at: "2026-10-10T00:00:00Z" },
      { geo_type: "nation", geo_code: "US", geo_name: "United States", period: "2026-08", value: 4.1, unit: "percent", note: null, source_url: "https://www.bls.gov/x", fetched_at: "2026-10-12T00:00:00Z" },
    ];
    const result = await queryData({ measure: AREA, scope: { kind: "national" }, period: { from: "2026" } });
    expect(result).toMatchObject({
      ok: true,
      unit: "percent",
      rows: [expect.objectContaining({ geo_type: "national", period: "2026-09", value: 4.2 }), expect.anything()],
      citation: { source_url: "https://www.bls.gov/x", as_of: "2026-09", fetched_at: "2026-10-12T00:00:00.000Z" },
    });
    if (result.ok) expect(result.citation.publisher).toMatch(/Bureau of Labor Statistics/);
    expect(lastQuery().values).toContain("2026-01");
  });

  it("turns any bound into months, so quarter, month and year bounds work on any series", async () => {
    expect(periodMonths("2026")).toEqual({ start: "2026-01", end: "2026-12" });
    expect(periodMonths("2026Q2")).toEqual({ start: "2026-04", end: "2026-06" });
    expect(periodMonths("2026Q4")).toEqual({ start: "2026-10", end: "2026-12" });
    expect(periodMonths("2026-09")).toEqual({ start: "2026-09", end: "2026-09" });
    await queryData({ measure: AREA, scope: { kind: "national" }, period: { from: "2026Q2", to: "2026-09" } });
    const { text, values } = lastQuery();
    expect(values).toContain("2026-04");
    expect(values).toContain("2026-09");
    expect(values).not.toContain("2026Q2");
    expect(text).toMatch(/NOT ILIKE/);
  });
});

describe("queryData: fee measures", () => {
  it("refuses an unknown category", async () => {
    expect(await queryData({ measure: "fee:not_a_fee", scope: { kind: "national" } })).toMatchObject({ ok: false });
  });

  it("routes national, state, institution and peer scopes to the index readers", async () => {
    vi.mocked(getNationalIndexCached).mockResolvedValue([ENTRY]);
    const national = await queryData({ measure: "fee:overdraft", scope: { kind: "national" } });
    expect(national).toMatchObject({ ok: true, unit: "USD", rows: [expect.objectContaining({ median_amount: 30, institution_count: 40 })] });

    vi.mocked(getStateFeeIndexes).mockResolvedValue({ all: [ENTRY], bank: [], credit_union: [], verified_institutions: 1, verified_bank_institutions: 1, verified_cu_institutions: 0, verified_fees: 1 });
    await queryData({ measure: "fee:overdraft", scope: { kind: "state", id: "tx" } });
    expect(getStateFeeIndexes).toHaveBeenCalledWith("TX");

    vi.mocked(getInstitutionFeeRows).mockResolvedValue([]);
    await queryData({ measure: "fee:overdraft", scope: { kind: "institution", id: "12" } });
    expect(getInstitutionFeeRows).toHaveBeenCalledWith(12, "overdraft");

    vi.mocked(resolvePeerSet).mockResolvedValue({ definition: { charter_type: "bank" }, filters: { charter_type: "bank" }, label: "Banks", market: null });
    vi.mocked(getPeerIndex).mockResolvedValue([ENTRY]);
    const peer = await queryData({ measure: "fee:overdraft", scope: { kind: "peer_set", peer: { charter_type: "bank" } } });
    expect(getPeerIndex).toHaveBeenCalledWith({ charter_type: "bank" });
    expect(peer).toMatchObject({ ok: true, rows: [expect.objectContaining({ scope_label: "Banks" })] });
  });

  it("refuses county and metro, and same without an institution", async () => {
    expect(await queryData({ measure: "fee:overdraft", scope: { kind: "county", id: "48201" } })).toMatchObject({ ok: false });
    expect(await queryData({ measure: "fee:overdraft", scope: { kind: "metro", id: "26420" } })).toMatchObject({ ok: false });
    expect(await queryData({ measure: "fee:overdraft", scope: { kind: "peer_set", peer: { charter_type: "same" } } })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("needs scope.id"),
    });
    expect(resolvePeerSet).not.toHaveBeenCalled();
  });
});
