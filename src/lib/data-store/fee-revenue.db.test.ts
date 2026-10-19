// @vitest-environment node
/** Execute the real reader SQL on connection-owned, loopback-only fixtures. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./connection", () => ({
  sql: Object.assign((...args: unknown[]) => Reflect.apply(context.db as (...args: unknown[]) => unknown, null, args), {
    unsafe: (...args: unknown[]) => Reflect.apply((context.db as { unsafe: (...args: unknown[]) => unknown }).unsafe, context.db, args),
  }),
}));

import { getCharterFeeRevenueSummary, getFeeRevenueData, getFiledFeeIncomeData, getTierFeeRevenueSummary } from "./fee-revenue";
import { feeIncomeAgainstPeers } from "@/lib/research/fee-income-peers";
import { writtenAnswerCheck } from "@/lib/hamilton/answer-save";

const connection = process.env.E2E_DATABASE_URL;
describe.skipIf(!connection)("fee-revenue eligibility and source parity in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Fee-revenue SQL tests require a loopback database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, onnotice: () => {} });
    context.db = db;
    await db`CREATE TEMP TABLE institution_sources (
      id bigint PRIMARY KEY, institution_name text, charter_type text,
      state_code text, asset_size_tier text, fed_district integer, regulatory_status text)`;
    await db`CREATE TEMP TABLE institution_financial_records (
      institution_id bigint, source text, report_date text,
      total_assets numeric, service_charge_income numeric,
      UNIQUE (institution_id, source, report_date))`;
    await db`CREATE TEMP TABLE published_fee_catalog (
      institution_id bigint, canonical_fee_key text, fee_category text, fee_name text,
      amount numeric, review_status text, source_document_id bigint, fee_audience text,
      source_url text, frequency text)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE pg_temp.published_fee_catalog, pg_temp.institution_financial_records, pg_temp.institution_sources`;
  });

  async function institution(id: number, charter: string, source: string, date = "2026-06-30", income = 350) {
    await db`INSERT INTO institution_sources VALUES (${id}, ${`Institution ${id}`}, ${charter}, 'VA', 'regional', 5, NULL)`;
    await db`INSERT INTO institution_financial_records VALUES (${id}, ${source}, ${date}, 20000000, ${income})`;
    if (source === "ncua" && date === "2026-06-30") {
      await db`INSERT INTO institution_financial_records VALUES (${id}, ${source}, '2026-03-31', 19000000, 100)`;
    }
  }

  async function fee(id: number, category: string, amount: number, options: {
    status?: string; document?: number | null; url?: string; audience?: string; frequency?: string;
  } = {}) {
    await db`INSERT INTO published_fee_catalog VALUES (
      ${id}, ${category}, ${category}, 'Fee', ${amount}, ${options.status ?? "approved"},
      ${options.document === undefined ? 1 : options.document}, ${options.audience ?? "consumer"},
      ${options.url ?? "https://example.test/personal/fees"}, ${options.frequency ?? "per_item"})`;
  }

  async function threeFees(id: number) {
    await fee(id, "overdraft", 30);
    await fee(id, "nsf", 20);
    await fee(id, "wire_domestic_outgoing", 10);
  }

  function ordered<T>(rows: T[]): T[] {
    return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  it("scoped readers exactly match the corresponding unscoped groups, with canonical latest dates and quarters", async () => {
    await institution(1, "credit_union", "ncua");
    await institution(2, "credit_union", "ncua", "2026-03-31", 125);
    await institution(101, "bank", "fdic", "2026-06-30", 700);
    await institution(102, "bank", "fdic", "2026-09-30", 200);
    await institution(3, "credit_union", "fdic"); // Wrong regulator is never a substitute.
    await institution(4, "unknown", "ncua");
    await institution(5, "credit_union", "ncua");
    await db`DELETE FROM pg_temp.institution_financial_records WHERE institution_id = 5 AND report_date = '2026-03-31'`;
    // A newer wrong-source filing must not replace a CU's canonical June filing.
    await db`INSERT INTO institution_financial_records VALUES (1, 'fdic', '2026-09-30', 99999999, 999999)`;
    for (const id of [1, 2, 3, 4, 5, 101, 102]) await threeFees(id);

    const allInstitutions = await getFeeRevenueData();
    const allFinancials = await getFiledFeeIncomeData();
    const allTiers = await getTierFeeRevenueSummary();
    const allCharters = await getCharterFeeRevenueSummary();
    expect(allInstitutions.map((row) => Number(row.institution_id)).sort((a, b) => a - b)).toEqual([1, 2, 101, 102]);
    expect(allInstitutions.find((row) => Number(row.institution_id) === 1)).toMatchObject({
      financial_source: "ncua", report_date: "2026-06-30", service_charge_income: "250",
    });
    expect(allInstitutions.find((row) => Number(row.institution_id) === 2)).toMatchObject({
      financial_source: "ncua", report_date: "2026-03-31", service_charge_income: "125",
    });
    for (const source of ["fdic", "ncua"] as const) {
      expect(ordered(await getFiledFeeIncomeData(source))).toEqual(ordered(allFinancials.filter((row) => row.financial_source === source)));
      expect(ordered(await getFeeRevenueData(source))).toEqual(ordered(allInstitutions.filter((row) => row.financial_source === source)));
      expect(ordered(await getTierFeeRevenueSummary(source))).toEqual(ordered(allTiers.filter((row) => row.financial_source === source)));
      expect(ordered(await getCharterFeeRevenueSummary(source))).toEqual(ordered(allCharters.filter((row) => row.financial_source === source)));
    }
    expect(allTiers).toHaveLength(4);
    expect(allCharters).toHaveLength(4);
  });

  it.each([
    ["ncua", "credit_union", 0],
    ["fdic", "bank", 100],
  ] as const)("preserves %s category eligibility, zeros, overdraft maxima and other-category medians", async (source, charter, offset) => {
    for (let index = 1; index <= 9; index++) {
      const id = offset + index;
      await institution(id, charter, source);
      await fee(id, "overdraft", 10);
      await fee(id, "nsf", 20);
    }
    const first = offset + 1;
    await db`DELETE FROM pg_temp.published_fee_catalog WHERE institution_id = ${first}`;
    for (const amount of [0, 20, 40]) await fee(first, "overdraft", amount);
    await fee(first, "nsf", 0);
    for (const amount of [10, 30, 90]) await fee(first, "wire_domestic_outgoing", amount);
    // Institution 2 remains below three distinct eligible categories.
    await fee(offset + 3, "wire_domestic_outgoing", 30, { url: "https://example.test/business/fees" });
    await fee(offset + 4, "wire_domestic_outgoing", 30, { status: "pending" });
    await fee(offset + 5, "wire_domestic_outgoing", -1);
    await fee(offset + 6, "wire_domestic_outgoing", 30, { document: null });
    await fee(offset + 7, "wire_domestic_outgoing", 30, { frequency: "per_minute" });
    await fee(offset + 8, "wire_domestic_outgoing", 0); // A genuine zero is eligible.
    await fee(offset + 9, "overdraft", 99); // A duplicate category is not a third category.

    const rows = await getFeeRevenueData(source);
    expect(rows.map((row) => Number(row.institution_id)).sort((a, b) => a - b)).toEqual([first, offset + 8]);
    expect(rows.find((row) => Number(row.institution_id) === first)).toMatchObject({ avg_fee: 23.33, fee_count: 3 });
    expect(rows.find((row) => Number(row.institution_id) === offset + 8)).toMatchObject({ avg_fee: 10, fee_count: 3 });
    expect(await getTierFeeRevenueSummary(source)).toEqual([
      expect.objectContaining({ financial_source: source, institution_count: 2, avg_fee_amount: 16.67 }),
    ]);
    expect(await getCharterFeeRevenueSummary(source)).toEqual([
      expect.objectContaining({ financial_source: source, charter_type: charter, institution_count: 2, avg_fee_amount: 16.67 }),
    ]);
  });

  it.each([
    ["ncua", "credit_union", 0], ["fdic", "bank", 100],
  ] as const)("compares %s filed income without fee schedules while preserving correlation eligibility (#2332)", async (source, charter, offset) => {
    const id = (index: number) => offset + index;
    for (let index = 1; index <= 6; index++) {
      await institution(id(index), charter, source, "2026-06-30", index === 2 ? (source === "ncua" ? 100 : 0) : index * 100);
    }
    // The subject has no fee rows. Other valid peers have zero, one, two or three categories.
    await fee(id(2), "overdraft", 20);
    await fee(id(3), "overdraft", 20);
    await fee(id(3), "nsf", 10);
    await threeFees(id(4));
    await institution(id(7), charter, source, "2026-03-31", 900);
    await institution(id(8), charter, source === "ncua" ? "fdic" : "ncua");
    await institution(id(9), "unknown", source);
    // A newer noncanonical filing must not displace the subject's canonical June quarter.
    await db`INSERT INTO institution_financial_records VALUES
      (${id(1)}, ${source === "ncua" ? "fdic" : "ncua"}, '2026-09-30', 99999999, 999999)`;
    // Do not fall back to an older complete quarter when the latest canonical income is missing.
    await institution(id(11), charter, source);
    await db`INSERT INTO institution_financial_records VALUES (${id(11)}, ${source}, '2026-09-30', 20000000, NULL)`;
    if (source === "ncua") {
      await institution(id(10), charter, source);
      await db`DELETE FROM pg_temp.institution_financial_records WHERE institution_id = ${id(10)} AND report_date = '2026-03-31'`;
      await threeFees(id(10)); // More price coverage cannot replace the missing prior YTD.
    }

    const financials = await getFiledFeeIncomeData(source);
    expect(financials.map((row) => row.institution_id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7].map(id));
    expect(financials.find((row) => row.institution_id === id(1))).toMatchObject({
      financial_source: source, charter_type: charter, report_date: "2026-06-30",
      total_assets: 20_000_000, service_charge_income: source === "ncua" ? 0 : 100,
    });
    expect(financials.find((row) => row.institution_id === id(2))).toMatchObject({
      service_charge_income: 0, fee_income_ratio: 0, fed_district: 5,
    });
    expect(financials.every((row) => !("avg_fee" in row) && !("fee_count" in row))).toBe(true);
    const comparable = feeIncomeAgainstPeers(financials, id(1), { states: ["VA"], charterType: charter, assetTiers: ["regional"], fedDistricts: [5] });
    expect(comparable).toMatchObject({
      peer_count: 5, quarter: "2026-06-30",
      peer_median_service_charge_income: source === "ncua" ? 300 : 400,
      comparison: { sample_size: 5, subject_included: false, population_basis: "filed_financials", fee_schedule_coverage_required: false },
    });
    const thin = feeIncomeAgainstPeers(financials, id(1), { institutionIds: [2, 3, 4, 5].map(id) });
    expect(thin).toMatchObject({ peer_count: 4, peer_median_service_charge_income: null, peer_median_income_per_10k_assets: null });
    // The three actual price/income correlations retain their three-category gate unchanged.
    expect((await getFeeRevenueData(source)).map((row) => Number(row.institution_id))).toEqual([id(4)]);
    expect(await getTierFeeRevenueSummary(source)).toEqual([expect.objectContaining({ institution_count: 1 })]);
    expect(await getCharterFeeRevenueSummary(source)).toEqual([expect.objectContaining({ institution_count: 1 })]);
  });

  it("preserves missing asset ratios rather than coercing them to zero in filing-only rows", async () => {
    await institution(1, "credit_union", "ncua");
    await db`UPDATE pg_temp.institution_financial_records SET total_assets = NULL WHERE institution_id = 1 AND report_date = '2026-06-30'`;
    expect(await getFiledFeeIncomeData("ncua")).toEqual([expect.objectContaining({
      institution_id: 1, service_charge_income: 250, total_assets: null, fee_income_ratio: null,
    })]);
  });

  it("compares PenFed's filed Q2 income with deliberately absent test-only schedule coverage", async () => {
    // Official NCUA March/June 2026 ACCT_131, rounded to the core reader's $000 storage:
    // https://ncua.gov/files/publications/analysis/call-report-data-2026-03.zip
    // https://ncua.gov/files/publications/analysis/call-report-data-2026-06.zip
    // Zero schedule rows and the five peers below are synthetic test conditions, not live coverage.
    await institution(4382, "credit_union", "ncua", "2026-06-30", 57_262);
    await db`UPDATE pg_temp.institution_sources SET institution_name = 'Pentagon Federal Credit Union' WHERE id = 4382`;
    await db`UPDATE pg_temp.institution_financial_records SET total_assets = 29196093 WHERE institution_id = 4382 AND report_date = '2026-06-30'`;
    await db`UPDATE pg_temp.institution_financial_records SET service_charge_income = 27230, total_assets = 29396724 WHERE institution_id = 4382 AND report_date = '2026-03-31'`;
    for (let id = 1; id <= 5; id++) await institution(id, "credit_union", "ncua", "2026-06-30", 250 + id * 100);

    expect(await getFeeRevenueData("ncua")).toEqual([]);
    const result = feeIncomeAgainstPeers(await getFiledFeeIncomeData("ncua"), 4382, {
      charterType: "credit_union", assetTiers: ["regional"],
    });
    expect(result).toMatchObject({
      quarter: "2026-06-30", subject: { institution_id: 4382, service_charge_income: 30_032, income_per_10k_assets: 10.29 },
      peer_count: 5, peer_median_service_charge_income: 450,
      comparison: { financial_source: "ncua", population_basis: "filed_financials", subject_included: false, fee_schedule_coverage_required: false },
    });
    const question = "How much fee income did PenFed report for Q2 2026?";
    const context = { institutionId: 4382, toolResults: [{ toolName: "queryFeeRevenueCorrelation", input: { view: "peers", institution_id: 4382, charter_type: "credit_union", asset_tiers: ["regional"] }, output: result }] };
    expect(writtenAnswerCheck("PenFed reported $30.032 million in broad fee income for Q2 2026.", [result], question, context)).toMatchObject({ passed: true, problems: [] });
    expect(writtenAnswerCheck("PenFed reported $57.262 million in broad fee income for Q2 2026.", [result], question, context).passed).toBe(false);
  });

  it.each([
    ["ncua", "credit_union"], ["fdic", "bank"],
  ] as const)("keeps the selected inactive %s filing but excludes inactive comparison peers (#2397)", async (source, charter) => {
    for (let id = 1; id <= 7; id++) {
      await institution(id, charter, source, "2026-06-30", id === 1 ? 1000 : id === 7 ? 999999 : id * 100);
      await threeFees(id);
    }
    await db`UPDATE pg_temp.institution_sources SET regulatory_status = 'inactive' WHERE id IN (1, 7)`;
    await db`UPDATE pg_temp.institution_sources SET regulatory_status = 'active' WHERE id = 6`;
    const financials = await getFiledFeeIncomeData(source);
    expect(financials).toHaveLength(7); // Own filings remain readable, including closed institutions.
    expect(financials.find((row) => row.institution_id === 1)).toMatchObject({ regulatory_status: "inactive" });
    expect(financials.find((row) => row.institution_id === 2)).toMatchObject({ regulatory_status: null });
    const result = feeIncomeAgainstPeers(financials, 1, {});
    expect(result).toMatchObject({
      subject: { institution_id: 1, regulatory_status: "inactive", service_charge_income: source === "ncua" ? 900 : 1000 },
      peer_count: 5, peer_median_service_charge_income: source === "ncua" ? 300 : 400,
      comparison: { sample_size: 5, status_basis: "current_registry_status", inactive_peers_excluded: true, subject_included: false },
    });
    expect("peers" in result && result.peers.map((row) => row.institution_id)).toEqual([2, 3, 4, 5, 6]);
    // The merged price/income readers retain their existing active-institution SQL rule.
    expect((await getFeeRevenueData(source)).map((row) => Number(row.institution_id)).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6]);
    expect(await getTierFeeRevenueSummary(source)).toEqual([expect.objectContaining({ institution_count: 5 })]);
    expect(await getCharterFeeRevenueSummary(source)).toEqual([expect.objectContaining({ institution_count: 5 })]);

    await db`UPDATE pg_temp.institution_sources SET regulatory_status = 'inactive' WHERE id = 6`;
    const thin = feeIncomeAgainstPeers(await getFiledFeeIncomeData(source), 1, {});
    expect(thin).toMatchObject({
      subject: { institution_id: 1, regulatory_status: "inactive" }, peer_count: 4,
      peer_median_service_charge_income: null, peer_median_income_per_10k_assets: null,
      comparison: { sample_size: 4 },
    });
  });
});
