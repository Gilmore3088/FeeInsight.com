/** Real PostgreSQL checks of the roll-up SQL, in a loopback-only connection with temporary tables. */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { areaRowServedSql } from "@/lib/data-store/struck-sources";
import { areaPeerRollup, callInstitutionSeries, callPeerRollup } from "./roll-ups";

const connection = process.env.E2E_DATABASE_URL;
describe.skipIf(!connection)("roll-up SQL in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  const tx = () => db as unknown as Parameters<typeof areaPeerRollup>[0];

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Roll-up SQL tests require a loopback E2E database; production connections are forbidden");
    db = postgres(connection, { max: 1, ssl: "require" });
    // Temporary tables shadow any real ones for this connection only.
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, state_code text, cbsa_code text)`;
    await db`CREATE TEMP TABLE institution_hq_counties (institution_id bigint, county_fips text, basis text)`;
    await db`CREATE TEMP TABLE area_statistics (source text, geo_type text, geo_code text, geo_name text, period text, series_key text, value double precision, unit text, note text, source_url text, fetched_at timestamptz)`;
    await db`CREATE TEMP TABLE institution_call_report_items (institution_id bigint, source text, report_date date, item_code text, item_key text, item_description text, schedule text, value numeric, unit text, period_basis text, source_url text, fetched_at timestamptz)`;
    await db`INSERT INTO institution_sources VALUES (1, 'TX', '26420'), (2, 'TX', '26420'), (3, 'TX', '19100'), (4, 'OK', NULL), (5, 'OK', NULL), (6, 'TX', NULL)`;
    await db`INSERT INTO institution_hq_counties VALUES (1, '48201', 'sod_main_office'), (2, '48201', 'sod_main_office'), (3, '48113', 'sod_main_office'), (4, '40109', 'sod_main_office'), (5, '40143', 'sod_main_office')`;
    await db`INSERT INTO area_statistics VALUES
      ('bls-laus', 'county', '48201', 'Harris', '2026-09', 'rate', 4.0, 'percent', NULL, 'https://www.bls.gov/a', '2026-10-01'),
      ('bls-laus', 'county', '48113', 'Dallas', '2026-09', 'rate', 3.0, 'percent', NULL, 'https://www.bls.gov/a', '2026-10-02'),
      ('bls-laus', 'county', '40109', 'Oklahoma', '2026-09', 'rate', 5.0, 'percent', NULL, 'https://www.bls.gov/a', '2026-10-01'),
      ('bls-laus', 'county', '40143', 'Tulsa', '2026-09', 'rate', 6.0, 'percent', NULL, 'https://www.bls.gov/a', '2026-10-01'),
      ('bls-laus', 'county', '48201', 'Harris', '2025-09', 'rate', 4.4, 'percent', NULL, 'https://www.bls.gov/a', '2026-10-01'),
      ('bls-laus', 'state', 'TX', 'Texas', '2026-09', 'rate', 4.1, 'percent', NULL, 'https://www.bls.gov/a', '2026-10-01'),
      ('bls-laus', 'state', 'OK', 'Oklahoma', '2026-09', 'rate', 3.3, 'percent', NULL, 'https://www.bls.gov/a', '2026-10-01')`;
    await db`INSERT INTO institution_call_report_items VALUES
      (1, 'ffiec', '2026-06-30', 'RIAD4080', 'svc', 'SERVICE CHARGES', 'RI', 100, 'thousands', 'ytd', 'https://cdr.ffiec.gov/a', '2026-08-01'),
      (2, 'ffiec', '2026-06-30', 'RIAD4080', 'svc', 'SERVICE CHARGES', 'RI', 300, 'thousands', 'ytd', 'https://cdr.ffiec.gov/a', '2026-08-01'),
      (4, 'ncua', '2026-06-30', 'ACCT_131', 'svc', 'FEE INCOME', 'IS', 200000, 'dollars', 'ytd', 'https://ncua.gov/a', '2026-08-02'),
      (1, 'ffiec', '2026-03-31', 'RIAD4080', 'svc', 'SERVICE CHARGES', 'RI', 50, 'thousands', 'ytd', 'https://cdr.ffiec.gov/a', '2026-05-01'),
      (5, 'held', '2026-06-30', 'X', 'svc', 'X', 'X', 999999999, 'dollars', 'ytd', NULL, '2026-08-01')`;
  });
  afterAll(async () => {
    if (db) await db.end();
  });

  it("takes each member's headquarters county once and the median over members", async () => {
    const rows = await areaPeerRollup(tx(), { source: "bls-laus", seriesKey: "rate", geoType: "county", memberIds: [1, 2, 3, 4, 6], from: null, to: null, limit: 10, servedSql: areaRowServedSql("a") });
    expect(rows.map((r) => r.period)).toEqual(["2026-09", "2025-09"]);
    // Members 1 and 2 share Harris (4.0), 3 is Dallas (3.0), 4 Oklahoma County (5.0); 6 has no HQ county.
    expect(rows[0]).toMatchObject({ unit: "percent", institution_count: 4, area_count: 3, median: 4, source_url: "https://www.bls.gov/a" });
    expect(rows[0].p25).toBeCloseTo(3.75);
    expect(rows[1]).toMatchObject({ institution_count: 2, median: 4.4 });
  });

  it("reads state codes for a state-level series and honours the period bounds", async () => {
    const rows = await areaPeerRollup(tx(), { source: "bls-laus", seriesKey: "rate", geoType: "state", memberIds: [1, 4, 5, 6], from: "2026-01", to: "2026-12", limit: 10, servedSql: areaRowServedSql("a") });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: "2026-09", institution_count: 4, area_count: 2 });
    expect(rows[0].median).toBeCloseTo(3.7);
    const metro = await areaPeerRollup(tx(), { source: "bls-laus", seriesKey: "rate", geoType: "metro", memberIds: [1, 2], from: null, to: null, limit: 10, servedSql: areaRowServedSql("a") });
    expect(metro).toEqual([]);
  });

  it("rolls a call-report line up in dollars across regulators, only for the allowed row sources", async () => {
    const rows = await callPeerRollup(tx(), { itemKey: "svc", rowSources: ["ffiec", "ncua"], memberIds: [1, 2, 4, 5], from: null, to: null, limit: 10 });
    expect(rows.map((r) => r.period)).toEqual(["2026-06-30", "2026-03-31"]);
    // 100k and 300k (thousands) and 200,000 dollars: median 200,000; the 'held' row is left out.
    expect(rows[0]).toMatchObject({ unit: "USD", median: 200_000, institution_count: 3, period_basis: "ytd" });
    expect([...(rows[0].sources ?? [])].sort()).toEqual(["ffiec", "ncua"]);
    const all = await callPeerRollup(tx(), { itemKey: "svc", rowSources: ["ffiec"], memberIds: null, from: "2026-04", to: "2026-06", limit: 10 });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ median: 200_000, institution_count: 2 });
  });

  it("reads one institution's own values, newest first", async () => {
    const rows = await callInstitutionSeries(tx(), { itemKey: "svc", rowSources: ["ffiec", "ncua"], institutionId: 1, from: null, to: null, limit: 10 });
    expect(rows.map((r) => [r.period, r.value, r.unit])).toEqual([["2026-06-30", 100_000, "USD"], ["2026-03-31", 50_000, "USD"]]);
  });
});
