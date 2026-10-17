import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  atpAreaStats,
  atpPartitions,
  atpShardOf,
  countyForPoint,
  createAtpMatcher,
  fetchZipEntryText,
  parseRunIndex,
  parseSpiderGeoJson,
  RangeNotSupportedError,
  readRemoteZipDirectory,
  selectSpiders,
  stateCode,
  zip5,
  type AtpLocation,
} from "./alltheplaces";

function featureCollection(features: unknown[]) {
  return JSON.stringify({ type: "FeatureCollection", features });
}

const BANK_FEATURES = [
  {
    type: "Feature",
    id: "abc123",
    properties: {
      "@spider": "first_bank_us",
      amenity: "bank",
      atm: "yes",
      name: "First Bank of Testing - Main St",
      brand: "First Bank of Testing",
      "brand:wikidata": "Q111",
      "addr:street_address": "100 Main St",
      "addr:city": "Houston",
      "addr:state": "Texas",
      "addr:postcode": "77002-1234",
      "addr:country": "US",
      ref: "0001",
    },
    geometry: { type: "Point", coordinates: [-95.3698, 29.7604] },
  },
  {
    type: "Feature",
    properties: { amenity: "atm", brand: "First Bank of Testing", operator: "First Bank of Testing", "addr:state": "TX", ref: "atm-9", "addr:country": "US" },
    geometry: { type: "Point", coordinates: [-95.37, 29.761] },
  },
  { type: "Feature", properties: { office: "financial", name: "Loan office", "addr:country": "US" }, geometry: null },
  { type: "Feature", id: "ca1", properties: { amenity: "bank", "addr:country": "CA", "addr:state": "ON" }, geometry: { type: "Point", coordinates: [-79.38, 43.65] } },
  { type: "Feature", properties: { amenity: "bank", name: "No country" }, geometry: { type: "Point", coordinates: [-95, 29] } },
];

