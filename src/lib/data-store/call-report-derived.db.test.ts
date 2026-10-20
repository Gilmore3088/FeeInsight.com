// @vitest-environment node
/**
 * Proves the derived call-report readers (getRevenuePerInstitutionTrend, getDepositGrowthTrend,
 * getInstitutionCountTrends) return exactly what their per-request SQL returned once they read
 * call_report_quarterly_income. The oracle is the legacy text in call-report-derived-sql.ts, the
 * pre-summary SQL unchanged. Connection-owned TEMP fixtures with production column types;
 * loopback databases only.
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

import { getRevenuePerInstitutionTrend } from "./derived-analytics";
import { getDepositGrowthTrend, getInstitutionCountTrends, getLoanGrowthTrend } from "./health";
import { callReportQuartersReady, resetCallReportQuartersReady } from "./call-report-quarters";
import {
  DEPOSIT_GROWTH_SUMMARY_SQL, INSTITUTION_COUNT_LEGACY_SQL, INSTITUTION_COUNT_SUMMARY_SQL,
  growthTrendLegacySql, revenuePerInstitutionLegacySql, revenuePerInstitutionSummarySql, type ScopedSource,
} from "./call-report-derived-sql";
import { runRegistryCallReportSummaries } from "@/lib/agents/magellan/registry/call-report-summaries";
import type { RegistryDb } from "@/lib/agents/magellan/registry/partitions";

const MIGRATION = join(process.cwd(), "supabase", "migrations", "20270110000073_call_report_quarterly_income.sql");
const connection = process.env.E2E_DATABASE_URL;

const BANKS = [101, 102, 103, 104, 105];
const CUS = [1, 2, 3, 4, 5];
const YEARS = [2024, 2025, 2026];
const QUARTER_ENDS = ["03-31", "06-30", "09-30", "12-31"];
const SOURCES = [undefined, "fdic", "ncua"] as const;
const SCOPES: ScopedSource[] = ["source IN ('fdic', 'ncua')", "source = 'fdic'", "source = 'ncua'"];

/** Every switched reader, with every parameter the Hamilton chat tools pass and the edges. */
async function readSwitched() {
  const out: Record<string, unknown> = {};
  for (const source of SOURCES) {
    for (const quarters of [1, 4, 8, 40]) {
      out[`rpi${source}${quarters}`] = await getRevenuePerInstitutionTrend(quarters, source);
    }
    out[`deposits${source}`] = await getDepositGrowthTrend(8, source);
    out[`depositsShort${source}`] = await getDepositGrowthTrend(2, source);
    out[`counts${source}`] = await getInstitutionCountTrends(8, source);
    out[`countsShort${source}`] = await getInstitutionCountTrends(3, source);
  }
  return out;
}

