import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import type { RegistryDb } from "./partitions";
import { ncuaBranchPartitions, runRegistryNcuaBranchGeocode, runRegistryNcuaBranches } from "./ncua-branches";

function createDb(handlers: Array<[string, (values: unknown[]) => unknown[]]>) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
    statements.push({ text, values });
    for (const [needle, handler] of handlers) if (text.includes(needle)) return Promise.resolve(handler(values));
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const HEADER =
  "CU_NUMBER,SiteId,CU_NAME,SiteName,SiteTypeName,MainOffice,PhysicalAddressLine1,PhysicalAddressCity,PhysicalAddressStateCode,PhysicalAddressPostalCode";

function archive(offices: number): Uint8Array {
  const lines = [HEADER];
  for (let i = 1; i <= offices; i += 1) lines.push(`${i},1,CU ${i},Main,Corporate Office,Yes,${i} Main St,Austin,TX,78701`);
  return zipSync({ "Credit Union Branch Information.txt": strToU8(lines.join("\n")) });
}

describe("NCUA credit union branches", () => {
  it("pulls only the newest publishable quarter", () => {
    expect(ncuaBranchPartitions(new Date("2026-10-07T00:00:00Z"))).toEqual(["2026Q2"]);
  });

  it("loads every office and records the partition", async () => {
    const { db, statements } = createDb([["INSERT INTO credit_union_branches", () => [{ matched: true }]]]);
    const fetchImpl = vi.fn(async () => new Response(archive(5_000)));

    const result = await runRegistryNcuaBranches({
      partitionKey: "2026Q2",
      db,
      fetchOptions: { fetchImpl: fetchImpl as unknown as typeof fetch, backoffMs: 0 },
    });

    expect(result).toMatchObject({ branches: 5_000, creditUnions: 5_000, empty: false });
    expect(statements.filter((s) => s.text.includes("INSERT INTO credit_union_branches"))).toHaveLength(5);
    expect(statements.some((s) => s.text.includes("registry_ingest_partitions"))).toBe(true);
  });

  it("refuses a branch file too short to be complete", async () => {
    const { db } = createDb([]);
    const fetchImpl = vi.fn(async () => new Response(archive(10)));

    await expect(
      runRegistryNcuaBranches({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl: fetchImpl as unknown as typeof fetch, backoffMs: 0 } }),
    ).rejects.toThrow(/refusing a partial load/);
  });

  it("geocodes waiting offices and marks misses so they are not retried forever", async () => {
    const { db, statements } = createDb([
      [
        "WHERE geocode_status IS NULL AND address IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL\n     ORDER BY",
        () => [
          { id: 1, address: "1 Main St", city: "Austin", state: "TX", zip: "78701-1234" },
          { id: 2, address: "Nowhere", city: "Austin", state: "TX", zip: null },
        ],
      ],
      ["SELECT COUNT(*) AS n", () => [{ n: 0 }]],
    ]);
    const fetchImpl = vi.fn(async () => new Response('"1","x","Match","Exact","y","-97.74,30.27","1","L"\n"2","x","No_Match"'));

    const result = await runRegistryNcuaBranchGeocode({ db, fetchOptions: { fetchImpl: fetchImpl as unknown as typeof fetch, backoffMs: 0 } });

    expect(result).toMatchObject({ attempted: 2, matched: 1, unmatched: 1, remaining: 0 });
    const update = statements.find((s) => s.text.includes("UPDATE credit_union_branches"));
    expect(JSON.parse(String(update?.values[0]))).toEqual([
      { id: 1, status: "matched", latitude: 30.27, longitude: -97.74 },
      { id: 2, status: "no_match", latitude: null, longitude: null },
    ]);
  });
});
