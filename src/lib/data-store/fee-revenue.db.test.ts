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

import { getCharterFeeRevenueSummary, getFeeRevenueData, getTierFeeRevenueSummary } from "./fee-revenue";

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
      state_code text, asset_size_tier text, fed_district integer)`;
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
    await db`INSERT INTO institution_sources VALUES (${id}, ${`Institution ${id}`}, ${charter}, 'VA', 'regional', 5)`;
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
});
