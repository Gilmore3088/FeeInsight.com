import { describe, expect, it, vi } from "vitest";

import { industryEventsPartitions, partitionFamily, runRegistryIndustryEvents } from "./industry-events";
import type { RegistryDb } from "./partitions";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_sources")) {
      return Promise.resolve([{ id: 10, source: "fdic", cert_number: "628", rssd_id: null, institution_name: "Acme Bank", state_code: "OH" }]);
    }
    if (text.includes("INSERT INTO institution_structure_events")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string) as unknown[];
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionInsert = (statements: Array<{ text: string; values: unknown[] }>) => statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) =>
  JSON.parse(partitionInsert(statements)!.values.find((v) => typeof v === "string" && v.startsWith("{")) as string);

function failuresFetch() {
  const records = [
    { ID: "1", CERT: 628, NAME: "Acme Bank", CITY: "Springfield", PSTALP: "OH", FAILDATE: "5/1/2025", RESTYPE: "FAILURE", RESTYPE1: "PA", QBFASSET: 100 },
    { ID: "2", CERT: 9, NAME: "Beta Bank", CITY: "Peoria", PSTALP: "IL", FAILDATE: "6/1/2025", RESTYPE: "FAILURE", RESTYPE1: "PI", QBFASSET: 50 },
  ];
  return vi.fn(async () => new Response(JSON.stringify({ meta: { total: 2 }, data: records.map((data) => ({ data })) }), { status: 200 })) as unknown as typeof fetch;
}

describe("industry-events partitions", () => {
  it("lists every family and comment topics always, and no lawsuit years", () => {
    const parts = industryEventsPartitions(new Date("2026-10-17T00:00:00Z"));
    expect(parts.slice(0, 3)).toEqual(["fed-h2", "occ-bulletin", "fdic-failures"]);
    expect(parts).toContain("sec:batch-7");
    expect(parts).toContain("sba:7a-fy2020-present");
    expect(parts).toContain("comments:overdraft");
    expect(parts.some((p) => p.startsWith("lawsuits:"))).toBe(false);
    expect(new Set(parts).size).toBe(parts.length);
    expect(partitionFamily("sba:504-fy2010-present")).toBe("sba");
  });
});

describe("registry industry-events", () => {
  it("dry run reads FDIC failures, matches by cert and writes nothing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryIndustryEvents({ partitionKey: "fdic-failures", dryRun: true, db, fetchOptions: { fetchImpl: failuresFetch(), backoffMs: 0 } });
    expect(r).toMatchObject({ rows: 2, matchedRows: 1, unmatchedRows: 1, empty: false, dryRun: true });
    expect(r.missingFields).toEqual(["CHCLASS1", "QBFDEP", "COST"]);
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });

  it("writes failures into structure events under their own source", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryIndustryEvents({ partitionKey: "fdic-failures", db, fetchOptions: { fetchImpl: failuresFetch(), backoffMs: 0 } });
    expect(r.writtenRows).toBe(2);
    const insert = statements.find((s) => s.text.includes("INSERT INTO institution_structure_events"))!;
    expect(insert.values[0]).toBe("fdic-failures");
    const payload = JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
    expect(payload[0]).toMatchObject({ cert: "628", institution_id: 10, effective_date: "2025-05-01", change_code: "PA", office_state: "OH" });
    expect(partitionDetail(statements).cleaning).toMatchObject({ rows: 2, unmatched: 1 });
  });

  it("records comments as skipped, not failed, without DATA_GOV_API_KEY", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await runRegistryIndustryEvents({ partitionKey: "comments:overdraft", db, env: {} as NodeJS.ProcessEnv, fetchOptions: { fetchImpl } });
    expect(r).toMatchObject({ empty: true, skipped: true });
    expect(r.emptyReason).toMatch(/DATA_GOV_API_KEY/);
    expect(partitionInsert(statements)!.values).toContain("empty");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unknown partition", async () => {
    const { db } = createDb();
    await expect(runRegistryIndustryEvents({ partitionKey: "sba:nope", db })).rejects.toThrow(/SBA partition/);
    await expect(runRegistryIndustryEvents({ partitionKey: "sec:batch-9", db })).rejects.toThrow(/SEC partition/);
    await expect(runRegistryIndustryEvents({ partitionKey: "lawsuits:2025", db })).rejects.toThrow(/Unknown industry-events partition/);
  });
});
