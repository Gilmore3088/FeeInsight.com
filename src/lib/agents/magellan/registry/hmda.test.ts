import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { hmdaPartitions, latestHmdaYear, runRegistryHmda, runRegistryHmdaApor } from "./hmda";
import type { RegistryDb } from "./partitions";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("SELECT NOW() AS started_at")) return Promise.resolve([{ started_at: "2026-10-17T00:00:00Z" }]);
    if (text.includes("INSERT INTO hmda_lenders")) return Promise.resolve([{ matched: true }, { matched: false }]);
    if (text.includes("INSERT INTO hmda_lender_originations")) return Promise.resolve([{}, {}, {}]);
    if (text.includes("INSERT INTO hmda_lender_loan_costs")) return Promise.resolve([{}, {}]);
    if (text.includes("DELETE FROM")) return Promise.resolve([{}]);
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
};

const CSV = [
  "activity_year,lei,derived_msa_md,state_code,county_code,action_taken,loan_purpose,loan_amount,total_loan_costs,origination_charges,discount_points,lender_credits",
  "2024,LEI1,31080,CA,06037,1,1,205000,5000,1200,0,NA",
  "2024,LEI1,31080,CA,06059,1,31,105000,3000,800,500,Exempt",
  "2024,LEI2,41860,CA,06075,1,1,505000,7000,2000,0,0",
].join("\n");

function hmdaFetch(options: { csv?: string; count?: number; panel?: boolean } = {}) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/csv?")) return new Response(options.csv ?? CSV, { status: 200 });
    if (url.includes("/aggregations?")) {
      return new Response(JSON.stringify({ aggregations: [{ count: options.count ?? 3, sum: 815000 }] }), { status: 200 });
    }
    if (url.includes("public_panel")) {
      if (options.panel === false) return new Response("missing", { status: 404 });
      const zip = zipSync({ "panel.csv": strToU8("lei,id_rssd,respondent_name\nLEI1,480228,Bank A\n") });
      return new Response(zip as unknown as BodyInit, { status: 200 });
    }
    return new Response("?", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("registry hmda partitions", () => {
  it("expects year Y from July of Y+1", () => {
    expect(latestHmdaYear(new Date("2026-06-30T00:00:00Z"))).toBe(2024);
    expect(latestHmdaYear(new Date("2026-07-01T00:00:00Z"))).toBe(2025);
  });

  it("lists every state of the newest year first", () => {
    const parts = hmdaPartitions(new Date("2026-10-17T00:00:00Z"), 2024);
    expect(parts[0]).toBe("2025-AL");
    expect(parts).toContain("2024-PR");
    expect(parts.at(-1)).toBe("2024-PR");
    expect(parts).toHaveLength(104);
  });

  it("rejects a bad partition key", async () => {
    await expect(runRegistryHmda({ partitionKey: "2025", db: createDb().db })).rejects.toThrow(/Invalid HMDA partition/);
  });
});

describe("registry hmda-apor", () => {
  it("writes both tables' rates", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response("Date|1|30\n1/2/2025|6.1|6.9\n", { status: 200 })) as unknown as typeof fetch;
    const r = await runRegistryHmdaApor({ partitionKey: "current", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ rates: 4, latestEffectiveDate: "2025-01-02", empty: false });
    expect(statements.some((s) => s.text.includes("INSERT INTO hmda_apor_rates"))).toBe(true);
  });

  it("records empty with the reason when no location answers", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    const r = await runRegistryHmdaApor({ partitionKey: "current", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements).reason).toMatch(/no APOR location answered/);
  });
});

describe("registry hmda run", () => {
  it("dry run aggregates and writes nothing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryHmda({ partitionKey: "2024-CA", dryRun: true, db, fetchOptions: { fetchImpl: hmdaFetch(), backoffMs: 0 } });
    expect(r).toMatchObject({ originations: 3, originationAmount: 815000, lenders: 2, originationCells: 3, costCells: 2, empty: false });
    expect(r.reconciliationCountDifference).toBe(0);
    expect(statements).toHaveLength(0);
  });

  it("writes lenders, cells and costs, and removes stale cells once the count ties out", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryHmda({ partitionKey: "2024-CA", db, fetchOptions: { fetchImpl: hmdaFetch(), backoffMs: 0 } });
    expect(r).toMatchObject({ writtenLenders: 2, matchedLenders: 1, unmatchedLenders: 1, writtenOriginationRows: 3, writtenCostRows: 2, removedStaleRows: 2 });
    const detail = partitionDetail(statements);
    expect(detail.parser_version).toBe(1);
    expect(detail.cleaning.unmatched_lenders).toBe(1);
    expect(detail.cleaning.lenders_not_in_panel).toBe(1);
    expect(detail.cleaning.panel_rssd_field).toBe("ID_RSSD");
  });

  it("keeps old cells when the stream does not tie out, and survives a missing panel", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryHmda({ partitionKey: "2024-CA", db, fetchOptions: { fetchImpl: hmdaFetch({ count: 4, panel: false }), backoffMs: 0 } });
    expect(r.removedStaleRows).toBe(0);
    expect(r.panelAvailable).toBe(false);
    expect(statements.some((s) => s.text.includes("DELETE FROM"))).toBe(false);
    expect(partitionDetail(statements).stale_rows_kept_because).toMatch(/did not tie out/);
  });

  it("records an empty partition when the CSV lacks required fields", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryHmda({ partitionKey: "2025-CA", db, fetchOptions: { fetchImpl: hmdaFetch({ csv: "message\nnot published\n" }), backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(r.emptyReason).toMatch(/lacks required fields/);
    expect(partitionDetail(statements).reason).toMatch(/lei/);
    expect(statements.some((s) => s.text.includes("INSERT INTO hmda_"))).toBe(false);
  });
});
