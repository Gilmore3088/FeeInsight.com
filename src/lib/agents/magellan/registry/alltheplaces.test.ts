import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { alltheplacesPartitions, runRegistryAlltheplaces } from "./alltheplaces";
import type { RegistryDb } from "./partitions";

function createDb(counts: unknown[] = []) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_sources")) {
      return Promise.resolve([
        { id: 1, institution_name: "First Bank of Testing", state_code: "TX" },
        { id: 2, institution_name: "Other CU", state_code: "TX" },
      ]);
    }
    if (text.includes("FROM brand_wikidata_institutions")) return Promise.resolve([]);
    if (text.includes("INSERT INTO atp_financial_locations") || text.includes("INSERT INTO area_statistics")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    if (text.includes("FROM cur")) return Promise.resolve(counts);
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return { status: insert.values[2], detail: JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string) };
};

const features = [
  { type: "Feature", id: "f1", properties: { amenity: "bank", brand: "First Bank of Testing", "addr:state": "TX", "addr:country": "US", "addr:city": "Houston" }, geometry: { type: "Point", coordinates: [-95.3698, 29.7604] } },
  { type: "Feature", id: "f2", properties: { amenity: "atm", brand: "Mystery ATM Co", "addr:state": "TX", "addr:country": "US" }, geometry: { type: "Point", coordinates: [-95.37, 29.761] } },
  { type: "Feature", id: "f3", properties: { amenity: "cafe", "addr:country": "US" }, geometry: { type: "Point", coordinates: [-95.37, 29.761] } },
];
const zip = zipSync({
  "output/first_bank_us.geojson": strToU8(JSON.stringify({ type: "FeatureCollection", features })),
  "output/fun_store_us.geojson": strToU8(JSON.stringify({ type: "FeatureCollection", features: [] })),
});

function server(opts: { ignoreRange?: boolean; index?: unknown } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("latest.json")) return new Response(JSON.stringify(opts.index ?? { run_id: "2026-10-11-13-32-35", output_url: "https://data.example/runs/2026-10-11/output.zip" }), { status: 200 });
    const range = (init?.headers as Record<string, string>)?.Range ?? "";
    if (opts.ignoreRange) return new Response(zip as unknown as BodyInit, { status: 200 });
    const m = /bytes=(\d*)-(\d*)/.exec(range)!;
    const start = m[1] === "" ? Math.max(0, zip.length - Number(m[2])) : Number(m[1]);
    const end = m[1] === "" ? zip.length - 1 : Math.min(zip.length - 1, Number(m[2]));
    return new Response(zip.slice(start, end + 1) as unknown as BodyInit, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${zip.length}` } });
  }) as unknown as typeof fetch;
}

describe("registry alltheplaces", () => {
  it("lists the spider shards then the area counts", () => {
    const p = alltheplacesPartitions(new Date());
    expect(p[0]).toBe("spiders-a");
    expect(p.at(-1)).toBe("area-stats");
  });

  it("loads one shard's bank spiders, links by exact name and state, keeps the rest unmatched", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryAlltheplaces({ partitionKey: "spiders-f", db, env: {}, fetchOptions: { fetchImpl: server(), backoffMs: 0 } });
    expect(r).toMatchObject({ atpRunId: "2026-10-11-13-32-35", spiders: ["first_bank_us"], locations: 2, matched: 1, unmatched: 1, writtenRows: 2, empty: false });
    const insert = statements.find((s) => s.text.includes("INSERT INTO atp_financial_locations"))!;
    const rows = JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
    expect(rows[0]).toMatchObject({ feature_key: "f1", kind: "branch", county_fips: "48201", institution_id: 1, match_method: "name_state" });
    expect(rows[1]).toMatchObject({ feature_key: "f2", kind: "atm", institution_id: null });
    const { status, detail } = partitionDetail(statements);
    expect(status).toBe("succeeded");
    expect(detail.checks.skipped).toEqual({ "other_category:cafe": 1 });
    expect(detail.spiders_selected).toEqual([expect.objectContaining({ spider: "first_bank_us", reason: "name_rule" })]);
  });

  it("records the shard empty when the zip server ignores Range", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryAlltheplaces({ partitionKey: "spiders-f", db, env: {}, fetchOptions: { fetchImpl: server({ ignoreRange: true }), backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(r.emptyReason).toMatch(/Range/);
    expect(partitionDetail(statements).status).toBe("empty");
  });

  it("names missing run-index fields", async () => {
    const { db } = createDb();
    const r = await runRegistryAlltheplaces({ partitionKey: "spiders-f", db, env: {}, fetchOptions: { fetchImpl: server({ index: { run: "x" } }), backoffMs: 0 } });
    expect(r).toMatchObject({ empty: true, missingFields: ["run_id", "output_url"] });
  });

  it("does not write on a dry run", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryAlltheplaces({ partitionKey: "spiders-f", db, env: {}, dryRun: true, fetchOptions: { fetchImpl: server(), backoffMs: 0 } });
    expect(r.locations).toBe(2);
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });

  it("writes area counts from the current locations", async () => {
    const { db, statements } = createDb([{ county_fips: "48201", state: "TX", kind: "atm", locations: 4, linked: 1, spiders: 2, run_ids: ["2026-10-11-13-32-35"] }]);
    const r = await runRegistryAlltheplaces({ partitionKey: "area-stats", db });
    expect(r).toMatchObject({ areaRows: 3, writtenRows: 3, atpRunId: "2026-10-11-13-32-35" });
    expect(statements.some((s) => s.text.includes("INSERT INTO area_statistics"))).toBe(true);
  });

  it("rejects an unknown partition", async () => {
    await expect(runRegistryAlltheplaces({ partitionKey: "nope", db: createDb().db })).rejects.toThrow(/Invalid AllThePlaces/);
  });
});
