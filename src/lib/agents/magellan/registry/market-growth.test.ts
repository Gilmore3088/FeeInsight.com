import { describe, expect, it, vi } from "vitest";

import {
  blsLausPartitions,
  censusBfsPartitions,
  censusLehdPartitions,
  censusPermitsPartitions,
  censusPopestPartitions,
  irsMigrationPartitions,
  LODES_STATES,
  MARKET_GROWTH_DEFINITIONS,
  MARKET_GROWTH_SOURCES,
  marketGrowthPartitions,
  runRegistryMarketGrowth,
} from "./market-growth";
import type { RegistryDb } from "./partitions";

function createDb(newerVintage: Array<{ period: string; vintage: number }> = []) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("INSERT INTO area_statistics")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    if (text.includes("SELECT DISTINCT period")) return Promise.resolve(newerVintage);
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partition = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return { status: insert.values[2], detail: JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string) };
};

const written = (statements: Array<{ text: string; values: unknown[] }>) =>
  statements
    .filter((s) => s.text.includes("INSERT INTO area_statistics"))
    .flatMap((s) => JSON.parse(s.values.find((v) => typeof v === "string" && v.startsWith("[")) as string) as Array<{ geo_code: string; period: string; series_key: string; value: number | null }>);

const NOW = new Date("2026-10-17T00:00:00Z");

describe("market growth partitions", () => {
  it("lists every source newest first", () => {
    expect(censusPermitsPartitions(NOW).slice(0, 2)).toEqual(["2026-09", "2026-08"]);
    expect(censusPermitsPartitions(NOW)).toContain("2025-09");
    expect(censusPermitsPartitions(NOW).slice(-6)).toEqual(["2025", "2024", "2023", "2022", "2021", "2020"]);
    expect(censusPopestPartitions(NOW)).toEqual(["2025", "2024", "2020"]);
    expect(irsMigrationPartitions(NOW)[0]).toBe("2024");
    expect(censusBfsPartitions()).toEqual(["state-monthly", "county-annual"]);
    expect(blsLausPartitions(NOW).slice(0, 2)).toEqual(["current", "2025"]);
    expect(LODES_STATES).toHaveLength(51);
    expect(LODES_STATES).not.toContain("PR");
    expect(censusLehdPartitions(NOW)[0]).toBe("al-2024");
    expect(censusLehdPartitions(NOW)).toHaveLength(51 * 8);
    for (const d of MARKET_GROWTH_DEFINITIONS) expect(marketGrowthPartitions(d.source, NOW).length).toBeGreaterThan(0);
  });

  it("refuses a malformed partition", async () => {
    const { db } = createDb();
    await expect(runRegistryMarketGrowth({ source: MARKET_GROWTH_SOURCES.lodes, partitionKey: "pr-2022", db })).rejects.toThrow(/Invalid partition/);
    await expect(runRegistryMarketGrowth({ source: MARKET_GROWTH_SOURCES.irsMigration, partitionKey: "21-22", db })).rejects.toThrow(/Invalid year/);
  });
});

describe("market growth runs", () => {
  const notFound = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;

  it("records an unpublished year empty with its reason", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryMarketGrowth({ source: MARKET_GROWTH_SOURCES.irsMigration, partitionKey: "2024", db, now: NOW, fetchOptions: { fetchImpl: notFound, backoffMs: 0 } });
    expect(r).toMatchObject({ empty: true, writtenRows: 0 });
    const p = partition(statements);
    expect(p.status).toBe("empty");
    expect(p.detail.reason).toMatch(/has not published 2023-2024/);
  });

  it("loads the BLS 14-month file, with checks in the partition detail", async () => {
    const body = [
      "LAUS Code | State FIPS | County FIPS | County Name/State Abbreviation | Period | Labor Force | Employed | Unemployed Level | Unemployment Rate",
      "CN0100100000000 | 01 | 001 | Autauga County, AL | Aug-26(p) | 26,123 | 25,456 | 667 | 2.6",
    ].join("\n");
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const { db, statements } = createDb();
    const r = await runRegistryMarketGrowth({ source: MARKET_GROWTH_SOURCES.laus, partitionKey: "current", db, now: NOW, runId: 7, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(false);
    expect(r.writtenRows).toBe(r.rows);
    expect(written(statements).find((w) => w.geo_code === "01001" && w.series_key === "laus_labor_force")).toMatchObject({ value: 26123, period: "2026-08" });
    const p = partition(statements);
    expect(p.status).toBe("succeeded");
    expect(p.detail).toMatchObject({ parser_version: 1, missing_fields: [], duplicate_keys: 0 });
    expect(p.detail.rows_by_geo_type).toMatchObject({ county: 4, state: 4, nation: 4 });
  });

  it("writes nothing on a dry run", async () => {
    const body = "LAUS Code | State FIPS | County FIPS | Name | Period | Labor Force | Employed | Unemployed | Rate\nCN0100100000000 | 01 | 001 | A | Aug-26 | 1 | 1 | 0 | 0.0";
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const { db, statements } = createDb();
    const r = await runRegistryMarketGrowth({ source: MARKET_GROWTH_SOURCES.laus, partitionKey: "current", db, dryRun: true, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.dryRun).toBe(true);
    expect(r.rows).toBeGreaterThan(0);
    expect(statements).toEqual([]);
  });

  it("lets an older population vintage write only years no newer vintage has", async () => {
    const csv = [
      "SUMLEV,STATE,COUNTY,STNAME,CTYNAME,POPESTIMATE2019,POPESTIMATE2020",
      "050,48,453,Texas,Travis County,1270000,1290000",
    ].join("\n");
    const fetchImpl = vi.fn(async () => new Response(csv, { status: 200 })) as unknown as typeof fetch;
    const { db, statements } = createDb([{ period: "2020", vintage: 2025 }]);
    const r = await runRegistryMarketGrowth({ source: MARKET_GROWTH_SOURCES.popest, partitionKey: "2020", db, now: NOW, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(false);
    const rows = written(statements);
    expect(rows.map((w) => w.period)).not.toContain("2020");
    expect(rows.find((w) => w.geo_code === "48453" && w.period === "2019")?.value).toBe(1270000);
    expect(partition(statements).detail).toMatchObject({ superseded_by_vintage: 2025, vintage: 2020 });
  });

  it("asks for the BFS county file URL when none is found", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryMarketGrowth({ source: MARKET_GROWTH_SOURCES.bfs, partitionKey: "county-annual", db, env: {}, fetchOptions: { fetchImpl: notFound, backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(partition(statements).detail.reason).toMatch(/BFS_COUNTY_CSV_URL/);
  });
});
