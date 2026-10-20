// @vitest-environment node
/**
 * Proves the call_report_quarterly_income readers return exactly what the per-request SQL
 * returned (the oracle: call-reports-legacy.ts and hubRevenueLegacySql, the pre-summary text
 * unchanged). Connection-owned TEMP fixtures with production column types; loopback databases only.
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

import {
  getDistrictFeeRevenue, getDistrictIncomeTrend, getInstitutionPeerRanking,
  getInstitutionRevenueTrend, getPeerServiceChargeMedians, getRevenueByTier,
  getRevenueTrend, getServiceChargeIntensity, getServiceChargeIntensityTrend, getTopRevenueInstitutions,
} from "./call-reports";
import { callReportQuartersReady, resetCallReportQuartersReady } from "./call-report-quarters";
import * as legacy from "./call-reports-legacy";
import * as summary from "./call-reports-summary";
import { hubRevenueLegacySql, hubRevenueSummarySql } from "./district-hub";
import { markCallReportSummariesDue, runRegistryCallReportSummaries } from "@/lib/agents/magellan/registry/call-report-summaries";
import type { RegistryDb } from "@/lib/agents/magellan/registry/partitions";

const MIGRATION = join(process.cwd(), "supabase", "migrations", "20270110000073_call_report_quarterly_income.sql");
const connection = process.env.E2E_DATABASE_URL;

const BANKS = [101, 102, 103, 104, 105, 106];
const CUS = [1, 2, 3, 4, 5, 6, 7];
const YEARS = [2023, 2024, 2025, 2026];
const QUARTER_ENDS = ["03-31", "06-30", "09-30", "12-31"];

/** Every reader call the pages make, with the parameters they pass. */
async function readEverything() {
  const out: Record<string, unknown> = {};
  out.trend = await getRevenueTrend(8);
  out.trendFdic = await getRevenueTrend(8, "fdic");
  out.trendNcua = await getRevenueTrend(8, "ncua");
  out.trendShort = await getRevenueTrend(2, "ncua");
  out.top = await getTopRevenueInstitutions(5);
  out.topFdic = await getTopRevenueInstitutions(4, "fdic");
  out.topNcua = await getTopRevenueInstitutions(20, "ncua");
  out.districtTrend = await getDistrictIncomeTrend(20);
  out.districtTrendNcua = await getDistrictIncomeTrend(6, "ncua");
  for (const district of [1, 2]) {
    out[`district${district}`] = await getDistrictFeeRevenue(district);
    out[`district${district}Fdic`] = await getDistrictFeeRevenue(district, undefined, "fdic");
    out[`district${district}Ncua`] = await getDistrictFeeRevenue(district, "2025-09-30", "ncua");
  }
  out.tier = await getRevenueByTier();
  out.tierFdic = await getRevenueByTier(undefined, "fdic");
  out.tierNcua2025 = await getRevenueByTier("2025-06-30", "ncua");
  out.medianBanks = await getPeerServiceChargeMedians("bank", "community", 12, 101);
  out.medianCus = await getPeerServiceChargeMedians("credit_union", "community", 12, 1);
  for (const id of [...BANKS, ...CUS, 999]) {
    out[`trend${id}`] = await getInstitutionRevenueTrend(id, 12);
    out[`ranking${id}`] = await getInstitutionPeerRanking(id);
    out[`intensityTrend${id}`] = await getServiceChargeIntensityTrend(id);
    out[`intensity${id}`] = await getServiceChargeIntensity(id);
  }
  return out;
}

