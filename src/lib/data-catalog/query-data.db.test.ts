// @vitest-environment node
/**
 * queryData's period filter on a real PostgreSQL (#1873). The SQL CASE expressions that turn a stored
 * period into its first and last month run here exactly as queryArea writes them; the unit tests in
 * query-data.test.ts only see the SQL text. Loopback-only, temporary tables: nothing outside this
 * connection is read or written.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/data-store/connection", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data-store/connection")>();
  return {
    ...original,
    withTransaction: (callback: (tx: unknown) => Promise<unknown>) =>
      (context.db as { begin: (fn: (tx: unknown) => Promise<unknown>) => unknown }).begin(callback),
  };
});

import { periodMonths, queryData } from "./query-data";

const connection = process.env.E2E_DATABASE_URL;
const MEASURE = "area:bls-laus:laus_unemployment_rate";

/** Year, quarter, month and weekly (a dated month) shapes, plus shapes the filter does not know. */
const WELL_SHAPED = ["2025", "2026", "2026Q2", "2026Q3", "2026Q4", "2026-08", "2026-09", "2026-10", "2026-09-30"];
const ODD = ["2026H1", "FY2026", "2026Q5", "2026-9", "26-09"];

describe.skipIf(!connection)("queryData period filter in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("queryData SQL tests require a loopback E2E database; production connections are forbidden");
    }
    // One connection, so the temporary table is the one queryArea's transaction reads.
    db = postgres(connection, { max: 1, ssl: "prefer", onnotice: () => {} });
    context.db = db;
    await db`CREATE TEMP TABLE area_statistics (
      source text NOT NULL, series_key text NOT NULL, series_id text, geo_type text NOT NULL, geo_code text NOT NULL,
      geo_name text, period text NOT NULL, value numeric, unit text, note text, source_url text, fetched_at timestamptz)`;
    for (const period of [...WELL_SHAPED, ...ODD]) {
      await db`INSERT INTO area_statistics (source, series_key, geo_type, geo_code, geo_name, period, value, unit, source_url, fetched_at)
        VALUES ('bls-laus', 'laus_unemployment_rate', 'nation', 'US', 'United States', ${period}, 4.1, 'percent', 'https://www.bls.gov/lau/', '2026-10-10')`;
    }
    // Another series in the same months, which no query below may return.
    await db`INSERT INTO area_statistics (source, series_key, geo_type, geo_code, period, value, unit, source_url)
      VALUES ('bls-laus', 'laus_labor_force', 'nation', 'US', '2026-09', 1, 'count', 'https://www.bls.gov/lau/')`;
  });
  afterAll(async () => { if (db) await db.end(); });

  async function periods(period?: { from?: string; to?: string }): Promise<string[]> {
    const result = await queryData({ measure: MEASURE, scope: { kind: "national" }, limit: 200, ...(period ? { period } : {}) });
    if (!result.ok) throw new Error(result.reason);
    return result.rows.map((r) => String(r.period)).sort();
  }
  const sorted = (list: string[]) => [...list].sort();

  it("returns every row, odd shapes included, when no bound is given", async () => {
    expect(await periods()).toEqual(sorted([...WELL_SHAPED, ...ODD]));
  });

  it("keeps a row whose span ends on or after `from` (2026Q3 starts 2026-07)", async () => {
    expect(await periods({ from: "2026Q3" })).toEqual(sorted(["2026", "2026Q3", "2026Q4", "2026-08", "2026-09", "2026-10", "2026-09-30"]));
  });

  it("keeps a row whose span starts on or before `to` (2026Q3 ends 2026-09)", async () => {
    expect(await periods({ to: "2026Q3" })).toEqual(sorted(["2025", "2026", "2026Q2", "2026Q3", "2026-08", "2026-09", "2026-09-30"]));
  });

  it("a one-month window keeps the year, quarter, month and week that overlap it", async () => {
    expect(await periods({ from: "2026-09", to: "2026-09" })).toEqual(sorted(["2026", "2026Q3", "2026-09", "2026-09-30"]));
  });

  it("a year window keeps every 2026 shape and nothing from 2025", async () => {
    expect(await periods({ from: "2026", to: "2026" })).toEqual(sorted(["2026", "2026Q2", "2026Q3", "2026Q4", "2026-08", "2026-09", "2026-10", "2026-09-30"]));
  });

  it("counts a bound that touches a span's first or last month as overlap", async () => {
    // 2025 ends 2025-12 and 2026 starts 2026-01; 2026Q2 starts 2026-04, after the window.
    expect(await periods({ from: "2025-12", to: "2026-01" })).toEqual(["2025", "2026"]);
    // 2026Q2 ends 2026-06; 2026Q3 starts 2026-07.
    expect(await periods({ from: "2026Q2", to: "2026-06" })).toEqual(sorted(["2026", "2026Q2"]));
    expect(await periods({ from: "2026-07", to: "2026-07" })).toEqual(sorted(["2026", "2026Q3"]));
  });

  it("leaves out periods of unknown shape once any bound is given", async () => {
    for (const period of [{ from: "2000" }, { to: "2099" }, { from: "2000", to: "2099" }]) {
      const found = await periods(period);
      expect(found).toEqual(sorted(WELL_SHAPED));
      for (const odd of ODD) expect(found).not.toContain(odd);
    }
  });

  it("maps each stored shape to the same months as periodMonths()", async () => {
    // Sliding a one-month window across 2025-2026 recovers each row's span from the SQL alone.
    const spans = new Map<string, string[]>();
    for (let year = 2025; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) {
        const ym = `${year}-${String(month).padStart(2, "0")}`;
        for (const period of await periods({ from: ym, to: ym })) spans.set(period, [...(spans.get(period) ?? []), ym]);
      }
    }
    for (const period of WELL_SHAPED) {
      const months = spans.get(period) ?? [];
      expect({ period, start: months[0], end: months.at(-1) }).toEqual({ period, ...periodMonths(period) });
    }
  });
});
