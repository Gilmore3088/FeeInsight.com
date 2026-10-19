import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-catalog/series", () => ({ getAreaSeries: vi.fn() }));
vi.mock("@/lib/data-catalog/ncua-call-series", () => ({ getNcuaCallSeries: vi.fn() }));
vi.mock("@/lib/data-catalog/query-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-catalog/query-data")>()),
  queryData: vi.fn(),
}));

import { PIPELINE_AGENT_NAMES } from "@/lib/data-catalog/catalog";
import { queryData as runQueryData } from "@/lib/data-catalog/query-data";
import { getAreaSeries } from "@/lib/data-catalog/series";
import { getNcuaCallSeries } from "@/lib/data-catalog/ncua-call-series";
import { NCUA_CALL_MEASURES } from "@/lib/data-catalog/ncua-call-measures";
import { DATA_CATALOG_INSTRUCTION, LIST_DATA_MAX_SERIES, listDataCatalog, queryData } from "./tool-query-data";

const series = (source: string, key: string, geo: string[] = ["national", "state", "county"]) => ({
  source,
  series_key: key,
  measure: `area:${source}:${key}`,
  unit: "percent",
  geo_types: geo,
  period_min: "2020-01",
  period_max: "2026-08",
  source_url: null,
  fetched_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNcuaCallSeries).mockResolvedValue([]);
});

