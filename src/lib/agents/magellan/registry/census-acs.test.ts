import { describe, expect, it, vi } from "vitest";

import { censusAcsPartitions, runRegistryCensusAcs } from "./census-acs";
import type { RegistryDb } from "./partitions";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("INSERT INTO demographics")) {
      const payload = JSON.parse(String(values[0])) as unknown[];
      return Promise.resolve(payload.map(() => 1));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const HEADER = ["NAME", "B19013_001E", "B17001_002E", "B01003_001E"];
function census(published: boolean) {
  return vi.fn(async (url: string) => {
    if (!published) return new Response("unknown", { status: 404 });
    const u = new URL(url);
    const level = u.searchParams.get("for");
    const body =
      level === "state:*" ? [[...HEADER, "state"], ["Alabama", "62000", "750000", "5100000", "01"]]
      : level === "county:*" ? [[...HEADER, "state", "county"], ["Autauga County, Alabama", "69841", "6295", "59285", "01", "001"]]
      : level === "tract:*" ? [[...HEADER, "state", "county", "tract"], ["Tract 201", "-666666666", "100", "4000", "01", "001", "020100"]]
      : [[...HEADER, "zip code tabulation area"], ["ZCTA5 35004", "71000", "900", "12000", "35004"]];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("census-acs registry step", () => {
  it("lists the two newest vintages", () => {
    expect(censusAcsPartitions(new Date("2026-10-07T00:00:00Z"))).toEqual(["2025", "2024"]);
  });

  it("dry run counts every level without writing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryCensusAcs({ partitionKey: "2024", dryRun: true, db, tractStates: ["01"], fetchOptions: { fetchImpl: census(true) } });
    expect(r.counts).toEqual({ state: 1, county: 1, zcta: 1, tract: 1 });
    expect(r.withIncome).toBe(3);
    expect(statements).toHaveLength(0);
  });

  it("upserts all rows and records the partition", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryCensusAcs({ partitionKey: "2024", db, tractStates: ["01"], fetchOptions: { fetchImpl: census(true) } });
    expect(r.upsertedRows).toBe(4);
    expect(statements.some((s) => s.text.includes("registry_ingest_partitions") && s.values.includes("succeeded"))).toBe(true);
  });

  it("records an unpublished vintage as empty", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryCensusAcs({ partitionKey: "2025", db, tractStates: ["01"], fetchOptions: { fetchImpl: census(false), retries: 0 } });
    expect(r.empty).toBe(true);
    expect(statements.some((s) => s.values.includes("empty"))).toBe(true);
  });
});
