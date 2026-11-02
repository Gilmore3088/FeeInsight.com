// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { upsertFdicFinancialChunk } from "@/lib/agents/magellan/registry/fdic-financials";
import { upsertNcuaFinancialChunk } from "@/lib/agents/magellan/registry/ncua-financials";
import type { RegistryDb } from "@/lib/agents/magellan/registry/partitions";
import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import { readFilingAmendments } from "@/lib/data-store/filing-versions";
import { filingVersionsReady, resetFilingVersionsReady } from "./filing-versions";

// #2613: an amended filing quarter keeps the values it replaces, in the same statement as the upsert.
const url = process.env.E2E_DATABASE_URL;
describe.skipIf(!url)("registry filing versions", () => {
  let db: postgres.Sql<{ json: unknown }>;
  const schema = `filing_versions_${randomBytes(6).toString("hex")}`;
  const versions = () => db<{ table_name: string; institution_id: string; item_key: string | null; changed: Record<string, [unknown, unknown]>; prior_agent_run_id: string | null; superseded_by_run_id: string | null }[]>`
    SELECT table_name, institution_id, item_key, changed, prior_agent_run_id, superseded_by_run_id FROM registry_filing_versions ORDER BY id`;
  const migration = (file: string) => readFileSync(`supabase/migrations/${file}`, "utf8")
    .replaceAll("public.", `${schema}.`).replaceAll("search_path=pg_catalog,public", `search_path=pg_catalog,${schema}`);

  beforeAll(async () => {
    if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Loopback PostgreSQL only");
    db = postgres(url, { max: 1, onnotice: () => {}, connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    await db.unsafe(`DO $roles$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $roles$`);
    await db.unsafe(`CREATE SCHEMA ${schema}`);
    await db.unsafe(`
      CREATE TABLE ${schema}.institution_sources (id bigint PRIMARY KEY, source text, rssd_id text, cert_number text, ncua_charter_id text);
      INSERT INTO ${schema}.institution_sources VALUES (1, 'fdic', '101', '11', NULL), (2, 'ncua', NULL, '202', '202');
      CREATE TABLE ${schema}.institution_financial_records (LIKE public.institution_financial_records INCLUDING ALL);
      CREATE TABLE ${schema}.institution_call_report_items (
        id bigserial PRIMARY KEY, institution_id bigint NOT NULL, source text NOT NULL, report_date date NOT NULL,
        item_code text NOT NULL, item_key text NOT NULL, item_description text, schedule text, value numeric NOT NULL,
        unit text NOT NULL, period_basis text NOT NULL, source_url text, agent_run_id bigint,
        fetched_at timestamptz NOT NULL DEFAULT now(), UNIQUE (institution_id, source, report_date, item_key));
      CREATE TABLE ${schema}.public_data_cold_files (
        id bigserial PRIMARY KEY, table_name text, source text, period text, bucket text, object_key text, format text,
        columns text[], row_count bigint, byte_size bigint, sha256 text, hot_bytes_estimate bigint, agent_run_id bigint,
        written_at timestamptz DEFAULT now(), verified_at timestamptz, pruned_at timestamptz, UNIQUE (table_name, source, period));
      CREATE TABLE ${schema}.hmda_lender_loan_costs (id bigserial PRIMARY KEY, activity_year int, cost_detail jsonb);
      CREATE TABLE ${schema}.agent_run_steps (id bigint, step_key text);
      CREATE TABLE ${schema}.agent_run_events (id bigint, step_id bigint, event_type text, status text, detail jsonb);`);
    await db.begin((tx) => tx.unsafe(migration("20270110000079_public_data_storage_compaction.sql")));
  });
  afterAll(async () => {
    if (db) {
      await db.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await db.end();
    }
  });
  beforeEach(async () => {
    await db.unsafe(`TRUNCATE ${schema}.institution_financial_records, ${schema}.institution_call_report_items RESTART IDENTITY`);
    if (await db`SELECT to_regclass('registry_filing_versions') IS NOT NULL AS ok`.then((r) => r[0].ok)) {
      await db.unsafe(`TRUNCATE ${schema}.registry_filing_versions RESTART IDENTITY`);
    }
  });

  type FdicChunk = Parameters<typeof upsertFdicFinancialChunk>[1][number];
  type NcuaChunk = Parameters<typeof upsertNcuaFinancialChunk>[1][number];
  // Columns left out read as null in the loader's recordset, as a blank field from the publisher does.
  const fdic = (runId: number, values: Record<string, unknown>) => ({
    institution_id: 1, attached_via: null, remove_stale_for: null, cert: "11", report_date: "2026-06-30",
    total_assets: 1000, total_deposits: 800, service_charge_income: 12, roa: 0.0105,
    raw_json: { ASSET: 1000 }, source_url: "https://banks.data.fdic.gov/x", agent_run_id: runId, ...values,
  }) as unknown as FdicChunk;
  const ncua = (runId: number, values: Record<string, unknown>) => ({
    cert: "202", report_date: "2026-06-30", total_assets: 500, net_income: 7, service_charge_income: 3,
    raw_json: { ACCT_010: 500 }, source_url: "https://ncua.gov/x", agent_run_id: runId, ...values,
  }) as unknown as NcuaChunk;
  const items = (runId: number, rows: Array<Record<string, unknown>>) =>
    db`SELECT upsert_call_report_item_batch('ffiec', '2026-06-30'::date, 'https://cdr.ffiec.gov/x', ${runId}, ${JSON.stringify(rows)}::jsonb) AS written`;
  const item = (value: number, extra: Record<string, unknown> = {}) => ({
    rssd: "101", item_key: "service_charges", item_code: "RIAD4080", item_description: "Service charges", schedule: "RI",
    value, unit: "usd", period_basis: "ytd", ...extra,
  });
  const scope = () => db as unknown as RegistryDb;

  it("writes as before, without versions, until the migration has run", async () => {
    resetFilingVersionsReady(scope());
    expect(await filingVersionsReady(scope())).toBe(false);
    await upsertFdicFinancialChunk(scope(), [fdic(1, {})], false);
    const second = await upsertFdicFinancialChunk(scope(), [fdic(2, { total_assets: 1100 })], false);
    expect(second).toEqual({ written: 1, versioned: 0 });
    const [row] = await db`SELECT total_assets FROM institution_financial_records`;
    expect(Number(row.total_assets)).toBe(1100);
    const none = await readFilingAmendments(db as never, { institutionId: 1, reportDates: ["2026-06-30"], since: "2020-01-01" });
    expect(none).toEqual({ available: false, amendments: [] });
  });

  describe("after the migration", () => {
    beforeAll(async () => {
      await db.begin((tx) => tx.unsafe(migration("20270110000083_registry_filing_versions.sql")));
      resetFilingVersionsReady(scope());
    });

    it("keeps an FDIC quarter's replaced values, and nothing for an unchanged refetch or a provenance-only change", async () => {
      expect(await filingVersionsReady(scope())).toBe(true);
      expect(await upsertFdicFinancialChunk(scope(), [fdic(1, {})], true)).toEqual({ written: 1, versioned: 0 });
      expect(await upsertFdicFinancialChunk(scope(), [fdic(2, {})], true)).toEqual({ written: 0, versioned: 0 });
      // raw_json and the URL changed but no reported value: the row updates, no amendment is recorded.
      expect(await upsertFdicFinancialChunk(scope(), [fdic(3, { raw_json: { ASSET: 1000, NEW: 1 }, source_url: "https://banks.data.fdic.gov/y" })], true))
        .toEqual({ written: 1, versioned: 0 });
      expect(await upsertFdicFinancialChunk(scope(), [fdic(4, { total_assets: 1100, roa: 0.011 })], true)).toEqual({ written: 1, versioned: 1 });
      expect(await versions()).toEqual([
        expect.objectContaining({
          table_name: "institution_financial_records", institution_id: "1", item_key: null,
          changed: { total_assets: [1000, 1100], roa: [0.0105, 0.011] }, prior_agent_run_id: "3", superseded_by_run_id: "4",
        }),
      ]);
      const [row] = await db`SELECT total_assets FROM institution_financial_records`;
      expect(Number(row.total_assets)).toBe(1100);
      // A claim read before the amendment sees it; one read after does not.
      const before = await readFilingAmendments(db as never, { institutionId: 1, reportDates: ["2026-06-30"], since: "2020-01-01" });
      expect(before).toEqual({ available: true, amendments: [expect.objectContaining({ table: "institution_financial_records", reportDate: "2026-06-30", changed: { total_assets: [1000, 1100], roa: [0.0105, 0.011] } })] });
      const after = await readFilingAmendments(db as never, { institutionId: 1, reportDates: ["2026-06-30"], since: "2999-01-01" });
      expect(after.amendments).toEqual([]);
    });

    it("keeps an NCUA quarter's replaced values, including a value that became blank", async () => {
      await upsertNcuaFinancialChunk(scope(), [ncua(1, {})], true);
      const amended = await upsertNcuaFinancialChunk(scope(), [ncua(2, { net_income: null })], true);
      expect(amended).toMatchObject({ matched: 1, written: 1, versioned: 1 });
      expect(await versions()).toEqual([
        expect.objectContaining({ institution_id: "2", changed: { net_income: [7, null] }, prior_agent_run_id: "1", superseded_by_run_id: "2" }),
      ]);
    });

    it("keeps a call-report line's replaced value through the compact writer, not a relabel or an equal number", async () => {
      expect((await items(1, [item(100)]))[0].written).toBe("1");
      // A relabel moves the line to a new metadata definition (one write) but is not an amendment.
      expect((await items(2, [item(100.0, { item_description: "Service charges on deposit accounts" })]))[0].written).toBe("1");
      expect((await items(2, [item(100.0, { item_description: "Service charges on deposit accounts" })]))[0].written).toBe("0");
      expect(await versions()).toEqual([]);
      expect((await items(3, [item(120)]))[0].written).toBe("1");
      expect(await versions()).toEqual([
        expect.objectContaining({
          table_name: "institution_call_report_items", institution_id: "1", item_key: "service_charges",
          // Run 2 last wrote the line (its relabel), so it is the prior run.
          changed: { value: [100, 120] }, prior_agent_run_id: "2", superseded_by_run_id: "3",
        }),
      ]);
    });
  });
});
