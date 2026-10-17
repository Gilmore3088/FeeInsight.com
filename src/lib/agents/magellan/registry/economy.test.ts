import { describe, expect, it, vi } from "vitest";

import { ECONOMY_DEFINITIONS, ECONOMY_SOURCES, economyPartitions, runRegistryEconomy } from "./economy";
import type { RegistryDb } from "./partitions";

function createDb(urbanRural: Array<Record<string, unknown>> = []) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("INSERT INTO area_statistics")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    if (text.includes("GROUP BY source")) return Promise.resolve(urbanRural);
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return { status: insert.values[2], detail: JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string) };
};

const respond = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

const NOW = new Date("2026-10-17T00:00:00Z");

describe("economy partitions", () => {
  it("gives every source a newest-first list", () => {
    expect(economyPartitions(ECONOMY_SOURCES.qcew, NOW)).toEqual(["2025", "2024", "2023", "2022", "2021", "2020"]);
    expect(economyPartitions(ECONOMY_SOURCES.fdicSurvey, NOW).slice(0, 2)).toEqual(["2025", "2023"]);
    expect(economyPartitions(ECONOMY_SOURCES.fdicIndustry, NOW)[0]).toBe("2026Q2");
    expect(economyPartitions(ECONOMY_SOURCES.rucc, NOW)).toEqual(["2023"]);
    for (const d of ECONOMY_DEFINITIONS) expect(d.partitions(NOW).length).toBeGreaterThan(0);
  });
});

describe("keys, tokens and configured URLs", () => {
  it("skips BEA without a key and records why", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryEconomy({ source: ECONOMY_SOURCES.bea, partitionKey: "2025", db, env: {} });
    expect(r).toMatchObject({ skipped: true, empty: true });
    expect(partitionDetail(statements).detail.reason).toMatch(/No BEA_API_KEY set/);
  });

  it("skips the HUD crosswalk without HUD_USER_TOKEN and never fails", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryEconomy({ source: ECONOMY_SOURCES.hudCrosswalk, partitionKey: "current", db, env: {} });
    expect(r.skipped).toBe(true);
    expect(partitionDetail(statements).detail.reason).toMatch(/No HUD_USER_TOKEN set/);
  });

  it("skips CBP on Census's missing-key page with the reason the scheduler re-checks", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryEconomy({
      source: ECONOMY_SOURCES.cbp,
      partitionKey: "2023",
      db,
      env: {},
      fetchOptions: { fetchImpl: respond("<html>Missing Key</html>"), backoffMs: 0 },
    });
    expect(r.skipped).toBe(true);
    expect(partitionDetail(statements).detail.reason).toMatch(/^No CENSUS_API_KEY set/);
  });

  it("skips the FDIC rates feed when no URL is configured", async () => {
    const { db } = createDb();
    const r = await runRegistryEconomy({ source: ECONOMY_SOURCES.fdicRates, partitionKey: "current", db, env: {} });
    expect(r.emptyReason).toMatch(/FDIC_NATIONAL_RATES_CSV_URL/);
  });
});

describe("area statistics loads", () => {
  const qcew = [
    "area_fips,own_code,industry_code,year,qtr,disclosure_code,annual_avg_estabs,annual_avg_emplvl,total_annual_wages,avg_annual_pay",
    "48059,0,10,2025,A,,120,1500,60000000,40000",
    "48000,0,10,2025,A,,600000,13000000,900000000000,69000",
  ].join("\n");

  it("dry run reads and writes nothing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryEconomy({ source: ECONOMY_SOURCES.qcew, partitionKey: "2025", dryRun: true, db, fetchOptions: { fetchImpl: respond(qcew) } });
    expect(r).toMatchObject({ rows: 8, writtenRows: 0, dryRun: true });
    expect(statements).toHaveLength(0);
  });

  it("writes values and records the cleaning pass", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryEconomy({ source: ECONOMY_SOURCES.qcew, partitionKey: "2025", db, now: NOW, fetchOptions: { fetchImpl: respond(qcew) } });
    expect(r.writtenRows).toBe(8);
    const { status, detail } = partitionDetail(statements);
    expect(status).toBe("succeeded");
    expect(detail).toMatchObject({ rows_by_geo_type: { county: 4, state: 4 }, duplicate_keys: 0 });
  });

  it("records an unpublished year as empty", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryEconomy({ source: ECONOMY_SOURCES.qcew, partitionKey: "2026", db, fetchOptions: { fetchImpl: respond("nope", 404), backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements).status).toBe("empty");
  });

  it("loads nothing from a truncated FDIC read rather than an understated total", async () => {
    const { db, statements } = createDb();
    const body = JSON.stringify({ meta: { total: 20_000 }, data: [{ data: { CERT: 1, ASSET: 5 } }] });
    const r = await runRegistryEconomy({ source: ECONOMY_SOURCES.fdicIndustry, partitionKey: "2026Q2", db, fetchOptions: { fetchImpl: respond(body) } });
    expect(r.emptyReason).toMatch(/20000 filers but 1 were read/);
    expect(statements.some((s) => s.text.includes("INSERT INTO area_statistics"))).toBe(false);
  });
});

