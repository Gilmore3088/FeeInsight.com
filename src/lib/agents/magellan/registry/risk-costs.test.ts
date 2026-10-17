import { describe, expect, it, vi } from "vitest";

import { blsOewsPartitions, BLS_OEWS_SOURCE, runRegistryBlsOews } from "./bls-oews";
import { finraNfcsPartitions, runRegistryFinraNfcs } from "./finra-nfcs";
import type { RegistryDb } from "./partitions";
import { runRiskCostArea } from "./risk-costs";
import { runRegistryUsdaFarm, usdaFarmPartitions, USDA_FARM_SOURCE } from "./usda-farm";
import { runRegistryUscourtsBankruptcy, uscourtsBankruptcyPartitions } from "./uscourts-bankruptcy";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("INSERT INTO area_statistics")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partition = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return { status: insert.values[2], detail: JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string) };
};

const NOW = new Date("2026-10-17T00:00:00Z");
const notFound = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;

describe("partitions", () => {
  it("lists each source newest first", () => {
    expect(uscourtsBankruptcyPartitions(NOW)[0]).toBe("2026Q2");
    expect(uscourtsBankruptcyPartitions(NOW).at(-1)).toBe("2018Q1");
    expect(blsOewsPartitions(NOW)).toEqual(["2025", "2024", "2023", "2022", "2021", "2020", "2019"]);
    expect(blsOewsPartitions(new Date("2026-02-01T00:00:00Z"))[0]).toBe("2024");
    expect(usdaFarmPartitions(NOW)[0]).toBe("2026");
    expect(usdaFarmPartitions(NOW)).toHaveLength(10);
    expect(finraNfcsPartitions(NOW)).toEqual(["2024", "2021", "2018"]);
  });
});

describe("runRiskCostArea", () => {
  const row = { geo_type: "state" as const, geo_code: "IA", geo_name: "Iowa", state_code: "IA", period: "2024", series_key: "usda_farm_net_income", value: 5, unit: "thousands_dollars", note: null, raw: {} };

  it("upserts, records the partition with the checks and reports what was missing", async () => {
    const { db, statements } = createDb();
    const r = await runRiskCostArea({ partitionKey: "2024", db }, { url: "u", rows: [row, row], missingFields: ["x"], skipped: {}, emptyReason: null }, {
      source: USDA_FARM_SOURCE,
      label: "USDA",
      parserVersion: 1,
      refreshHours: 24,
      emptyRetryHours: 24,
      extraDetail: { ers: { ok: true } },
    });
    expect(r).toMatchObject({ rows: 1, writtenRows: 1, empty: false, missingFields: ["x"] });
    const p = partition(statements);
    expect(p.status).toBe("succeeded");
    expect(p.detail).toMatchObject({ duplicate_keys: 1, missing_fields: ["x"], ers: { ok: true }, parser_version: 1 });
  });

  it("writes nothing on a dry run", async () => {
    const { db, statements } = createDb();
    const r = await runRiskCostArea({ partitionKey: "2024", db, dryRun: true }, { url: "u", rows: [row], missingFields: [], skipped: {}, emptyReason: null }, { source: "s", label: "S", parserVersion: 1, refreshHours: 1, emptyRetryHours: 1 });
    expect(r.dryRun).toBe(true);
    expect(statements).toEqual([]);
  });
});

describe("registry steps", () => {
  it("records an unpublished bankruptcy quarter as empty, never failing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryUscourtsBankruptcy({ partitionKey: "2026Q2", db, env: {}, fetchOptions: { fetchImpl: notFound, retries: 0 } });
    expect(r.empty).toBe(true);
    expect(partition(statements)).toMatchObject({ status: "empty", detail: { reason: expect.stringMatching(/No F-2 table found/) } });
  });

  it("records no NASS key in the usda-farm detail and still tries ERS", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryUsdaFarm({ partitionKey: "2025", db, env: {}, fetchOptions: { fetchImpl: notFound, retries: 0 } });
    expect(r.nassSkippedNoKey).toBe(true);
    const p = partition(statements);
    expect(p.status).toBe("empty");
    expect(p.detail.nass).toMatchObject({ skipped_no_key: true, empty_reason: "no NASS_API_KEY set" });
    expect(p.detail.reason).toMatch(/NASS: no NASS_API_KEY set/);
  });

  it("records a missing OEWS year as empty with each level's reason", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryBlsOews({ partitionKey: "2025", db, fetchOptions: { fetchImpl: notFound, retries: 0 } });
    expect(r.empty).toBe(true);
    expect(r.source).toBe(BLS_OEWS_SOURCE);
    expect(partition(statements).detail.missing_fields).toEqual(["nat file", "st file", "ma file"]);
  });

  it("records a missing NFCS wave as empty", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryFinraNfcs({ partitionKey: "2024", db, env: {}, fetchOptions: { fetchImpl: notFound, retries: 0 } });
    expect(r.empty).toBe(true);
    expect(partition(statements).status).toBe("empty");
  });

  it("rejects a malformed partition", async () => {
    await expect(runRegistryBlsOews({ partitionKey: "current", db: createDb().db })).rejects.toThrow(/Invalid year/);
    await expect(runRegistryUscourtsBankruptcy({ partitionKey: "2025", db: createDb().db })).rejects.toThrow(/Invalid quarter/);
  });
});