describe("listData", () => {
  it("lets a CU question discover real keys, period basis and caveats before querying them", async () => {
    vi.mocked(getAreaSeries).mockResolvedValue([]);
    vi.mocked(getNcuaCallSeries).mockResolvedValue(NCUA_CALL_MEASURES.map((m) => ({ ...m,
      periodMin: "2023-03-31", periodMax: "2026-06-30", sourceUrl: "https://ncua.gov/quarter.zip", fetchedAt: "2026-10-19T00:00:00Z",
    })));
    const out = await listDataCatalog({ query: "credit union fee income", scope: "institution" });
    const measure = out.call_measures?.find((m) => m.measure === "call:acct_131");
    expect(measure).toMatchObject({ name: "NCUA: Fee income", source: "ncua-extras", item_code: "ACCT_131", publisher: expect.stringContaining("NCUA"), unit: "USD", period_basis: "ytd", period_min: "2023-03-31", period_max: "2026-06-30", caveat: expect.stringContaining("not a consumer fee price") });
    expect(out.sources.find((s) => s.id === "ncua-extras")?.levels).toContain("peer_set");
    expect(out.note).toContain("not coverage of every quarter");
    const input = { measure: measure!.measure, scope: { kind: "institution" as const, id: "12" } };
    vi.mocked(runQueryData).mockResolvedValue({ ok: true, measure: input.measure, scope: "institution", rows: [], unit: null, citation: { publisher: "NCUA", source_url: null, as_of: null, fetched_at: null } });
    await queryData.execute!(input, { toolCallId: "discovered", messages: [] });
    expect(runQueryData).toHaveBeenCalledWith(input);
  });

  it("returns only the curated loaded set and keeps county calls out of unsupported discovery", async () => {
    vi.mocked(getAreaSeries).mockResolvedValue([]);
    const m = NCUA_CALL_MEASURES[0];
    vi.mocked(getNcuaCallSeries).mockResolvedValue([{ ...m, periodMin: "2024-03-31", periodMax: "2026-06-30", sourceUrl: null, fetchedAt: null }]);
    const found = await listDataCatalog({ query: "NCUA" });
    expect(found.call_measures?.filter((c) => c.measure.startsWith("call:acct_"))).toHaveLength(1);
    expect(found.call_measures).toContainEqual(expect.objectContaining({ measure: "call:acct_452", unit: "count", period_basis: "point_in_time" }));
    expect(JSON.stringify(found)).not.toContain("acct_is0048");
    const county = await listDataCatalog({ query: "NCUA share drafts", scope: "county" });
    expect(county.call_measures).toBeUndefined();
    const unrelated = await listDataCatalog({ query: "unemployment" });
    expect(unrelated.call_measures).toBeUndefined();
    expect(getNcuaCallSeries).toHaveBeenCalledTimes(1);
  });

  it("distinguishes no comparable rows from unavailable discovery without hiding other sources", async () => {
    vi.mocked(getAreaSeries).mockResolvedValue([series("bls-laus", "laus_unemployment_rate")] as never);
    const empty = await listDataCatalog({ query: "NCUA unemployment" });
    expect(empty.call_measures).toBeUndefined();
    expect(empty.note).toContain("None of the six selected NCUA measures");
    expect(empty.series).toHaveLength(1);
    vi.mocked(getNcuaCallSeries).mockRejectedValueOnce(new Error("database unavailable"));
    const failed = await listDataCatalog({ query: "NCUA unemployment" });
    expect(failed.note).toContain("discovery is unavailable");
    expect(failed.series).toHaveLength(1);
    vi.mocked(getNcuaCallSeries).mockReturnValueOnce(new Promise(() => undefined));
    expect((await listDataCatalog({ query: "NCUA" }, 5)).note).toContain("do not invent account keys");
  });
  it("lists matching series from servable sources with publisher labels, and fee measures", async () => {
    vi.mocked(getAreaSeries).mockResolvedValue([
      series("bls-laus", "laus_unemployment_rate"),
      series("census-saipe", "saipe_median_household_income"),
      series("not-a-catalog-source", "unemployment_anything"),
    ] as never);
    const out = await listDataCatalog({ query: "unemployment overdraft" });
    expect(out.series.map((s) => s.measure)).toEqual(["area:bls-laus:laus_unemployment_rate"]);
    expect(out.series[0].source).toContain("Bureau of Labor Statistics");
    expect(out.fee_measures.map((f) => f.measure)).toContain("fee:overdraft");
    expect(out.sources.map((s) => s.id)).toEqual(expect.arrayContaining(["published-fees", "bls-laus"]));
    const text = JSON.stringify(out);
    for (const name of PIPELINE_AGENT_NAMES) expect(text.toLowerCase()).not.toContain(name.toLowerCase());
  });

  it("lists bank call-report lines with their levels, and peer_set on sources a peer's headquarters can be placed in", async () => {
    vi.mocked(getAreaSeries).mockResolvedValue([series("bls-laus", "laus_unemployment_rate")] as never);
    const out = await listDataCatalog({ query: "service charges unemployment" });
    expect(out.call_measures).toContainEqual(expect.objectContaining({ measure: "call:service_charges_deposits_ytd", unit: "USD", levels: expect.arrayContaining(["institution", "peer_set"]) }));
    expect(out.sources.find((s) => s.id === "bls-laus")?.levels).toContain("peer_set");
    expect((await listDataCatalog({ query: "unemployment" })).call_measures).toBeUndefined();
    const peer = await listDataCatalog({ query: "unemployment", scope: "peer_set" });
    expect(peer.series.map((s) => s.measure)).toContain("area:bls-laus:laus_unemployment_rate");
  });

  it("keeps series that cover the asked level and caps the list", async () => {
    vi.mocked(getAreaSeries).mockResolvedValue([
      series("bls-laus", "metro_missing", ["national", "state"]),
      ...Array.from({ length: LIST_DATA_MAX_SERIES + 5 }, (_, i) => series("bls-laus", `laus_${i}`, ["county"])),
    ] as never);
    const out = await listDataCatalog({ scope: "county" });
    expect(out.series).toHaveLength(LIST_DATA_MAX_SERIES);
    expect(out.series.map((s) => s.measure)).not.toContain("area:bls-laus:metro_missing");
    expect(out.note).toContain(`${LIST_DATA_MAX_SERIES + 5} series match`);
  });

  it("ranks series by how many of the question's words they match, ignoring filler words", async () => {
    vi.mocked(getAreaSeries).mockResolvedValue([
      ...Array.from({ length: LIST_DATA_MAX_SERIES + 5 }, (_, i) => series("bls-oews", `oews_mean_wage_rate_${i}`)),
      series("bls-laus", "laus_unemployment_rate"),
    ] as never);
    const out = await listDataCatalog({ query: "unemployment rate in Harris county" });
    expect(out.series[0].measure).toBe("area:bls-laus:laus_unemployment_rate");
  });

  it("answers with sources and fee measures when the series list is slow or unavailable", async () => {
    vi.mocked(getAreaSeries).mockReturnValue(new Promise(() => undefined));
    const slow = await listDataCatalog({ query: "overdraft" }, 5);
    expect(slow.series).toEqual([]);
    expect(slow.fee_measures.map((f) => f.measure)).toContain("fee:overdraft");
    expect(slow.note).toContain("not available right now");

    vi.mocked(getAreaSeries).mockRejectedValue(new Error("timeout"));
    expect((await listDataCatalog({}, 50)).note).toContain("not available right now");
  });
});

describe("queryData tool", () => {
  it("passes the input to the one safe query and returns its result", async () => {
    const refused = { ok: false as const, measure: "fee:overdraft", reason: "Fee figures by county are not supported yet." };
    vi.mocked(runQueryData).mockResolvedValue(refused);
    const input = { measure: "fee:overdraft", scope: { kind: "county" as const, id: "48201" } };
    const out = await queryData.execute!(input, { toolCallId: "t", messages: [] });
    expect(runQueryData).toHaveBeenCalledWith(input);
    expect(out).toEqual(refused);
  });

  it("tells the answer to cite the publisher and as-of date and never estimate a refused figure", () => {
    expect(DATA_CATALOG_INSTRUCTION).toContain("(Source: {publisher}, {as_of})");
    expect(DATA_CATALOG_INSTRUCTION).toContain("do not estimate it");
  });
});