describe("FFIEC tracts", () => {
  it("writes nothing when the layout check fails", async () => {
    const { db, statements } = createDb();
    const { strToU8, zipSync } = await import("fflate");
    const zip = zipSync({ "census.csv": strToU8("1999,10180,48,059,030100,N,N,N,N,U,84500,0,1.02,70000\n") });
    const fetchImpl = vi.fn(async () => new Response(zip as unknown as BodyInit, { status: 200 })) as unknown as typeof fetch;
    const r = await runRegistryEconomy({ source: ECONOMY_SOURCES.ffiecTracts, partitionKey: "2024", db, fetchOptions: { fetchImpl } });
    expect(r.emptyReason).toMatch(/layout not confirmed/);
    expect(statements.some((s) => s.text.includes("INSERT INTO census_tracts"))).toBe(false);
  });
});

describe("urban-rural fill", () => {
  const counts = [{ source: "fdic", institutions: 10, with_hq_county: 9, county_without_rucc: 1, urban: 6, rural: 2, unchanged: 0, would_fill: 8, conflicts: 0 }];

  it("only counts unless ECONOMY_URBAN_RURAL_WRITE is true", async () => {
    const { db, statements } = createDb(counts);
    const r = await runRegistryEconomy({ source: ECONOMY_SOURCES.urbanRural, partitionKey: "current", db, env: {} });
    expect(r.summary).toMatch(/nothing written/);
    expect(statements.some((s) => s.text.includes("UPDATE institution_sources"))).toBe(false);
    expect(partitionDetail(statements).detail.mode).toBe("proposal");
  });

  it("fills blanks only when enabled", async () => {
    const { db, statements } = createDb(counts);
    await runRegistryEconomy({ source: ECONOMY_SOURCES.urbanRural, partitionKey: "current", db, env: { ECONOMY_URBAN_RURAL_WRITE: "true" } });
    const update = statements.find((s) => s.text.includes("UPDATE institution_sources"))!;
    expect(update.text).toContain("s.urban_rural IS NULL");
  });
});

describe("branch tracts", () => {
  it("dry run reports the pending count without calling the geocoder", async () => {
    const statements: string[] = [];
    const db = vi.fn((strings: unknown) => {
      const text = (strings as string[]).join(" ");
      statements.push(text);
      return Promise.resolve([
        { branch_kind: "bank", branch_key: "1:0", institution_id: 5, address: "1 Main St", city: "X", state: "TX", zip: "75001", latitude: null, longitude: null, address_hash: "h", pending: 3 },
        { branch_kind: "credit_union", branch_key: "9:1", institution_id: 6, address: null, city: null, state: "TX", zip: null, latitude: null, longitude: null, address_hash: "h2", pending: 3 },
      ]);
    }) as unknown as RegistryDb;
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await runRegistryEconomy({ source: ECONOMY_SOURCES.branchTracts, partitionKey: "pending", dryRun: true, db, fetchOptions: { fetchImpl } });
    expect(r.summary).toMatch(/3 branches wait/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(statements).toHaveLength(1);
  });
});