/** Serves byte ranges of `file` like S3 does (206 + Content-Range). */
function rangeServer(file: Uint8Array, opts: { ignoreRange?: boolean } = {}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string>)?.Range ?? "";
    if (opts.ignoreRange || !range) return new Response(file as unknown as BodyInit, { status: 200 });
    const m = /bytes=(\d*)-(\d*)/.exec(range)!;
    let start: number;
    let end: number;
    if (m[1] === "") {
      start = Math.max(0, file.length - Number(m[2]));
      end = file.length - 1;
    } else {
      start = Number(m[1]);
      end = Math.min(file.length - 1, m[2] === "" ? file.length - 1 : Number(m[2]));
    }
    return new Response(file.slice(start, end + 1) as unknown as BodyInit, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${file.length}` } });
  }) as unknown as typeof fetch;
}

describe("AllThePlaces run index", () => {
  it("reads the run id, date and output zip", () => {
    expect(parseRunIndex({ run_id: "2026-10-11-13-32-35", output_url: "https://x/output.zip", spiders: 3000 })).toMatchObject({ runId: "2026-10-11-13-32-35", runDate: "2026-10-11", outputUrl: "https://x/output.zip", missingFields: [] });
  });

  it("names the fields it could not find", () => {
    expect(parseRunIndex({ id: "x" })).toEqual({ runId: null, missingFields: ["run_id", "output_url"] });
  });
});

describe("partitions", () => {
  it("lists 27 spider shards then the area counts", () => {
    const p = atpPartitions();
    expect(p).toHaveLength(28);
    expect(p[0]).toBe("spiders-a");
    expect(p.at(-1)).toBe("area-stats");
    expect(atpShardOf("spiders-0")).toBe("0");
    expect(atpShardOf("spiders-ab")).toBeNull();
  });
});

describe("zip over Range", () => {
  const zip = zipSync({
    "output/first_bank_us.geojson": strToU8(featureCollection(BANK_FEATURES)),
    "output/pnc_us.geojson": strToU8(featureCollection([])),
    "output/pizza_place_us.geojson": strToU8(featureCollection([])),
    "output/fcu_atms_us.geojson": strToU8(featureCollection([])),
  });

  it("reads the central directory and one entry without downloading the zip", async () => {
    const fetchImpl = rangeServer(zip);
    const { entries, total } = await readRemoteZipDirectory("https://x/output.zip", { fetchImpl, backoffMs: 0 });
    expect(total).toBe(zip.length);
    expect(entries.map((e) => e.name).sort()).toEqual(["output/fcu_atms_us.geojson", "output/first_bank_us.geojson", "output/pizza_place_us.geojson", "output/pnc_us.geojson"]);
    const sel = selectSpiders(entries, "f", []);
    expect(sel.spiders.map((s) => [s.spider, s.reason])).toEqual([["fcu_atms_us", "name_rule"], ["first_bank_us", "name_rule"]]);
    const pSel = selectSpiders(entries, "p", ["pnc_us", "pathward_us"]);
    expect(pSel.spiders.map((s) => s.spider)).toEqual(["pnc_us"]);
    expect(pSel.listedAbsent).toEqual(["pathward_us"]);
    const entry = entries.find((e) => e.name.includes("first_bank"))!;
    const text = await fetchZipEntryText("https://x/output.zip", entry, { fetchImpl, backoffMs: 0 });
    expect(JSON.parse(text).features).toHaveLength(5);
  });

  it("stops when the server ignores Range", async () => {
    await expect(readRemoteZipDirectory("https://x/output.zip", { fetchImpl: rangeServer(zip, { ignoreRange: true }), backoffMs: 0 })).rejects.toBeInstanceOf(RangeNotSupportedError);
  });
});

describe("parseSpiderGeoJson", () => {
  it("keeps US banks and ATMs only, and says why the rest were left out", () => {
    const read = parseSpiderGeoJson("first_bank_us", featureCollection(BANK_FEATURES));
    expect(read.features).toBe(5);
    expect(read.locations.map((l) => [l.kind, l.featureKey, l.keyBasis])).toEqual([["branch", "abc123", "id"], ["atm", "ref:atm-9", "ref"]]);
    expect(read.locations[0]).toMatchObject({ state: "TX", zip: "77002", address: "100 Main St", brandWikidata: "Q111", lat: 29.7604, lon: -95.3698 });
    expect(read.skipped).toEqual({ "other_category:financial": 1, "non_us:CA": 1, country_unknown: 1 });
    expect(read.missingFields).toEqual([]);
  });

  it("flags a file that is not a feature collection", () => {
    expect(parseSpiderGeoJson("x", "{oops").invalid).toBe(true);
    expect(parseSpiderGeoJson("x", '{"type":"Feature"}').invalid).toBe(true);
  });

  it("reports properties no feature carried", () => {
    const read = parseSpiderGeoJson("x", featureCollection([{ properties: { amenity: "atm", "addr:state": "TX" }, geometry: { type: "Point", coordinates: [-95, 29] } }]));
    expect(read.missingFields).toEqual(expect.arrayContaining(["brand", "brand:wikidata", "addr:postcode"]));
    expect(read.locations[0].keyBasis).toBe("hash");
  });
});

describe("helpers", () => {
  it("reads a state code or exact state name only", () => {
    expect(stateCode("tx")).toBe("TX");
    expect(stateCode("New York")).toBe("NY");
    expect(stateCode("Tex.")).toBeNull();
  });

  it("reads a five-digit ZIP only", () => {
    expect(zip5("02110")).toBe("02110");
    expect(zip5("2110")).toBeNull();
    expect(zip5("K1A 0B1")).toBeNull();
  });

  it("finds the county holding a point", () => {
    expect(countyForPoint(-95.3698, 29.7604)).toBe("48201");
    expect(countyForPoint(-30, 30)).toBeNull();
  });
});

describe("createAtpMatcher", () => {
  const universe = [
    { id: 1, name: "First Bank of Testing", state: "TX" },
    { id: 2, name: "Twin Bank", state: "OH" },
    { id: 3, name: "Twin Bank", state: "OH" },
    { id: 4, name: "Wiki Bank, N.A.", state: "NY" },
  ];
  const loc = (over: Partial<AtpLocation>): AtpLocation => ({ spider: "s", featureKey: "k", keyBasis: "id", kind: "branch", name: null, brand: null, brandWikidata: null, operator: null, operatorWikidata: null, address: null, city: null, state: null, zip: null, country: "US", lat: null, lon: null, ref: null, sourceUri: null, raw: {}, ...over });
  const match = createAtpMatcher(universe, new Map([["Q999", 4]]));

  it("links through the reviewed wikidata mapping first", () => {
    expect(match(loc({ brandWikidata: "q999", brand: "First Bank of Testing", state: "TX" }))).toMatchObject({ institutionId: 4, method: "brand_wikidata" });
  });

  it("links an exact name in the same state, never another state", () => {
    expect(match(loc({ brand: "First Bank of Testing", state: "TX" }))).toMatchObject({ institutionId: 1, method: "name_state", field: "brand" });
    expect(match(loc({ brand: "First Bank of Testing", state: "OK" }))).toMatchObject({ institutionId: null, unmatchedReason: "no_match" });
  });

  it("leaves a name two institutions share unmatched", () => {
    expect(match(loc({ operator: "Twin Bank", state: "OH" }))).toMatchObject({ institutionId: null, unmatchedReason: "ambiguous" });
  });
});

describe("atpAreaStats", () => {
  it("counts by county, state and nation, keeping locations without a county at state level", () => {
    const f = atpAreaStats(
      [
        { county_fips: "48201", state: "TX", kind: "atm", locations: 3, linked: 1, spiders: 1 },
        { county_fips: null, state: "TX", kind: "atm", locations: 2, linked: 0, spiders: 1 },
        { county_fips: "48201", state: "TX", kind: "branch", locations: 1, linked: 1, spiders: 1 },
      ],
      "2026-10-11",
      ["2026-10-11-13-32-35"],
    );
    const v = (geo: string, code: string, series: string) => f.rows.find((r) => r.geo_type === geo && r.geo_code === code && r.series_key === series)?.value;
    expect(v("county", "48201", "atp_atm_locations")).toBe(3);
    expect(v("state", "TX", "atp_atm_locations")).toBe(5);
    expect(v("nation", "US", "atp_atm_locations")).toBe(5);
    expect(v("nation", "US", "atp_bank_branch_locations")).toBe(1);
    expect(f.skipped).toEqual({ no_county: 2 });
    expect(f.rows.every((r) => r.period === "2026-10-11" && r.unit === "count")).toBe(true);
  });
});
