import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-catalog/series", () => ({ getAreaSeries: vi.fn() }));
vi.mock("@/lib/data-catalog/query-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-catalog/query-data")>()),
  queryData: vi.fn(),
}));

import { PIPELINE_AGENT_NAMES } from "@/lib/data-catalog/catalog";
import { queryData as runQueryData } from "@/lib/data-catalog/query-data";
import { getAreaSeries } from "@/lib/data-catalog/series";
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
});

describe("listData", () => {
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
