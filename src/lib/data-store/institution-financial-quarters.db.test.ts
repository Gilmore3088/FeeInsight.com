// @vitest-environment node
/**
 * The financial performance view's reads (#1892) against real Postgres: the institution's own
 * filings with their raw filing variables, and the peer medians, which must be the same numbers
 * from call_report_quarterly_income as from the per-request SQL. Connection-owned TEMP fixtures;
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

import { getFinancialPeerMedians, getInstitutionFiledQuarters } from "./institution-financial-quarters";
import { callReportQuartersReady, resetCallReportQuartersReady } from "./call-report-quarters";
import { readFinancialPerformance } from "@/lib/hamilton/financial-performance-read";
import { runRegistryCallReportSummaries } from "@/lib/agents/magellan/registry/call-report-summaries";
import type { RegistryDb } from "@/lib/agents/magellan/registry/partitions";

const MIGRATION = join(process.cwd(), "supabase", "migrations", "20270110000073_call_report_quarterly_income.sql");
const connection = process.env.E2E_DATABASE_URL;

const SUBJECT = 50;
const PEERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DATES = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"];
const q = (date: string) => Math.ceil(Number(date.slice(5, 7)) / 3);

describe.skipIf(!connection)("financial performance reads (#1892)", () => {
  let db: ReturnType<typeof postgres>;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Financial performance tests require a loopback database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, onnotice: () => {} });
    context.db = db;
    await db`CREATE TEMP TABLE institution_sources (
      id bigint PRIMARY KEY, institution_name text, cert_number text, charter_type text,
      asset_size_tier text, fed_district integer, state_code text, regulatory_status text,
      source text, ncua_charter_id text, closed_date date)`;
    await db`CREATE TEMP TABLE institution_financial_records (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, institution_id bigint, report_date text NOT NULL,
      source text NOT NULL, total_assets bigint, total_deposits bigint, service_charge_income bigint,
      other_noninterest_income bigint, fee_income_ratio double precision, raw_json jsonb, source_url text,
      source_cert_number text, fetched_at timestamptz NOT NULL DEFAULT NOW(),
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
    await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier, source)
      VALUES (${SUBJECT}, 'Subject Credit Union', '50', 'credit_union', 'community', 'ncua')`;
    for (const id of PEERS) {
      await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier, source)
        VALUES (${id}, ${`Peer ${id}`}, ${String(id)}, 'credit_union', 'community', 'ncua')`;
    }
    // Not peers: another size tier, and a bank.
    await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier, source)
      VALUES (60, 'Large Credit Union', '60', 'credit_union', 'large', 'ncua'), (70, 'A Bank', '70', 'bank', 'community', 'fdic')`;

    const insert = async (id: number, source: string, date: string, ytd: number, deposits: number, assets: number, raw: Record<string, number> | null) => {
      await db`INSERT INTO institution_financial_records
        (institution_id, source, report_date, service_charge_income, total_deposits, total_assets, raw_json, source_url, source_cert_number)
        VALUES (${id}, ${source}, ${date}, ${ytd}, ${deposits}, ${assets}, ${raw ? db.json(raw) : null},
                ${"https://ncua.gov/files/call-report-data.zip"}, ${String(id)})`;
    };
    for (const date of DATES) {
      const ytd = 300 * q(date);
      await insert(SUBJECT, "ncua", date, ytd, 90_000, 100_000, { ACCT_131: ytd * 1000 + 120, ACCT_018: 90_000_000, ACCT_010: 100_000_000 });
      for (const id of PEERS) {
        if (id === 11 && date === "2026-03-31") continue; // Its Q2 2026 cannot be split.
        await insert(id, "ncua", date, (40 + id) * q(date), 200_000 + id * 10, 250_000 + id * 10, null);
      }
      await insert(60, "ncua", date, 9_000 * q(date), 900_000, 1_000_000, null);
      await insert(70, "fdic", date, 77, 80_000, 90_000, null);
    }
    // Neither may reach the view: a duplicate in other units and an off-quarter-end refiling.
    await insert(SUBJECT, "ffiec", "2026-06-30", 999_999, 999_999, 999_999, null);
    await insert(SUBJECT, "ncua", "2026-05-31", 1, 1, 1, null);
  });

  it("reads the subject's own filings with the filing variables, newest first", async () => {
    const rows = await getInstitutionFiledQuarters(SUBJECT);
    expect(rows.map((r) => r.reportDate)).toEqual([...DATES].reverse());
    expect(rows.every((r) => r.source === "ncua")).toBe(true);
    expect(rows[0]).toMatchObject({ feeIncome: 600, rawFeeIncome: 600_120, rawDeposits: 90_000_000, rawAssets: 100_000_000, certNumber: "50" });
    expect(rows[0].retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gives the same peer medians from the summary table as from the filings, subject left out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await callReportQuartersReady(db as never)).toBe(false);
    const before = await getFinancialPeerMedians(SUBJECT, DATES);
    warn.mockRestore();
    await runRegistryCallReportSummaries({ db: db as unknown as RegistryDb, runId: 42 });
    resetCallReportQuartersReady();
    expect(await callReportQuartersReady(db as never)).toBe(true);
    const after = await getFinancialPeerMedians(SUBJECT, DATES);
    expect(after).toEqual(before);

    const latest = after.find((r) => r.reportDate === "2026-06-30")!;
    // Peers 1-10 report a standalone quarter of 41..50; peer 11's has no prior filing.
    expect(latest).toMatchObject({ feePeers: 10, feeMedian: 45.5, depositsPeers: 11, depositsMedian: 200_060, assetsPeers: 11 });
    const q1 = after.find((r) => r.reportDate === "2026-03-31")!;
    expect(q1.feePeers).toBe(10);
  });

  it("builds the view: standalone quarters, the filed year to date, peers and a matching filing check", async () => {
    const { view, peerReadFailed } = await readFinancialPerformance(SUBJECT);
    expect(peerReadFailed).toBe(false);
    const latest = view!.quarters[0];
    expect(latest.reportDate).toBe("2026-06-30");
    expect(latest.fee.value).toBe(300);
    expect(latest.fee.yearToDate).toBe(600);
    expect(latest.fee.peerMedian).toBe(45.5);
    expect(latest.fee.yoyPct).toBe(0);
    expect(latest.evidence.variables.map((v) => v.check)).toEqual(["matches", "matches", "matches"]);
    expect(view!.quarters).toHaveLength(6);
  });
});
