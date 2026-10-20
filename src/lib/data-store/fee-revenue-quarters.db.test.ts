// @vitest-environment node
/**
 * Proves the fee-revenue readers return exactly what their per-request SQL returned (the
 * oracle: the QUARTERLY_FINANCIALS LATERAL over institution_financial_records, run while
 * call_report_quarterly_income is empty) once they read the summary table instead (#1048).
 * Connection-owned TEMP fixtures with production column types; loopback databases only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./connection", () => ({
  getSql: () => context.db,
  sql: Object.assign((...args: unknown[]) => Reflect.apply(context.db as (...args: unknown[]) => unknown, null, args), {
    unsafe: (...args: unknown[]) => Reflect.apply((context.db as { unsafe: (...args: unknown[]) => unknown }).unsafe, context.db, args),
  }),
}));

import { getCharterFeeRevenueSummary, getFeeRevenueData, getFiledFeeIncomeData, getTierFeeRevenueSummary } from "./fee-revenue";
import { resetCallReportQuartersReady } from "./call-report-quarters";
import { runRegistryCallReportSummaries } from "@/lib/agents/magellan/registry/call-report-summaries";
import type { RegistryDb } from "@/lib/agents/magellan/registry/partitions";
import type { FinancialSource } from "./financial-sources";

const MIGRATION = join(process.cwd(), "supabase", "migrations", "20270110000073_call_report_quarterly_income.sql");
const connection = process.env.E2E_DATABASE_URL;
const SOURCES: Array<FinancialSource | undefined> = [undefined, "fdic", "ncua"];
const QUARTER_ENDS = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"];

/** Every fee-revenue reader, for each source scope the pages and Hamilton pass. */
async function readEverything() {
  const out: Record<string, unknown> = {};
  for (const source of SOURCES) {
    const key = source ?? "all";
    out[`filed_${key}`] = await getFiledFeeIncomeData(source);
    out[`correlation_${key}`] = await getFeeRevenueData(source);
    out[`tier_${key}`] = await getTierFeeRevenueSummary(source);
    out[`charter_${key}`] = await getCharterFeeRevenueSummary(source);
  }
  return out;
}

