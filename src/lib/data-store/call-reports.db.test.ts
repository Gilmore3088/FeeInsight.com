// @vitest-environment node
/** Actual reader SQL against connection-owned fixtures; loopback databases only. */
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
  getRevenueTrend, getServiceChargeIntensityTrend, getTopRevenueInstitutions,
} from "./call-reports";

import { getCharterFeeRevenueSummary, getFeeRevenueData, getTierFeeRevenueSummary } from "./fee-revenue";
import { getFeeDependencyTrend, getRevenuePerInstitutionTrend } from "./derived-analytics";
import { getHealthMetricsByCharter, getIndustryHealthMetrics } from "./health";

const connection = process.env.E2E_DATABASE_URL;
describe.skipIf(!connection)("comparable financial readers in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Financial peer SQL tests require a loopback database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, onnotice: () => {} });
    context.db = db;
    await db`CREATE TEMP TABLE institution_sources (
      id bigint PRIMARY KEY, institution_name text, cert_number text,
      charter_type text, asset_size_tier text, fed_district integer, state_code text DEFAULT 'VA')`;
    await db`CREATE TEMP TABLE institution_financial_records (
      id bigint GENERATED ALWAYS AS IDENTITY, institution_id bigint, source text, report_date text,
      service_charge_income numeric, total_assets numeric, fee_income_ratio numeric,
      total_deposits numeric, other_noninterest_income numeric, total_revenue numeric DEFAULT 10000,
      roa numeric, roe numeric, efficiency_ratio numeric,
      UNIQUE (institution_id, source, report_date))`;
    await db`CREATE TEMP TABLE published_fee_catalog (
      institution_id bigint, canonical_fee_key text, fee_category text, fee_name text,
      amount numeric, review_status text, source_document_id bigint, fee_audience text,
      source_url text, frequency text)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE pg_temp.institution_financial_records, pg_temp.institution_sources, pg_temp.published_fee_catalog`;
    for (let id = 1; id <= 10; id++) {
      await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier, fed_district) VALUES (${id}, ${`Credit Union ${id}`}, ${String(id)}, ${id === 10 ? "unknown" : "credit_union"}, 'regional', 1)`;
    }
    // Five positive quarter reporters; two more same-date eligible filings lack a
    // computable positive quarter. Only three of the five report the ratio.
    for (let id = 1; id <= 7; id++) {
      if (id !== 6) await db`INSERT INTO institution_financial_records
        (institution_id, source, report_date, service_charge_income, total_assets, total_deposits)
        VALUES (${id}, 'ncua', '2026-03-31', 100, 190000000, 100000)`;
      await db`INSERT INTO institution_financial_records
        (institution_id, source, report_date, service_charge_income, total_assets, fee_income_ratio, total_deposits, other_noninterest_income)
        VALUES (${id}, 'ncua', '2026-06-30', ${id <= 5 ? 210 - id * 10 : id === 6 ? 99999 : 100}, 190000000,
          ${id <= 3 ? id / 100 : null}, 100000, 100)`;
    }
    await db`INSERT INTO institution_financial_records
      (institution_id, source, report_date, service_charge_income, total_assets, fee_income_ratio, total_deposits)
      VALUES (8, 'ncua', '2026-03-31', 100, 9000000, 0.4, 100000),
             (8, 'ncua', '2026-06-30', 1000000, 9000000, 0.4, 100000),
             (9, 'fdic', '2026-06-30', 1000000, 190000000, 0.4, 100000),
             (10, 'ncua', '2026-06-30', 1000000, 190000000, 0.4, 100000),
             (1, 'fdic', '2026-09-30', 1000000, 190000000, 0.4, 100000),
             (1, 'ffiec', '2026-06-30', 9999999999, 190000000000, 40, 100000)`;
    for (let id = 101; id <= 105; id++) {
      await db`INSERT INTO institution_sources (id, institution_name, cert_number, charter_type, asset_size_tier, fed_district) VALUES (${id}, ${`Bank ${id}`}, ${String(id)}, 'bank', 'regional', 1)`;
      await db`INSERT INTO institution_financial_records
        (institution_id, source, report_date, service_charge_income, total_assets, fee_income_ratio, total_deposits, other_noninterest_income)
        VALUES (${id}, 'fdic', '2026-06-30', 1000000, 190000000, 0.9, 100000, 100),
               (${id}, 'fdic', '2026-09-30', 2000000, 190000000, 0.9, 100000, 100)`;
    }
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 101, 102, 103, 104, 105]) {
      for (const category of ["overdraft", "nsf", "wire_domestic_outgoing"]) {
        await db`INSERT INTO published_fee_catalog VALUES (${id}, ${category}, ${category}, 'Fee', 25, 'approved', 1, 'consumer', 'https://bank.test/consumer/fees', 'per_item')`;
      }
    }

  });

  it("ranks a CU only against the same source, charter, date and numeric assets", async () => {
    const ranking = await getInstitutionPeerRanking(1);
    expect(ranking).toMatchObject({ sc_income: 100, sc_rank: 1, peer_count: 5, peer_median_sc: 80, peer_median_fee_ratio: null,
      comparison: { source: "ncua", charter_type: "credit_union", report_date: "2026-06-30", subject_included: true,
        eligible_count: 7, reported_count: 5, ratio_reported_count: 3, ratio_period_basis: "year_to_date",
        size_criterion: { minimum_usd_inclusive: 10000000000, maximum_usd_exclusive: 250000000000 } } });
    const bank = await getInstitutionPeerRanking(101);
    expect(bank).toMatchObject({ sc_income: 2000000, peer_count: 5, peer_median_sc: 2000000, peer_median_fee_ratio: 0.9,
      comparison: { source: "fdic", charter_type: "bank", report_date: "2026-09-30" } });
    expect(await getInstitutionPeerRanking(6)).toBeNull(); // Missing prior quarter.
    expect(await getInstitutionPeerRanking(7)).toBeNull(); // Latest quarter is zero: no fallback to a stale Q1 rank.
    expect(await getInstitutionPeerRanking(9)).toBeNull();
    expect(await getInstitutionPeerRanking(10)).toBeNull();
  });

  it("keeps every aggregate read and its latest filing date in one family", async () => {
    const cuTop = await getTopRevenueInstitutions(20, "ncua");
    expect(cuTop.length).toBe(6); // Five in-range reporters and the smaller CU 8.
    expect(cuTop.every((r) => r.charter_type === "credit_union" && r.report_date === "2026-06-30")).toBe(true);
    expect((await getTopRevenueInstitutions(20, "fdic")).every((r) => r.charter_type === "bank" && r.report_date === "2026-09-30")).toBe(true);
    const tiers = await getRevenueByTier(undefined, "ncua");
    expect(tiers.find((r) => r.tier === "regional")).toMatchObject({ institution_count: 5, total_sc_income: 400, avg_sc_income: 80 });
    const district = await getDistrictFeeRevenue(1, undefined, "ncua");
    expect(district).toMatchObject({ institution_count: 6, total_sc_income: 1000300 });
    const trend = await getRevenueTrend(8, "ncua");
    expect(trend.latest).toMatchObject({ quarter: "2026-Q2", total_institutions: 6, bank_service_charges: 0, total_service_charges: 1000300 });
    const districtTrend = await getDistrictIncomeTrend(8, "ncua");
    expect(districtTrend[0]).toMatchObject({ quarter: "2026-Q2", institutions: 6, total_service_charges: 1000300 });
  });

  it("ignores a CU's bank-source duplicate and reports only its NCUA quarter series", async () => {
    const trend = await getInstitutionRevenueTrend(1);
    expect(trend.map((r) => [r.quarter, r.service_charge_income])).toEqual([["2026-Q2", 100], ["2026-Q1", 100]]);
    expect(await getInstitutionRevenueTrend(1, 8, "fdic")).toEqual([]);
  });

  it("partitions size-tier medians and suppresses thin intensity peers", async () => {
    const medians = await getPeerServiceChargeMedians("credit_union", "regional");
    expect(medians[0]).toMatchObject({ quarter_end: "2026-06-30", median_thousands: 85, institutions: 6 });
    // Five eligible positive CU peers excluding the subject initially include small CU 8.
    // After deleting its rows, only four remain; neither banks nor malformed-source CUs fill the gap.
    await db`DELETE FROM pg_temp.institution_financial_records WHERE institution_id = 8`;
    const intensity = await getServiceChargeIntensityTrend(1);
    expect(intensity.find((r) => r.quarterEnd === "2026-06-30")).toMatchObject({ own: 4, peerMedian: null, peers: 4 });
  });

  it("keeps the fee-price correlation's income and summaries source/date-specific", async () => {
    const cuRows = await getFeeRevenueData("ncua");
    expect(cuRows.map((r) => Number(r.institution_id)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 7, 8]);
    expect(cuRows.find((r) => Number(r.institution_id) === 1)).toMatchObject({ financial_source: "ncua", report_date: "2026-06-30" });
    expect(Number(cuRows.find((r) => Number(r.institution_id) === 1)?.service_charge_income)).toBe(100);
    const bankRows = await getFeeRevenueData("fdic");
    expect(bankRows.length).toBe(5);
    expect(bankRows.every((r) => r.charter_type === "bank" && r.financial_source === "fdic" && r.report_date === "2026-09-30")).toBe(true);
    const tiers = await getTierFeeRevenueSummary();
    expect(tiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ financial_source: "ncua", report_date: "2026-06-30", institution_count: 7, avg_service_charge_income: 142900 }),
      expect.objectContaining({ financial_source: "fdic", report_date: "2026-09-30", institution_count: 5, avg_service_charge_income: 2000000 }),
    ]));
    expect(tiers).toHaveLength(2);
    const charters = await getCharterFeeRevenueSummary();
    expect(charters).toHaveLength(2);
    expect(charters).toEqual(expect.arrayContaining([
      expect.objectContaining({ charter_type: "credit_union", financial_source: "ncua", report_date: "2026-06-30", institution_count: 7 }),
      expect.objectContaining({ charter_type: "bank", financial_source: "fdic", report_date: "2026-09-30", institution_count: 5 }),
    ]));
  });

  it("derives CU revenue-per-institution from Q2 differences and excludes missing priors", async () => {
    const cu = await getRevenuePerInstitutionTrend(8, "ncua");
    // June total is 1,000,300 thousand among 7 computable filers, including a real zero.
    // CU 6's 99,999 YTD has no March filing and is never guessed as quarterly income.
    expect(cu.trend[0]).toMatchObject({ report_date: "2026-06-30", source: "ncua", avg_sc_income: 142900000, institution_count: 7 });
    expect(cu.current.by_charter).toEqual([expect.objectContaining({ charter: "credit_union", source: "ncua", report_date: "2026-06-30", avg_sc_income: 142900000, institution_count: 7 })]);
    const banks = await getRevenuePerInstitutionTrend(8, "fdic");
    expect(banks.trend[0]).toMatchObject({ report_date: "2026-09-30", source: "fdic", avg_sc_income: 2000000000, institution_count: 5 });
    const separated = await getRevenuePerInstitutionTrend(8);
    expect(separated.trend).toEqual(expect.arrayContaining([
      expect.objectContaining({ report_date: "2026-06-30", source: "ncua", institution_count: 7 }),
      expect.objectContaining({ report_date: "2026-06-30", source: "fdic", institution_count: 5 }),
    ]));
    expect(separated.signals).toEqual({ qoq_change_pct: null, yoy_change_pct: null });
  });

  it("keeps dependency ratios in their regulator-specific period and reporting groups", async () => {
    const separated = await getFeeDependencyTrend(8);
    expect(separated.trend).toEqual(expect.arrayContaining([
      expect.objectContaining({ report_date: "2026-06-30", source: "ncua", institution_count: 8 }),
      expect.objectContaining({ report_date: "2026-06-30", source: "fdic", institution_count: 5 }),
    ]));
    expect(separated.signals).toEqual({ qoq_change_pct: null, yoy_change_pct: null });
    const cu = await getFeeDependencyTrend(8, "ncua");
    expect(cu.trend.every((r) => (r as { source?: string }).source === "ncua")).toBe(true);
    expect(cu.trend[0].report_date).toBe("2026-06-30");
  });


  async function seedHealthMetrics() {
    // Five CUs filed usable older ratios; only four have ratios at the latest CU date.
    await db`UPDATE pg_temp.institution_financial_records SET roa = institution_id,
      roe = institution_id * 2, efficiency_ratio = 50 + institution_id
      WHERE source = 'ncua' AND ((report_date = '2026-03-31' AND institution_id <= 5)
        OR (report_date = '2026-06-30' AND institution_id <= 4))`;
    await db`UPDATE pg_temp.institution_financial_records SET roa = institution_id - 91,
      roe = (institution_id - 91) * 2, efficiency_ratio = institution_id - 41
      WHERE source = 'fdic' AND institution_id BETWEEN 101 AND 105`;
    // These valid numbers must not help a family meet five or change its median.
    await db`UPDATE pg_temp.institution_financial_records SET roa = 999, roe = 999, efficiency_ratio = 999
      WHERE (institution_id IN (1, 9) AND source = 'fdic') OR institution_id = 10`;
    await db`INSERT INTO pg_temp.institution_financial_records
      (institution_id, source, report_date, roa, roe, efficiency_ratio)
      VALUES (101, 'ncua', '2026-06-30', 888, 888, 888)`;
  }

  it("withholds a four-CU health median while five-bank metrics remain separate", async () => {
    await seedHealthMetrics();
    const byCharter = await getHealthMetricsByCharter();
    for (const metric of ["roa", "roe", "efficiency_ratio"] as const) {
      expect(byCharter.credit_union[metric]).toMatchObject({
        current: null, asOf: "2026-06-30", minimum_median_count: 5, trend: "insufficient_data",
        history: [
          { date: "2026-Q2", value: null, institution_count: 4 },
          { date: "2026-Q1", value: metric === "roa" ? 3 : metric === "roe" ? 6 : 53, institution_count: 5 },
        ],
      });
      expect(byCharter.bank[metric]).toMatchObject({
        current: metric === "roa" ? 12 : metric === "roe" ? 24 : 62,
        asOf: "2026-09-30", minimum_median_count: 5,
        history: [
          expect.objectContaining({ date: "2026-Q3", institution_count: 5 }),
          expect.objectContaining({ date: "2026-Q2", institution_count: 5 }),
        ],
      });
    }
    // The source-scoped industry tool obeys the same threshold and preserves the latest thin date.
    expect((await getIndustryHealthMetrics("ncua")).roa).toMatchObject({ current: null, asOf: "2026-06-30", trend: "insufficient_data" });
    expect((await getIndustryHealthMetrics("fdic")).roa).toMatchObject({ current: 12, asOf: "2026-09-30" });
  });

  it("publishes the CU health median exactly at five real canonical reporters", async () => {
    await seedHealthMetrics();
    await db`UPDATE pg_temp.institution_financial_records SET roa = 5, roe = 10, efficiency_ratio = 55
      WHERE institution_id = 5 AND source = 'ncua' AND report_date = '2026-06-30'`;
    const metrics = await getIndustryHealthMetrics("ncua");
    for (const metric of ["roa", "roe", "efficiency_ratio"] as const) {
      expect(metrics[metric]).toMatchObject({ current: metric === "roa" ? 3 : metric === "roe" ? 6 : 53,
        asOf: "2026-06-30", minimum_median_count: 5,
        history: [expect.objectContaining({ date: "2026-Q2", institution_count: 5 }), expect.anything()],
      });
    }
  });

});