describe.skipIf(!connection)("derived call-report readers equal the per-request SQL", () => {
  let db: ReturnType<typeof postgres>;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Call-report summary tests require a loopback database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, onnotice: () => {} });
    context.db = db;
    await db`CREATE TEMP TABLE institution_sources (
      id bigint PRIMARY KEY, institution_name text, cert_number text, charter_type text,
      asset_size_tier text, fed_district integer, state_code text, regulatory_status text,
      source text, ncua_charter_id text, closed_date date)`;
    // Production column types (tests/e2e/production-schema.sql).
    await db`CREATE TEMP TABLE institution_financial_records (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, institution_id bigint, report_date text NOT NULL,
      source text NOT NULL, total_assets bigint, total_deposits bigint, total_loans bigint,
      service_charge_income bigint, other_noninterest_income bigint, fee_income_ratio double precision,
      UNIQUE (institution_id, report_date, source))`;
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

  beforeEach(async () => {
    resetCallReportQuartersReady();
    await db`TRUNCATE pg_temp.institution_financial_records, pg_temp.institution_sources,
      pg_temp.registry_ingest_partitions, pg_temp.call_report_quarterly_income, pg_temp.call_report_summary_groups`;
    for (const id of BANKS) {
      await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier, source)
        VALUES (${id}, ${`Bank ${id}`}, ${String(id)}, 'bank', ${id === 105 ? "regional" : "community"}, 'fdic')`;
    }
    for (const id of CUS) {
      await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier, source)
        VALUES (${id}, ${`Credit Union ${id}`}, ${String(id)}, 'credit_union', ${id === 5 ? null : "community"}, 'ncua')`;
    }
    // A bank whose filings come from NCUA: the charter-source rule drops it from every reader.
    await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier)
      VALUES (900, 'Mismatched', '900', 'bank', 'community')`;
    type Row = [number | null, string, string, number | null, number, number | null, number | null];
    const rows: Row[] = [];
    for (const year of YEARS) {
      for (const [q, end] of QUARTER_ENDS.entries()) {
        const date = `${year}-${end}`;
        if (date > "2026-06-30") continue;
        for (const id of BANKS) {
          if (id === 102 && date === "2025-09-30") continue; // A missing bank quarter.
          const deposits = id === 103 && year === 2024 ? null : id === 104 && q === 1 ? 0 : 300_000 + id * 10 + year;
          rows.push([id, "fdic", date, 100 * id + 7 * q + (year - 2024) * 13, 400_000 + id * 1000, deposits, 250_000 + id]);
        }
        for (const id of CUS) {
          if (id === 2 && date === "2025-06-30") continue; // Missing Q2: Q3 has no prior quarter.
          if (id === 3 && date === "2026-03-31") continue; // Missing Q1.
          const perQuarter = 40 + id * 3 + (year - 2024) * 2 + (id === 4 && q === 3 ? -100 : 0); // CU 4: a YTD that falls.
          rows.push([id, "ncua", date, perQuarter * (q + 1), 300_000 + id * 500, 200_000 + id * 10 + q, 150_000 + id]);
        }
        rows.push([900, "ncua", date, 999, 1_000, 1_000, 1_000]);
      }
    }
    // CU 1 refiles off quarter-end: two filings in one quarter.
    rows.push([1, "ncua", "2025-08-31", 222, 301_500, 200_070, 150_001]);
    // An early filing with zero deposits: it must not set its quarter's first date.
    rows.push([2, "ncua", "2024-07-15", 90, 301_000, 0, 150_002]);
    // ffiec duplicates in other units; neither may reach a sum.
    rows.push([101, "ffiec", "2026-06-30", 999_999_999, 999_999_999, 999_999_999, 999_999_999]);
    // Unmatched filings: one at a date no matched filer has, so the latest-dates list includes it.
    rows.push([null, "fdic", "2026-03-31", 777_777, 400_000, 300_000, 1]);
    rows.push([null, "fdic", "2026-09-30", 888_888, 400_000, 300_000, 1]);
    rows.push([null, "ncua", "2026-07-31", 5, 5, 5, 5]);
    for (const [institution, source, date, sc, assets, deposits, loans] of rows) {
      await db`INSERT INTO institution_financial_records
        (institution_id, source, report_date, service_charge_income, total_assets, total_deposits, total_loans)
        VALUES (${institution}, ${source}, ${date}, ${sc}, ${assets}, ${deposits}, ${loans})`;
    }
  });

  async function build() {
    const result = await runRegistryCallReportSummaries({ db: db as unknown as RegistryDb, runId: 42 });
    resetCallReportQuartersReady();
    return result;
  }

  const sorted = async (text: string, params: unknown[] = []) =>
    [...(await db.unsafe(text, params as never[]))].map((r) => JSON.stringify(r)).sort();

  it("returns the same numbers from the summary as from the filings, and reads only the summary", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await callReportQuartersReady(db as never)).toBe(false);
    const before = await readSwitched();
    const loansBefore = await getLoanGrowthTrend(8);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("slow path"));
    warn.mockRestore();

    const built = await build();
    expect(built.rowsWritten).toBe(built.filings);
    expect(await callReportQuartersReady(db as never)).toBe(true);
    expect(await readSwitched()).toEqual(before);
    // Loans are not in the summary, so that reader still reads the filings, unchanged.
    expect(await getLoanGrowthTrend(8)).toEqual(loansBefore);

    // With the filings gone, the switched readers still answer: they read the summary alone.
    await db`TRUNCATE pg_temp.institution_financial_records`;
    expect(await readSwitched()).toEqual(before);

    // The fixture exercises what it claims to: real numbers, both regulators, gaps.
    const rpi = before.rpiundefined8 as Awaited<ReturnType<typeof getRevenuePerInstitutionTrend>>;
    expect(rpi.trend.length).toBeGreaterThan(4);
    expect(rpi.current.by_charter.length).toBe(2);
    expect((before.depositsfdic as { history: unknown[] }).history.length).toBe(8);
    expect((before.countsncua as unknown[]).length).toBe(8);
  });

  it("returns the same rows from each SQL twin, for every scope and size", async () => {
    const expected: string[][] = [];
    const twins = (legacy: boolean) => {
      const queries: Array<[string, unknown[]]> = [];
      for (const scope of SCOPES) {
        for (const n of [1, 2, 4, 40]) {
          queries.push([legacy ? revenuePerInstitutionLegacySql(scope, n) : revenuePerInstitutionSummarySql(scope, n), []]);
        }
      }
      for (const source of [null, "fdic", "ncua"]) {
        for (const n of [3, 12]) {
          queries.push([legacy ? growthTrendLegacySql("total_deposits") : DEPOSIT_GROWTH_SUMMARY_SQL, [n, source]]);
          queries.push([legacy ? INSTITUTION_COUNT_LEGACY_SQL : INSTITUTION_COUNT_SUMMARY_SQL, [n, source]]);
        }
      }
      return queries;
    };
    for (const [text, params] of twins(true)) expected.push(await sorted(text, params));
    await build();
    const actual: string[][] = [];
    for (const [text, params] of twins(false)) actual.push(await sorted(text, params));
    expect(actual).toEqual(expected);
    // Only the four latest-dates reads that land on unmatched-only dates (2026-09-30, 2026-07-31)
    // are empty; that edge is what proves the summary keeps unmatched filings in the date list.
    expect(expected.filter((rows) => rows.length === 0)).toHaveLength(4);
  });
});
