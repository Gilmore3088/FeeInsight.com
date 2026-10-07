import { describe, expect, it, vi } from "vitest";

import { irsZipIncomePartitions, runRegistryIrsZipIncome } from "./irs-zip-income";
import type { RegistryDb } from "./partitions";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("INSERT INTO irs_zip_income")) {
      const payload = JSON.parse(String(values[0])) as unknown[];
      return Promise.resolve(payload.map(() => 1));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const CSV = "STATEFIPS,STATE,zipcode,agi_stub,N1,A00100,A00300\n01,AL,35004,0,5300,330000,2100\n25,MA,02139,0,21000,3100000,\n";
const irs = (published: boolean) =>
  vi.fn(async () => (published ? new Response(CSV, { status: 200 }) : new Response("missing", { status: 404 }))) as unknown as typeof fetch;

describe("irs-zip-income registry step", () => {
  it("lists published-or-due tax years newest first", () => {
    const years = irsZipIncomePartitions(new Date("2026-10-07T00:00:00Z"));
    expect(years[0]).toBe("2024");
    expect(years.at(-1)).toBe("2018");
  });

  it("dry run counts ZIPs without writing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryIrsZipIncome({ partitionKey: "2022", dryRun: true, db, fetchOptions: { fetchImpl: irs(true) } });
    expect(r).toMatchObject({ zips: 2, withInterest: 1, empty: false });
    expect(statements).toHaveLength(0);
  });

  it("upserts rows and records the partition", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryIrsZipIncome({ partitionKey: "2022", db, fetchOptions: { fetchImpl: irs(true) } });
    expect(r.upsertedRows).toBe(2);
    expect(statements.some((s) => s.text.includes("registry_ingest_partitions") && s.values.includes("succeeded"))).toBe(true);
  });

  it("records an unpublished year as empty", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryIrsZipIncome({ partitionKey: "2024", db, fetchOptions: { fetchImpl: irs(false), retries: 0 } });
    expect(r.empty).toBe(true);
    expect(statements.some((s) => s.values.includes("empty"))).toBe(true);
  });
});