describe.skipIf(!connection)("fee-revenue readers equal their per-request SQL on call_report_quarterly_income", () => {
  let db: ReturnType<typeof postgres>;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Fee-revenue summary tests require a loopback database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, onnotice: () => {} });
    context.db = db;
    await db`CREATE TEMP TABLE institution_sources (
      id bigint PRIMARY KEY, institution_name text, cert_number text, charter_type text,
      asset_size_tier text, fed_district integer, state_code text, regulatory_status text)`;
    // Production column types (tests/e2e/production-schema.sql).
    await db`CREATE TEMP TABLE institution_financial_records (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, institution_id bigint, report_date text NOT NULL,
      source text NOT NULL, total_assets bigint, total_deposits bigint, service_charge_income bigint,
      other_noninterest_income bigint, fee_income_ratio double precision,
      UNIQUE (institution_id, report_date, source))`;
    await db`CREATE TEMP TABLE published_fee_catalog (
      institution_id bigint, canonical_fee_key text, fee_category text, fee_name text,
      amount numeric, review_status text, source_document_id bigint, fee_audience text,
      source_url text, frequency text)`;
    await db`CREATE TEMP TABLE registry_ingest_partitions (
      id bigint GENERATED ALWAYS AS IDENTITY, source text NOT NULL, partition_key text NOT NULL,
      status text NOT NULL DEFAULT 'scheduled', attempts integer NOT NULL DEFAULT 0, row_count integer,
      matched_count integer, unmatched_count integer, inserted_count integer, source_url text,
      agent_run_id bigint, last_error text, detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      next_attempt_after timestamptz NOT NULL DEFAULT NOW(), fetched_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(),
      UNIQUE (source, partition_key))`;
    const ddl = readFileSync(MIGRATION, "utf8")
      .replace(/public\./g, "pg_temp.")
      .replace(/^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;$/gm, "");
    await db.unsafe(ddl);
  });
  afterAll(async () => { if (db) await db.end(); });

  async function institution(id: number, charter: string, tier: string | null, status: string | null = null) {
    await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier, fed_district, state_code, regulatory_status)
      VALUES (${id}, ${`Institution ${id}`}, ${String(id)}, ${charter}, ${tier}, ${id % 2 === 0 ? 1 : 5}, 'VA', ${status})`;
  }

  async function filing(id: number | null, source: string, date: string, income: number | null, assets: number) {
    await db`INSERT INTO institution_financial_records (institution_id, source, report_date, service_charge_income, total_assets, total_deposits)
      VALUES (${id}, ${source}, ${date}, ${income}, ${assets}, ${Math.round(assets * 0.8)})`;
  }

  async function fees(id: number, amounts: number[]) {
    const keys = ["overdraft", "nsf", "wire_domestic_outgoing", "monthly_maintenance"];
    for (const [index, amount] of amounts.entries()) {
      await db`INSERT INTO published_fee_catalog VALUES (${id}, ${keys[index]}, ${keys[index]}, 'Fee', ${amount},
        'approved', 1, 'consumer', 'https://example.test/personal/fees', 'per_item')`;
    }
  }

  beforeEach(async () => {
    resetCallReportQuartersReady();
    await db`TRUNCATE pg_temp.institution_financial_records, pg_temp.institution_sources, pg_temp.published_fee_catalog,
      pg_temp.registry_ingest_partitions, pg_temp.call_report_quarterly_income, pg_temp.call_report_summary_groups`;
    // Banks: quarterly FDIC income.
    for (const id of [101, 102, 103, 104, 105, 106]) {
      await institution(id, "bank", id === 106 ? null : id <= 103 ? "community" : "regional", id === 104 ? "inactive" : null);
      for (const [q, date] of QUARTER_ENDS.entries()) {
        await filing(id, "fdic", date, 100 * id + 9 * q, id <= 103 ? 400_000 + id : 4_000_000 + id);
      }
      await fees(id, [25 + (id % 5), 20 + (id % 3), 15, 5 + (id % 4)]);
    }
    await filing(102, "fdic", "2026-09-30", 10_555, 402_000); // A newer quarter for one bank.
    await filing(103, "fdic", "2026-09-30", null, 403_000); // Newest filing without the line: no figure.
    await filing(105, "ffiec", "2026-09-30", 999_999_999, 999_999_999); // Other units: never read.
    // Credit unions: NCUA year-to-date income.
    for (const id of [1, 2, 3, 4, 5, 6]) {
      await institution(id, "credit_union", id <= 3 ? "community" : "regional");
      for (const [q, date] of QUARTER_ENDS.entries()) {
        if (id === 2 && date === "2026-03-31") continue; // Q2 has no prior quarter end: no figure.
        if (id === 3 && date === "2026-06-30") continue; // Latest filing is a Q1: stands alone.
        const perQuarter = 30 + id * 4 + (id === 6 && q === 5 ? -200 : 0); // CU 6: a falling YTD.
        await filing(id, "ncua", date, perQuarter * ((q % 4) + 1), 300_000 + id * 500);
      }
      await fees(id, [30 + id, 25, 10 + id]);
    }
    await filing(4, "ncua", "2026-08-31", 410, 302_100); // An off-quarter refiling: exact rule reads 06-30.
    await filing(5, "fdic", "2026-09-30", 777, 999_000); // Wrong regulator for a credit union: never read.
    // A charter outside bank/credit union, a CU with too few fees, one with no filings, an unmatched filing.
    await institution(7, "unknown", "community");
    await filing(7, "ncua", "2026-06-30", 90, 300_700);
    await fees(7, [10, 20, 30]);
    await institution(8, "credit_union", "community");
    await filing(8, "ncua", "2026-03-31", 44, 300_800);
    await fees(8, [10, 20]);
    await institution(9, "credit_union", "community");
    await fees(9, [10, 20, 30]);
    await filing(null, "fdic", "2026-06-30", 888_888, 400_000);
  });

  it("returns the same rows from the summary as from the filings, and reads only the summary", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = await readEverything();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("slow path"));
    warn.mockClear();

    const built = await runRegistryCallReportSummaries({ db: db as unknown as RegistryDb, runId: 42 });
    expect(built.rowsWritten).toBe(built.filings);
    resetCallReportQuartersReady();
    expect(await readEverything()).toEqual(before);
    expect(warn).not.toHaveBeenCalled();

    // With the filings gone, only a reader of the summary can still return the same rows.
    await db`TRUNCATE pg_temp.institution_financial_records`;
    expect(await readEverything()).toEqual(before);
    warn.mockRestore();

    // The fixture exercises what it claims: both regulators, split quarters, exclusions.
    const filed = before.filed_all as Array<{ institution_id: number; report_date: string; service_charge_income: number }>;
    const byId = new Map(filed.map((row) => [row.institution_id, row]));
    expect(byId.get(102)).toMatchObject({ report_date: "2026-09-30", service_charge_income: 10_555 });
    expect(byId.get(1)).toMatchObject({ report_date: "2026-06-30", service_charge_income: 34 });
    expect(byId.get(3)).toMatchObject({ report_date: "2026-03-31", service_charge_income: 42 });
    expect(byId.get(4)).toMatchObject({ report_date: "2026-08-31", service_charge_income: 410 - 46 * 2 });
    expect(byId.get(6)?.service_charge_income).toBeLessThan(0);
    for (const missing of [2, 7, 9, 103]) expect(byId.has(missing)).toBe(false);
    expect(byId.get(5)).toMatchObject({ report_date: "2026-06-30", financial_source: "ncua" });
    expect((before.correlation_all as unknown[]).length).toBeGreaterThan(5);
    expect((before.tier_ncua as unknown[]).length).toBeGreaterThan(0);
    expect((before.charter_fdic as unknown[]).length).toBeGreaterThan(0);
  });
});
