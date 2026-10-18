import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ text: string; values: unknown[] }> = [];
let nextRows: unknown[] = [];

vi.mock("@/lib/data-store/connection", () => {
  const tx = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(strings.join("").includes("SET LOCAL") ? [] : nextRows);
  });
  // unsafe() carries constant SQL (the served-row rule); the mock passes its text through as a value.
  Object.assign(tx, { unsafe: (text: string) => ({ unsafe: text }) });
  return { sql: tx, withTransaction: (cb: (db: typeof tx) => Promise<unknown>) => cb(tx) };
});
// Archived quarters (#1870): none unless a test supplies them.
vi.mock("./cold-reads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cold-reads")>()),
  prunedCallFiles: vi.fn(async () => []),
  readColdCallRows: vi.fn(async () => ({ rows: [], failed: [] })),
}));
vi.mock("@/lib/data-store/economy-aggregates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/economy-aggregates")>()),
  getInstitutionHqLocation: vi.fn(),
}));
vi.mock("@/lib/data-store/fee-index", () => ({
  getNationalIndexCachedStamped: vi.fn(),
  getStateFeeIndexes: vi.fn(),
  getPeerIndexStamped: vi.fn(),
  getInstitutionFeeRows: vi.fn(),
}));
vi.mock("@/lib/data-store/peer-sets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/peer-sets")>()),
  getPeerSubject: vi.fn(),
  resolvePeerRequest: vi.fn(),
  resolvePeerSet: vi.fn(),
  peerSetMemberIds: vi.fn(),
}));

import { prunedCallFiles, readColdCallRows } from "./cold-reads";
import { getInstitutionHqLocation } from "@/lib/data-store/economy-aggregates";
import { getInstitutionFeeRows, getNationalIndexCachedStamped, getPeerIndexStamped, getStateFeeIndexes } from "@/lib/data-store/fee-index";
import { makeStamp } from "@/lib/dataset-stamp";
import { getPeerSubject, peerSetMemberIds, resolvePeerRequest, resolvePeerSet } from "@/lib/data-store/peer-sets";
import { areaRowServedSql } from "@/lib/data-store/struck-sources";
import { URBAN_DEBT_ATTRIBUTION } from "@/lib/regulatory/state-lists";
import { QUERY_DATA_MAX_LIMIT, familyRows, parseMeasure, periodMonths, queryData, queryDataInputSchema } from "./query-data";

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
    expect(parseMeasure("call:service_charges_deposits_ytd")).toEqual({ kind: "call", itemKey: "service_charges_deposits_ytd" });
    expect(queryDataInputSchema.safeParse({ measure: "call:acct_564a", scope: { kind: "institution", id: "12" } }).success).toBe(true);
    for (const measure of ["call:", "call:RIAD4080", "call:x;drop", "call:a:b"]) {
      expect(queryDataInputSchema.safeParse({ measure, scope: { kind: "national" } }).success, measure).toBe(false);
    }
  });
});