describe.skipIf(!connection)("call_report_quarterly_income readers equal the per-request SQL", () => {
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
      source text NOT NULL, total_assets bigint, total_deposits bigint, service_charge_income bigint,
      other_noninterest_income bigint, fee_income_ratio double precision,
      UNIQUE (institution_id, report_date, source))`;
    await db`CREATE TEMP TABLE institution_structure_events (id bigint, source text, event_key text,
      institution_id bigint, cert text, acquirer_cert text, outgoing_cert text, survivor_cert text,
      effective_date date, change_code text, change_description text, source_url text)`;
    await db`CREATE TEMP TABLE registry_ingest_partitions (
      id bigint GENERATED ALWAYS AS IDENTITY, source text NOT NULL, partition_key text NOT NULL,
      status text NOT NULL DEFAULT 'scheduled', attempts integer NOT NULL DEFAULT 0, row_count integer,
      matched_count integer, unmatched_count integer, inserted_count integer, source_url text,
      agent_run_id bigint, last_error text, detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      next_attempt_after timestamptz NOT NULL DEFAULT NOW(), fetched_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(),
      UNIQUE (source, partition_key))`;
    // The migration itself, on temp tables.
    const ddl = readFileSync(MIGRATION, "utf8")
      .replace(/public\./g, "pg_temp.")
      .replace(/^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;$/gm, "");
    await db.unsafe(ddl);
  });
  afterAll(async () => { if (db) await db.end(); });

  beforeEach(async () => {
    resetCallReportQuartersReady();
    await db`TRUNCATE pg_temp.institution_financial_records, pg_temp.institution_sources,
      pg_temp.institution_structure_events, pg_temp.registry_ingest_partitions,
      pg_temp.call_report_quarterly_income, pg_temp.call_report_summary_groups`;
    for (const id of BANKS) {
      await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier, fed_district, state_code, source)
        VALUES (${id}, ${`Bank ${id}`}, ${String(id)}, 'bank', 'community', ${id <= 103 ? 1 : 2}, ${id <= 103 ? "VA" : "MD"}, 'fdic')`;
    }
    for (const id of CUS) {
      await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier, fed_district, state_code, source)
        VALUES (${id}, ${`Credit Union ${id}`}, ${String(id)}, 'credit_union', 'community', ${id <= 4 ? 1 : 2}, ${id <= 4 ? "VA" : "MD"}, 'ncua')`;
    }
    // An institution with no tier and no district: excluded by scope, never by accident.
    await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type) VALUES (999, 'Orphan', '999', 'bank')`;
    const rows: Array<[number | null, string, string, number | null, number, number, number | null, number | null]> = [];
    for (const year of YEARS) {
      for (const [q, end] of QUARTER_ENDS.entries()) {
        const date = `${year}-${end}`;
        if (date > "2026-06-30") continue;
        for (const id of BANKS) {
          if (id === 102 && date === "2025-09-30") continue; // A missing bank quarter.
          const income = 100 * id + 7 * q + (year - 2023) * 13 + (id === 105 ? -600 : 0); // Bank 105 near zero.
          const assets = id === 106 ? 2_000_000 : 400_000 + id * 1000; // Bank 106 in another size tier.
          rows.push([id, "fdic", date, income, assets, 300_000 + id, id % 2 === 0 ? 0.01 * (id - 100) : null, 50 + id]);
        }
        for (const id of CUS) {
          if (id === 2 && date === "2025-06-30") continue; // Missing Q2: Q3 has no prior quarter.
          if (id === 3 && date === "2026-03-31") continue; // Missing Q1: Q2 has no prior in the year.
          if (id === 4 && year === 2024 && q === 2) continue;
          const perQuarter = 40 + id * 3 + (year - 2023) * 2 + (id === 6 && q === 3 ? -100 : 0); // CU 6: a YTD that falls.
          rows.push([id, "ncua", date, perQuarter * (q + 1), 300_000 + id * 500, 200_000 + id * 10, id <= 3 ? 0.002 * id : null, 20 + id]);
        }
      }
    }
    // CU 7 refiles off quarter-end: the window and exact rules disagree here, and each reader keeps its own.
    rows.push([7, "ncua", "2025-08-31", 222, 303_500, 200_070, null, 27]);
    // ffiec duplicates in other units, and an unmatched FDIC filing; neither may reach a sum.
    rows.push([101, "ffiec", "2026-06-30", 999_999_999, 999_999_999, 999_999_999, 40, 0]);
    rows.push([null, "fdic", "2026-03-31", 777_777, 400_000, 300_000, null, 1]);
    for (const [institution, source, date, sc, assets, deposits, ratio, other] of rows) {
      await db`INSERT INTO institution_financial_records
        (institution_id, source, report_date, service_charge_income, total_assets, total_deposits, fee_income_ratio, other_noninterest_income)
        VALUES (${institution}, ${source}, ${date}, ${sc}, ${assets}, ${deposits}, ${ratio}, ${other})`;
    }
  });

  async function build(options: { dryRun?: boolean } = {}) {
    const result = await runRegistryCallReportSummaries({ db: db as unknown as RegistryDb, runId: 42, ...options });
    resetCallReportQuartersReady();
    return result;
  }

  it("returns the same numbers from the summary as from the filings, for every reader", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await callReportQuartersReady(db as never)).toBe(false);
    const before = await readEverything();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("slow path"));
    warn.mockRestore();

    const built = await build();
    expect(built.groupsChanged).toEqual(expect.arrayContaining(["fdic 2023", "ncua 2026"]));
    expect(built.rowsWritten).toBe(built.filings);
    expect(await callReportQuartersReady(db as never)).toBe(true);
    const after = await readEverything();
    expect(after).toEqual(before);

    // The fixture exercises what it claims to: real numbers, both regulators, missing quarters.
    expect((before.trendNcua as { quarters: unknown[] }).quarters.length).toBeGreaterThan(4);
    expect(before.topFdic).toHaveLength(4);
    expect((before.ranking1 as { sc_income: number }).sc_income).toBeGreaterThan(0);
    expect(before.trend2).toEqual(expect.not.arrayContaining([expect.objectContaining({ quarter: "2025-Q3" })]));
  });

  it("matches the district and state hub rows for every scope", async () => {
    const run = async (text: string, params: unknown[]) =>
      [...(await db.unsafe(text, params as never[]))].map((r) => JSON.stringify(r)).sort();
    const scopes: Array<[string, unknown]> = [["ct.fed_district = $1", 1], ["ct.fed_district = $1", 2], ["ct.state_code = $1", "MD"]];
    const expected = [];
    for (const [scope, value] of scopes) {
      for (const from of ["2023-01-01", "2025-01-01"]) expected.push(await run(hubRevenueLegacySql(scope), [value, from]));
    }
    await build();
    const actual = [];
    for (const [scope, value] of scopes) {
      for (const from of ["2023-01-01", "2025-01-01"]) actual.push(await run(hubRevenueSummarySql(scope), [value, from]));
    }
    expect(actual).toEqual(expected);
    expect(expected[0].length).toBeGreaterThan(0);
  });

  it("reproduces the intensity reads' 30-month cutoff on any day", async () => {
    await build();
    const quarterly = (text: string, day: string) =>
      `WITH ${text.replace(/CURRENT_DATE/g, `DATE '${day}'`)} SELECT institution_id, rd::text, deposits::text, income::text FROM quarterly ORDER BY 1, 2`;
    // One pinned day per quarter position, so the cutoff falls after a Q1, Q2, Q3 and Q4 filing.
    for (const day of ["2026-08-15", "2026-11-15", "2027-02-15", "2027-05-15", "2026-10-01"]) {
      for (const id of [101, 1, 7]) {
        const oldRows = await db.unsafe(quarterly(legacy.INTENSITY_QUARTERS_SQL, day), [id]);
        const newRows = await db.unsafe(quarterly(summary.INTENSITY_QUARTERS_SQL, day), [id]);
        expect([...newRows]).toEqual([...oldRows]);
      }
    }
  });

  it("rebuilds only the regulator-years whose filings changed, and a dry run writes nothing", async () => {
    await build();
    const noChange = await build();
    expect(noChange.groupsChanged).toEqual([]);
    expect(noChange.rowsWritten).toBe(0);

    // An amended NCUA filing, a new FDIC quarter and an unmatched filing matched to its bank.
    await db`UPDATE institution_financial_records SET service_charge_income = service_charge_income + 50
      WHERE institution_id = 1 AND source = 'ncua' AND report_date = '2025-06-30'`;
    await db`INSERT INTO institution_financial_records (institution_id, source, report_date, service_charge_income, total_assets, total_deposits)
      VALUES (101, 'fdic', '2026-09-30', 12345, 401000, 300101)`;
    await db`DELETE FROM institution_financial_records WHERE institution_id = 104 AND source = 'fdic' AND report_date = '2026-03-31'`;
    await db`UPDATE institution_financial_records SET institution_id = 104 WHERE institution_id IS NULL`;

    const dry = await build({ dryRun: true });
    expect([...dry.groupsChanged].sort()).toEqual(["fdic 2026", "ncua 2025"]);
    expect(Number((await db`SELECT COUNT(*) AS n FROM call_report_quarterly_income WHERE report_date = '2026-09-30'`)[0].n)).toBe(0);

    // Oracle: the per-request SQL over the changed filings, read while the summary is set aside.
    await db`CREATE TEMP TABLE summary_backup AS SELECT * FROM call_report_quarterly_income`;
    await db`TRUNCATE pg_temp.call_report_quarterly_income`;
    resetCallReportQuartersReady();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const expected = await readEverything();
    warn.mockRestore();
    await db`INSERT INTO call_report_quarterly_income SELECT * FROM summary_backup`;
    await db`DROP TABLE summary_backup`;

    const incremental = await build();
    expect([...incremental.groupsChanged].sort()).toEqual(["fdic 2026", "ncua 2025"]);
    expect(incremental.rowsWritten).toBeLessThan(incremental.filings / 3);
    expect(await readEverything()).toEqual(expected);
    const [partition] = await db`SELECT status, next_attempt_after > NOW() + INTERVAL '23 hours' AS rechecks_daily,
      detail::text AS groups_changed FROM registry_ingest_partitions WHERE source = 'call-report-summaries'`;
    expect(partition).toMatchObject({ status: "succeeded", rechecks_daily: true });
    expect(JSON.stringify(partition.groups_changed)).toContain("ncua 2025");
  });

  it("makes the summary due at once after a call-report load", async () => {
    await build();
    await markCallReportSummariesDue(db as unknown as RegistryDb);
    const [row] = await db`SELECT next_attempt_after <= NOW() AS due FROM registry_ingest_partitions WHERE source = 'call-report-summaries'`;
    expect(row.due).toBe(true);
  });

  it("joins the run step's transaction and drops a regulator-year whose filings are gone", async () => {
    await build();
    await db`DELETE FROM institution_financial_records WHERE report_date LIKE '2023-%'`;
    const result = await db.begin((tx) => runRegistryCallReportSummaries({ db: tx as unknown as RegistryDb, runId: 7 }));
    expect(result.groupsRemoved.sort()).toEqual(["fdic 2023", "ncua 2023"]);
    const left = await db`SELECT COUNT(*) AS n FROM call_report_quarterly_income WHERE report_year = 2023`;
    expect(Number(left[0].n)).toBe(0);
    const groups = await db`SELECT source FROM call_report_summary_groups WHERE report_year = 2023`;
    expect(groups.length).toBe(0);
  });
});
