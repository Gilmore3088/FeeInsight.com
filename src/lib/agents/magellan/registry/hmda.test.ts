import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HMDA_PARSER_VERSION, hmdaPartitions, latestHmdaYear, runRegistryHmda, runRegistryHmdaApor } from "./hmda";
import type { RegistryDb } from "./partitions";

const release = vi.hoisted(() => ({ HMDA_ORDINARY_IDENTITY_WRITES_ENABLED: true }));
vi.mock("@/lib/agents/hoovie/hmda-repair-release", () => release);
beforeEach(() => { release.HMDA_ORDINARY_IDENTITY_WRITES_ENABLED = true; });

const LEI1 = "549300OSSFHX7ABQ2Y81";
const LEI2 = "254900B5PW4JPZAQI721";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_sources s")) return Promise.resolve([{ id: 1, lei: LEI1, rssd_id: "480228" }]);
    if (text.includes("SELECT clock_timestamp() AS started_at")) return Promise.resolve([{ started_at: "2026-10-17T00:00:00Z" }]);
    if (text.includes("INSERT INTO hmda_lenders")) return Promise.resolve([{ matched: true }, { matched: false }]);
    if (text.includes("INSERT INTO hmda_lender_originations")) return Promise.resolve([{}, {}, {}]);
    if (text.includes("INSERT INTO hmda_lender_loan_costs")) return Promise.resolve([{}, {}]);
    if (text.includes("UPDATE hmda_lender_originations")) return Promise.resolve([{}, {}]);
    if (text.includes("UPDATE hmda_lender_loan_costs")) return Promise.resolve([{}]);
    if (text.includes("DELETE FROM")) return Promise.resolve([{}]);
    return Promise.resolve([]);
  });
  Object.assign(db, { begin: async (callback: (tx: unknown) => Promise<unknown>) => callback(db) });
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
].join("\n").replaceAll("LEI1", LEI1).replaceAll("LEI2", LEI2);

function hmdaFetch(options: { csv?: string; count?: number; panel?: boolean } = {}) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/csv?")) return new Response(options.csv ?? CSV, { status: 200 });
    if (url.includes("/aggregations?")) {
      return new Response(JSON.stringify({ aggregations: [{ count: options.count ?? 3, sum: 815000 }] }), { status: 200 });
    }
    if (url.includes("public_panel")) {
      if (options.panel === false) return new Response("missing", { status: 404 });
      const zip = zipSync({ "panel.csv": strToU8(`lei,id_rssd,respondent_name\n${LEI1},480228,Bank A\n`) });
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
    expect(r).toMatchObject({ matchedLenders: 1, unmatchedLenders: 1, matching: { matched: 1, ambiguous: 0, unmatched: 1 } });
    expect(statements.some((s) => /INSERT|UPDATE|DELETE/i.test(s.text))).toBe(false);
  });

  it("writes lenders, cells and costs, and removes stale cells once the count ties out", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryHmda({ partitionKey: "2024-CA", db, fetchOptions: { fetchImpl: hmdaFetch(), backoffMs: 0 } });
    expect(r).toMatchObject({ writtenLenders: 2, matchedLenders: 1, unmatchedLenders: 1, writtenOriginationRows: 3, writtenCostRows: 2,
      propagatedOriginationRows: 2, propagatedCostRows: 1, removedStaleRows: 2 });
    const detail = partitionDetail(statements);
    expect(detail.parser_version).toBe(HMDA_PARSER_VERSION);
    expect(detail.cleaning.unmatched_lenders).toBe(1);
    expect(detail).toMatchObject({ propagated_origination_rows: 2, propagated_cost_rows: 1 });
    expect(detail.cleaning.lenders_not_in_panel).toBe(2);
    expect(detail.cleaning.panel_rssd_field).toBeNull();
    expect(detail.matching).toMatchObject({ matched: 1, unmatched: 1, ambiguous: 0 });
    const lockAt = statements.findIndex((s) => s.text.includes("pg_advisory_xact_lock"));
    const readAt = statements.findIndex((s) => s.text.includes("FROM institution_sources s"));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(readAt).toBeGreaterThan(lockAt);
  });

  it("does not propagate annual identities while ordinary identity rollout is disabled", async () => {
    release.HMDA_ORDINARY_IDENTITY_WRITES_ENABLED = false;
    const { db, statements } = createDb();
    const result = await runRegistryHmda({ partitionKey: "2024-CA", db, fetchOptions: { fetchImpl: hmdaFetch(), backoffMs: 0 } });
    expect(result).toMatchObject({ propagatedOriginationRows: 0, propagatedCostRows: 0 });
    expect(partitionDetail(statements).identity_writes_enabled).toBe(false);
    expect(statements.some((s) => s.text.includes("UPDATE hmda_lender_originations"))).toBe(false);
    expect(statements.some((s) => s.text.includes("UPDATE hmda_lender_loan_costs"))).toBe(false);
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