describe("queryData: area measures", () => {
  it("refuses bad input with the schema's reason and runs no SQL", async () => {
    const result = await queryData({ measure: AREA, scope: { kind: "national" }, limit: 500 });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuses a measure the catalog may not show", async () => {
    for (const measure of ["area:national-series:natl_pmms_30y_fixed","area:state-bill-news:x", "area:kcfed-sb-lending:x", "area:fdic-sod:x"]) {
      const result = await queryData({ measure, scope: { kind: "national" } });
      expect(result.ok, measure).toBe(false);
      if (!result.ok) expect(result.reason.length, measure).toBeGreaterThan(10);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a dropped FDIC rate as not yet from its publisher, not as non-commercial", async () => {
    const result = await queryData({ measure: "area:national-series:natl_fdic_rate_savings", scope: { kind: "national" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("not published from its original source yet");
      expect(result.reason).not.toContain("commercial");
    }
    const struck = await queryData({ measure: "area:national-series:natl_pmms_30y_fixed", scope: { kind: "national" } });
    expect(struck.ok).toBe(false);
    if (!struck.ok) expect(struck.reason).toContain("commercial");
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

  it("refuses a level the source does not cover", async () => {
    const metro = await queryData({ measure: AREA, scope: { kind: "metro", id: "26420" } });
    expect(metro).toMatchObject({ ok: false, reason: expect.stringContaining("no metro figures") });
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

  it("carries the licence and the credit it requires on an open-licence source's citation", async () => {
    nextRows = [
      { geo_type: "state", geo_code: "TX", geo_name: "Texas", period: "2023", value: 0.3, unit: "share", note: null, source_url: "https://datacatalog.urban.org/x", fetched_at: "2026-10-18T00:00:00Z" },
    ];
    const urban = await queryData({ measure: "area:urban-debt-in-america:collections_share", scope: { kind: "state", id: "TX" } });
    expect(urban).toMatchObject({ ok: true, citation: { licence: "ODC-By 1.0", attribution: URBAN_DEBT_ATTRIBUTION } });
    // A public-domain source needs no credit beyond its publisher.
    const laus = await queryData({ measure: AREA, scope: { kind: "national" } });
    if (laus.ok) expect(laus.citation).not.toHaveProperty("attribution");
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
    // The served-row rule (struck URLs, FRED-era rows) rides along as constant SQL.
    expect(values).toContainEqual({ unsafe: areaRowServedSql("a") });
    expect(text).not.toContain("stlouisfed");
  });
});

describe("queryData: fee measures", () => {
  it("refuses an unknown category", async () => {
    expect(await queryData({ measure: "fee:not_a_fee", scope: { kind: "national" } })).toMatchObject({ ok: false });
  });

  it("routes national, state, institution and peer scopes to the index readers", async () => {
    const snapshot = makeStamp({
      dataset: "fee_index_cache", derivedFrom: "published_fee_catalog", mode: "cached", readAt: "2026-10-18T02:00:00Z", runId: 41,
      newestRecordAt: null, methodVersion: 3, counting: "counted_once", filters: [{ key: "sourced", label: "Only sourced fees" }],
    });
    vi.mocked(getNationalIndexCachedStamped).mockResolvedValue({ entries: [ENTRY], stamp: snapshot });
    const national = await queryData({ measure: "fee:overdraft", scope: { kind: "national" } });
    expect(national).toMatchObject({ ok: true, unit: "USD", rows: [expect.objectContaining({ median_amount: 30, institution_count: 40 })] });
    // #1924: the snapshot's stamp id and words travel with the figure, so the answer can cite them.
    expect(national).toMatchObject({
      dataset: {
        stamp_id: snapshot.id,
        summary: "Snapshot of published fee schedules, computed 18 Oct 2026 02:00 UTC. Institutions sharing one fee schedule count once.",
        filters: ["Only sourced fees"],
      },
    });
    // A category the index has no row for carries no stamp: there is no figure to cite.
    expect(await queryData({ measure: "fee:nsf", scope: { kind: "national" } })).not.toHaveProperty("dataset");

    vi.mocked(getStateFeeIndexes).mockResolvedValue({ all: [ENTRY], bank: [], credit_union: [], verified_institutions: 1, verified_bank_institutions: 1, verified_cu_institutions: 0, verified_fees: 1 });
    await queryData({ measure: "fee:overdraft", scope: { kind: "state", id: "tx" } });
    expect(getStateFeeIndexes).toHaveBeenCalledWith("TX");

    vi.mocked(getInstitutionFeeRows).mockResolvedValue([]);
    await queryData({ measure: "fee:overdraft", scope: { kind: "institution", id: "12" } });
    expect(getInstitutionFeeRows).toHaveBeenCalledWith(12, "overdraft");

    vi.mocked(resolvePeerSet).mockResolvedValue({ definition: { charter_type: "bank" }, filters: { charter_type: "bank" }, label: "Banks", market: null });
    vi.mocked(getPeerIndexStamped).mockResolvedValue({ entries: [ENTRY], stamp: snapshot });
    const peer = await queryData({ measure: "fee:overdraft", scope: { kind: "peer_set", peer: { charter_type: "bank" } } });
    expect(getPeerIndexStamped).toHaveBeenCalledWith({ charter_type: "bank" });
    expect(peer).toMatchObject({ ok: true, rows: [expect.objectContaining({ scope_label: "Banks" })], dataset: { stamp_id: snapshot.id } });
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

  it("refuses a peer group with no filters and nearest peers with no institution", async () => {
    expect(await queryData({ measure: "fee:overdraft", scope: { kind: "peer_set", peer: {} } })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("at least one filter"),
    });
    expect(await queryData({ measure: "fee:overdraft", scope: { kind: "peer_set", peer: { nearest: 10 } } })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('"nearest" peers need scope.id'),
    });
    expect(resolvePeerSet).not.toHaveBeenCalled();
    expect(getPeerIndexStamped).not.toHaveBeenCalled();
  });
});

const MEMBERS = [11, 12, 13, 14, 15, 16, 17];
const BANKS = { definition: { charter_type: "bank" }, filters: { charter_type: "bank" }, label: "Banks", market: null };

describe("queryData: area measures over a peer group", () => {
  it("rolls the series up over the group's members at their headquarters county, with a median, count and citation", async () => {
    vi.mocked(resolvePeerSet).mockResolvedValue(BANKS);
    vi.mocked(peerSetMemberIds).mockResolvedValue(MEMBERS);
    nextRows = [
      { period: "2026-09", unit: "percent", median: 4.1, p25: 3.6, p75: 4.8, institution_count: 7, area_count: 5, source_url: "https://www.bls.gov/lau", fetched_at: "2026-10-12T00:00:00Z" },
      { period: "2026-08", unit: "percent", median: 4.0, p25: 3.5, p75: 4.7, institution_count: 3, area_count: 2, source_url: "https://www.bls.gov/lau", fetched_at: "2026-10-10T00:00:00Z" },
    ];
    const result = await queryData({ measure: AREA, scope: { kind: "peer_set", peer: { charter_type: "bank" } }, period: { from: "2026" } });

    // The shared definition resolves the group; its members are read from the shared helper.
    expect(resolvePeerSet).toHaveBeenCalledWith({ charter_type: "bank" }, null);
    expect(peerSetMemberIds).toHaveBeenCalledWith(BANKS);
    const { text, values } = lastQuery();
    expect(values).toContainEqual(MEMBERS);
    expect(values).toContain("county");
    expect(values).toContain("bls-laus");
    expect(values).toContain("laus_unemployment_rate");
    expect(values).toContain("2026-01");
    expect(values).toContainEqual({ unsafe: areaRowServedSql("a") });
    expect(text).toContain("institution_hq_counties");
    expect(text).not.toMatch(/bls-laus|laus_unemployment_rate/);

    expect(result).toMatchObject({
      ok: true,
      scope: "peer_set",
      unit: "percent",
      citation: { source_url: "https://www.bls.gov/lau", as_of: "2026-09", fetched_at: "2026-10-12T00:00:00.000Z" },
      rows: [
        expect.objectContaining({ scope_label: "Banks", period: "2026-09", median: 4.1, institution_count: 7, member_count: 7, geo_level: "county", note: null }),
        // Under the minimum group size: no median, never zero, and the reason.
        expect.objectContaining({ period: "2026-08", median: null, p25: null, p75: null, institution_count: 3, note: expect.stringContaining("at least 5") }),
      ],
    });
    if (result.ok) {
      expect(result.citation.publisher).toMatch(/Bureau of Labor Statistics/);
      expect(result.note).toContain("7 of the group's 7 institutions");
      expect(result.note).toContain("headquarters county");
    }
  });

  it("resolves a group around an institution with the shared request path", async () => {
    vi.mocked(getPeerSubject).mockResolvedValue({ id: 12, charter_type: "bank" });
    vi.mocked(resolvePeerRequest).mockResolvedValue(BANKS);
    vi.mocked(peerSetMemberIds).mockResolvedValue(MEMBERS);
    await queryData({ measure: AREA, scope: { kind: "peer_set", id: "12", peer: { charter_type: "same", nearest: 10 } } });
    expect(resolvePeerRequest).toHaveBeenCalledWith({ id: 12, charter_type: "bank" }, { charter_type: "same", nearest: 10 });
    expect(lastQuery().values).toContainEqual(MEMBERS);
  });

  it("keeps the peer-group refusals and runs no SQL for them", async () => {
    expect(await queryData({ measure: AREA, scope: { kind: "peer_set", peer: {} } })).toMatchObject({ ok: false, reason: expect.stringContaining("at least one filter") });
    expect(await queryData({ measure: AREA, scope: { kind: "peer_set", peer: { nearest: 10 } } })).toMatchObject({ ok: false, reason: expect.stringContaining('"nearest" peers need scope.id') });
    expect(await queryData({ measure: AREA, scope: { kind: "peer_set", peer: { states: "same" } } })).toMatchObject({ ok: false, reason: expect.stringContaining("needs scope.id") });
    expect(queries()).toHaveLength(0);
  });

  it("says when no institution matches, and refuses a national-only source and a struck series before resolving anything", async () => {
    vi.mocked(resolvePeerSet).mockResolvedValue({ definition: { states: ["WY"] }, filters: null, label: "Institutions in Wyoming", market: null });
    vi.mocked(peerSetMemberIds).mockResolvedValue([]);
    const empty = await queryData({ measure: AREA, scope: { kind: "peer_set", peer: { states: ["WY"] } } });
    expect(empty).toMatchObject({ ok: true, rows: [], note: expect.stringContaining("No institutions match the peer group (Institutions in Wyoming)") });
    expect(queries()).toHaveLength(0);

    vi.mocked(resolvePeerSet).mockClear();
    const national = await queryData({ measure: "area:fed-shed:x", scope: { kind: "peer_set", peer: { charter_type: "bank" } } });
    expect(national).toMatchObject({ ok: false, reason: expect.stringContaining("only national figures") });
    const struck = await queryData({ measure: "area:national-series:natl_pmms_30y_fixed", scope: { kind: "peer_set", peer: { charter_type: "bank" } } });
    expect(struck).toMatchObject({ ok: false });
    const held = await queryData({ measure: "area:fdic-sod:x", scope: { kind: "peer_set", peer: { charter_type: "bank" } } });
    expect(held).toMatchObject({ ok: false });
    expect(resolvePeerSet).not.toHaveBeenCalled();
    expect(queries()).toHaveLength(0);
  });
});

describe("queryData: call-report lines", () => {
  const CALL = "call:service_charges_deposits_ytd";

  it("reads one institution's own filed values, in dollars, with the regulator's citation", async () => {
    nextRows = [
      { period: "2026-06-30", item_code: "RIAD4080", item_description: "SERVICE CHARGES ON DEPOSIT ACCOUNTS", schedule: "RI", value: 1_234_000, unit: "USD", period_basis: "ytd", source: "ffiec", source_url: "https://cdr.ffiec.gov/x", fetched_at: "2026-08-01T00:00:00Z" },
    ];
    const result = await queryData({ measure: CALL, scope: { kind: "institution", id: "12" } });
    const { text, values } = lastQuery();
    expect(text).toContain("institution_call_report_items");
    expect(values).toContain(12);
    expect(values).toContain("service_charges_deposits_ytd");
    expect(values).toContainEqual(["ffiec", "ncua"]);
    expect(text).not.toContain("service_charges_deposits_ytd");
    expect(result).toMatchObject({
      ok: true,
      scope: "institution",
      unit: "USD",
      rows: [expect.objectContaining({ period: "2026-06-30", value: 1_234_000, item_code: "RIAD4080", period_basis: "ytd" })],
      citation: { publisher: "FFIEC Central Data Repository (call report)", source_url: "https://cdr.ffiec.gov/x", as_of: "2026-06-30" },
    });
  });

  it("rolls a line up over a peer group, a state and every filer, and refuses a county", async () => {
    vi.mocked(resolvePeerSet).mockResolvedValue(BANKS);
    vi.mocked(peerSetMemberIds).mockResolvedValue(MEMBERS);
    nextRows = [{ period: "2026-06-30", unit: "USD", median: 900_000, p25: 400_000, p75: 2_000_000, institution_count: 6, period_basis: "ytd", sources: ["ffiec"], source_url: "https://cdr.ffiec.gov/x", fetched_at: "2026-08-01T00:00:00Z" }];
    const peer = await queryData({ measure: CALL, scope: { kind: "peer_set", peer: { charter_type: "bank" } } });
    expect(lastQuery().values).toContainEqual(MEMBERS);
    expect(peer).toMatchObject({
      ok: true,
      rows: [expect.objectContaining({ scope_label: "Banks", median: 900_000, institution_count: 6, member_count: 7, period_basis: "ytd" })],
      citation: { publisher: "FFIEC Central Data Repository (call report)" },
      note: expect.stringContaining("6 of the group's 7 institutions"),
    });

    vi.mocked(resolvePeerSet).mockResolvedValue({ definition: { states: ["TX"] }, filters: { states: ["TX"] }, label: "Institutions in Texas", market: null });
    await queryData({ measure: CALL, scope: { kind: "state", id: "tx" } });
    expect(resolvePeerSet).toHaveBeenLastCalledWith({ states: ["TX"] }, null);

    vi.mocked(resolvePeerSet).mockResolvedValue({ definition: { market_code: 26420 }, filters: { institutionIds: MEMBERS }, label: "Institutions with branches in the Houston metro", market: null });
    await queryData({ measure: CALL, scope: { kind: "metro", id: "26420" } });
    expect(resolvePeerSet).toHaveBeenLastCalledWith({ market_code: 26420 }, null);

    vi.mocked(peerSetMemberIds).mockClear();
    const all = await queryData({ measure: CALL, scope: { kind: "national" } });
    expect(peerSetMemberIds).not.toHaveBeenCalled();
    expect(lastQuery().values).toContain(null);
    expect(all).toMatchObject({ ok: true, rows: [expect.not.objectContaining({ member_count: expect.anything() })] });

    const before = queries().length;
    expect(await queryData({ measure: CALL, scope: { kind: "county", id: "48201" } })).toMatchObject({ ok: false, reason: expect.stringContaining("not rolled up by county") });
    expect(queries()).toHaveLength(before);
  });

  it("adds an archived (pruned) quarter from its cold file, behind the hot quarters, with the same citation", async () => {
    nextRows = [
      { period: "2026-06-30", item_code: "RIAD4080", item_description: "SERVICE CHARGES", schedule: "RI", value: 1_234_000, unit: "USD", period_basis: "ytd", source: "ffiec", source_url: "https://cdr.ffiec.gov/x", fetched_at: "2026-08-01T00:00:00Z" },
    ];
    const file = { source: "ffiec", period: "2019-06-30", objectKey: "k", rowCount: 1, sha256: "a".repeat(64) };
    vi.mocked(prunedCallFiles).mockResolvedValueOnce([file, { ...file, source: "ncua", objectKey: "n" }]);
    vi.mocked(readColdCallRows).mockResolvedValueOnce({
      rows: [{ institution_id: 12, source: "ffiec", report_date: "2019-06-30", item_code: "RIAD4080", item_key: "service_charges_deposits_ytd", item_description: "SERVICE CHARGES", schedule: "RI", value: 900, unit: "thousands", period_basis: "ytd", source_url: "https://cdr.ffiec.gov/old", fetched_at: "2026-10-17T00:00:00Z" }],
      failed: [],
    });
    const result = await queryData({ measure: CALL, scope: { kind: "institution", id: "12" } });
    expect(readColdCallRows).toHaveBeenCalledWith([file, expect.objectContaining({ source: "ncua" })], { itemKey: "service_charges_deposits_ytd", institutionIds: [12] });
    expect(result).toMatchObject({
      ok: true,
      rows: [expect.objectContaining({ period: "2026-06-30" }), expect.objectContaining({ period: "2019-06-30", value: 900_000, unit: "USD" })],
      citation: { source_url: "https://cdr.ffiec.gov/x", as_of: "2026-06-30" },
    });
  });

  it("reads no cold file when the hot rows already fill the limit", async () => {
    nextRows = [{ period: "2026-06-30", item_code: "RIAD4080", item_description: null, schedule: "RI", value: 1, unit: "USD", period_basis: "ytd", source: "ffiec", source_url: null, fetched_at: null }];
    await queryData({ measure: CALL, scope: { kind: "institution", id: "12" }, limit: 1 });
    expect(prunedCallFiles).not.toHaveBeenCalled();
  });

  it("shows no median, never zero, for a thin group", async () => {
    vi.mocked(resolvePeerSet).mockResolvedValue(BANKS);
    vi.mocked(peerSetMemberIds).mockResolvedValue([11, 12]);
    nextRows = [{ period: "2026-06-30", unit: "USD", median: 0, p25: 0, p75: 0, institution_count: 2, period_basis: "ytd", sources: ["ffiec"], source_url: null, fetched_at: null }];
    const result = await queryData({ measure: CALL, scope: { kind: "peer_set", peer: { charter_type: "bank" } } });
    expect(result).toMatchObject({ ok: true, rows: [expect.objectContaining({ median: null, p25: null, p75: null, institution_count: 2 })] });
  });
});

describe("queryData institution facts (fact:<name>)", () => {
  const FACT = "fact:offers_zelle";

  it("parses a fact measure", () => {
    expect(parseMeasure(FACT)).toEqual({ kind: "fact", name: "offers_zelle" });
    expect(queryDataInputSchema.safeParse({ measure: FACT, scope: { kind: "institution", id: "12" } }).success).toBe(true);
  });

  it("answers one institution with the sentence and its own document's link", async () => {
    nextRows = [{ status: "offers", evidence_url: "https://bank.example/fees.pdf", evidence_snippet: "Send money with Zelle® in our app.", read_at: "2026-10-18T10:00:00Z", rule: "send_money_with" }];
    const result = await queryData({ measure: FACT, scope: { kind: "institution", id: "12" } });
    expect(result).toMatchObject({
      ok: true,
      rows: [{ answer: "yes", evidence: "Send money with Zelle® in our app.", document_url: "https://bank.example/fees.pdf" }],
      citation: { source_url: "https://bank.example/fees.pdf", as_of: "2026-10-18" },
    });
    expect(lastQuery().values).toEqual([12, "zelle"]);
  });

  it("says unknown, never no, when no document names the service", async () => {
    nextRows = [];
    const result = await queryData({ measure: FACT, scope: { kind: "institution", id: "12" } });
    expect(result).toMatchObject({ ok: true, rows: [] });
    if (result.ok) expect(result.note).toContain("not known");
  });

  it("refuses other scopes and unknown facts without a query", async () => {
    const state = await queryData({ measure: FACT, scope: { kind: "state", id: "TX" } });
    expect(state.ok).toBe(false);
    const unknown = await queryData({ measure: "fact:offers_venmo", scope: { kind: "institution", id: "12" } });
    expect(unknown.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("queryData corporate family", () => {
  type Node = Parameters<typeof familyRows>[0];
  const node = (lei: string, children: Node[] = [], institutionId: number | null = null): Node => ({
    lei,
    legal_name: `Entity ${lei}`,
    jurisdiction: null,
    legal_country: "US",
    entity_status: "ACTIVE",
    registration_status: "ISSUED",
    direct_parent_lei: null,
    rssd_id: null,
    institution_id: institutionId,
    institution_name: institutionId ? "Tracked Bank" : null,
    link_method: null,
    has_record: true,
    children,
  });

  it("parses family:lei and refuses it outside one institution, before any SQL", async () => {
    expect(parseMeasure("family:lei")).toEqual({ kind: "family" });
    calls.length = 0;
    expect(await queryData({ measure: "family:lei", scope: { kind: "state", id: "TX" } })).toMatchObject({ ok: false, reason: expect.stringContaining("one institution") });
    expect(calls).toEqual([]);
  });

  it("names each member's relation to the institution", () => {
    const tree = node("HOLDCO", [node("MID", [node("BANK", [node("SUB")], 7)]), node("OTHER")]);
    const rows = familyRows(tree, new Set(["BANK"]));
    const relation = Object.fromEntries(rows.map((r) => [r.lei, r.relation]));
    expect(relation).toEqual({ HOLDCO: "ultimate_parent", MID: "parent", BANK: "subject", SUB: "subsidiary", OTHER: "affiliate" });
    expect(rows.find((r) => r.lei === "SUB")).toMatchObject({ depth: 3, parent_lei: "BANK" });
  });
});
