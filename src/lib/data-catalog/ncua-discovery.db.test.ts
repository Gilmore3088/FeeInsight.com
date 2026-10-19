// @vitest-environment node
/** Discover -> query through Hamilton's shared tool, against loopback-only temporary tables. */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/data-store/connection", async (original) => ({
  ...(await original<typeof import("@/lib/data-store/connection")>()),
  withTransaction: (cb: (tx: unknown) => Promise<unknown>) =>
    (context.db as { begin: (fn: (tx: unknown) => Promise<unknown>) => unknown }).begin(cb),
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("./series", () => ({ getAreaSeries: vi.fn(async () => []) }));
vi.mock("./cold-reads", async (original) => ({
  ...(await original<typeof import("./cold-reads")>()), prunedCallFiles: vi.fn(async () => []),
}));

import { listDataCatalog } from "@/lib/research/tool-query-data";
import { NCUA_CALL_MEASURES } from "./ncua-call-measures";
import { readNcuaCallSeries, resetNcuaCallSeriesRetry } from "./ncua-call-series";
import { queryData } from "./query-data";

const connection = process.env.E2E_DATABASE_URL;
const url = "https://ncua.gov/files/publications/analysis/call-report-data-2026-06.zip";

describe.skipIf(!connection)("NCUA discovery and Hamilton query in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("NCUA discovery tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, onnotice: () => {} });
    context.db = db;
    resetNcuaCallSeriesRetry();
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, charter_type text)`;
    await db`INSERT INTO institution_sources VALUES
      (1, 'credit_union'), (2, 'credit_union'), (3, 'credit_union'), (4, 'credit_union'), (5, 'credit_union'),
      (100, 'bank'), (101, 'credit_union'), (102, 'credit_union'), (103, 'credit_union'), (104, 'credit_union')`;
    await db`CREATE TEMP TABLE institution_call_report_items (
      institution_id bigint, source text, report_date date, item_code text, item_key text,
      item_description text, schedule text, value numeric, unit text, period_basis text,
      source_url text, fetched_at timestamptz)`;
    await db`CREATE INDEX ON institution_call_report_items (item_key, report_date)`;
    for (const m of NCUA_CALL_MEASURES) {
      for (const period of ["2024-03-31", "2026-06-30"]) {
        for (let id = 1; id <= 5; id++) {
          await db`INSERT INTO institution_call_report_items VALUES
            (${id}, 'ncua', ${period}, ${m.code}, ${m.key}, ${m.description}, 'FS220', ${(id - 1) * 10},
             ${m.storedUnit}, ${m.periodBasis}, ${url}, '2026-10-19')`;
        }
      }
    }
    // Neither discovery nor query may use a bank row, wrong code, unit or period basis.
    await db`INSERT INTO institution_call_report_items VALUES
      (100, 'ffiec', '2030-06-30', 'ACCT_452', 'acct_452', 'wrong publisher', 'X', 999999, 'count', 'point_in_time', 'https://example.org/bank', '2030-07-01'),
      (101, 'ncua', '2030-06-30', 'ACCT_452', 'acct_452', 'wrong basis', 'X', 999999, 'count', 'ytd', ${url}, '2030-07-01'),
      (102, 'ncua', '2030-06-30', 'ACCT_452', 'acct_452', 'wrong unit', 'X', 999999, 'dollars', 'point_in_time', ${url}, '2030-07-01'),
      (103, 'ncua', '2030-06-30', 'ACCT_999', 'acct_452', 'wrong code', 'X', 999999, 'count', 'point_in_time', ${url}, '2030-07-01'),
      (104, 'ncua', '2020-06-30', 'ACCT_452', 'acct_452', 'wrong earliest basis', 'X', 999999, 'count', 'ytd', ${url}, '2020-07-01')`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("discovers exactly the six comparable resident lines with correct bounds", async () => {
    const result = await readNcuaCallSeries(db as unknown as Parameters<typeof readNcuaCallSeries>[0]);
    expect(result).toHaveLength(6);
    expect(result.map((r) => r.key).sort()).toEqual(NCUA_CALL_MEASURES.map((m) => m.key).sort());
    for (const row of result) expect(row).toMatchObject({ periodMin: "2024-03-31", periodMax: "2026-06-30", sourceUrl: url });
  });

  it("answers a CU fee-income question using a discovered key, preserving YTD and a reported zero", async () => {
    const catalog = await listDataCatalog({ query: "NCUA fee income", scope: "institution" });
    const discovered = catalog.call_measures?.find((m) => m.measure === "call:acct_131");
    expect(discovered).toMatchObject({ unit: "USD", period_basis: "ytd", publisher: expect.stringContaining("NCUA") });
    const answer = await queryData({ measure: discovered!.measure, scope: { kind: "institution", id: "1" }, period: { from: "2026Q2", to: "2026Q2" } });
    expect(answer).toMatchObject({ ok: true, unit: "USD", rows: [{ period: "2026-06-30", value: 0, period_basis: "ytd", source: "ncua" }],
      measure_metadata: { item_code: "ACCT_131", caveat: expect.stringContaining("not a consumer fee price") },
      citation: { publisher: expect.stringContaining("NCUA"), source_url: url, as_of: "2026-06-30" } });
  });

  it("keeps a count rollup NCUA-only and excludes contradictory filings", async () => {
    const catalog = await listDataCatalog({ query: "share draft account count", scope: "national" });
    const discovered = catalog.call_measures!.find((m) => m.measure === "call:acct_452")!;
    const answer = await queryData({ measure: discovered.measure, scope: { kind: "national" } });
    expect(answer).toMatchObject({ ok: true, unit: "count", rows: [
      { period: "2026-06-30", median: 20, institution_count: 5, period_basis: "point_in_time", sources: "ncua", scope_label: "NCUA credit union filers — NCUA filers only" },
      { period: "2024-03-31", median: 20, institution_count: 5 },
    ], citation: { publisher: expect.stringContaining("NCUA"), source_url: url },
      measure_metadata: { item_code: "ACCT_452", caveat: expect.stringContaining("not members") } });
  });

  it("keeps a missing institution distinct from a reported zero and suppresses thin groups", async () => {
    const missing = await queryData({ measure: "call:acct_131", scope: { kind: "institution", id: "999" } });
    expect(missing).toMatchObject({ ok: true, rows: [], unit: null, note: expect.stringContaining("no comparable loaded figures") });
    await db`DELETE FROM institution_call_report_items WHERE item_key='acct_564a' AND institution_id > 2`;
    const thin = await queryData({ measure: "call:acct_564a", scope: { kind: "national" } });
    expect(thin).toMatchObject({ ok: true, rows: [
      { median: null, p25: null, p75: null, institution_count: 2 },
      { median: null, p25: null, p75: null, institution_count: 2 },
    ] });
  });
});
