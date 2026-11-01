// @vitest-environment node
/**
 * institutionValueSql (SQL) and valuePerInstitution (TS) give every institution the same value (#1911,
 * #1912). The same rows gave the same values on prod PostgreSQL as a read-only VALUES query on
 * 2026-10-26, wire channel rows (institutions 30 to 34) included.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { institutionValueSql, valuePerInstitution } from "./fee-stats";

const connection = process.env.E2E_DATABASE_URL;

// U.S. Bank's shape (institution 5), plus only-exception, only-general, two-product and account-priced cases.
const ROWS: { institution_id: number; fee_category: string; amount: number; account_product_type: string | null; fee_name?: string }[] = [
  { institution_id: 5, fee_category: "atm_non_network", amount: 2.5, account_product_type: "Safe Debit Account" },
  { institution_id: 5, fee_category: "atm_non_network", amount: 3, account_product_type: null },
  { institution_id: 5, fee_category: "money_order", amount: 1.65, account_product_type: "Safe Debit Account" },
  { institution_id: 5, fee_category: "money_order", amount: 5, account_product_type: null },
  { institution_id: 6, fee_category: "money_order", amount: 1.65, account_product_type: "Safe Debit Account" },
  { institution_id: 7, fee_category: "money_order", amount: 5, account_product_type: null },
  { institution_id: 7, fee_category: "money_order", amount: 7, account_product_type: " \t " },
  { institution_id: 8, fee_category: "excess_withdrawal", amount: 10, account_product_type: "Money Market" },
  { institution_id: 8, fee_category: "excess_withdrawal", amount: 15, account_product_type: "Statement Savings" },
  { institution_id: 9, fee_category: "monthly_maintenance", amount: 12, account_product_type: "Premier Checking" },
  { institution_id: 9, fee_category: "monthly_maintenance", amount: 5, account_product_type: null },
  { institution_id: 9, fee_category: "monthly_maintenance", amount: 8, account_product_type: "Easy Checking" },
  { institution_id: 10, fee_category: "overdraft", amount: 39, account_product_type: "Premier Checking" },
  { institution_id: 10, fee_category: "overdraft", amount: 35, account_product_type: null },
  { institution_id: 10, fee_category: "overdraft", amount: 20, account_product_type: null },
  // #1912: M&T's shape (institution 21): a money market account's own charge beside unassigned checking rows.
  { institution_id: 21, fee_category: "monthly_maintenance", amount: 4.95, account_product_type: null },
  { institution_id: 21, fee_category: "monthly_maintenance", amount: 14.95, account_product_type: null },
  { institution_id: 21, fee_category: "monthly_maintenance", amount: 24.95, account_product_type: null },
  { institution_id: 21, fee_category: "monthly_maintenance", amount: 20, account_product_type: "M&T Preferred Money Market" },
  { institution_id: 22, fee_category: "minimum_balance", amount: 5, account_product_type: "Statement Savings" },
  { institution_id: 23, fee_category: "minimum_balance", amount: 5, account_product_type: "Truth in Savings" },
  { institution_id: 23, fee_category: "minimum_balance", amount: 10, account_product_type: "Holiday Club" },
  { institution_id: 24, fee_category: "monthly_maintenance", amount: 3, account_product_type: "Kids' Club" },
  { institution_id: 24, fee_category: "monthly_maintenance", amount: 9, account_product_type: "Gold Checking" },
  { institution_id: 25, fee_category: "minimum_balance", amount: 2, account_product_type: null },
  { institution_id: 25, fee_category: "minimum_balance", amount: 8, account_product_type: "Youth Savings Program" },
  // #1912 wire channels: an online price beside the general one, "in branch" as the general price,
  // a PIN wire beside a branch one, only channel rows (all count), and an online row outside the wires.
  { institution_id: 30, fee_category: "wire_domestic_outgoing", amount: 15, account_product_type: null, fee_name: "Online Outgoing Domestic Wire" },
  { institution_id: 30, fee_category: "wire_domestic_outgoing", amount: 30, account_product_type: null, fee_name: "Outgoing Domestic Wire" },
  { institution_id: 31, fee_category: "wire_domestic_outgoing", amount: 15, account_product_type: null, fee_name: "Wire transfers: Domestic outgoing (online)" },
  { institution_id: 31, fee_category: "wire_domestic_outgoing", amount: 20, account_product_type: null, fee_name: "Wire transfers: Domestic outgoing (in branch)" },
  { institution_id: 32, fee_category: "wire_intl_outgoing", amount: 40, account_product_type: null, fee_name: "Wire Transfers – Outgoing Wire: PIN - International" },
  { institution_id: 32, fee_category: "wire_intl_outgoing", amount: 60, account_product_type: null, fee_name: "Wire Transfers – Outgoing Wire: Branch - International" },
  { institution_id: 33, fee_category: "wire_domestic_outgoing", amount: 12, account_product_type: null, fee_name: "Domestic Outbound Wires (Online)" },
  { institution_id: 33, fee_category: "wire_domestic_outgoing", amount: 18, account_product_type: null, fee_name: "Repetitive Wire - Domestic" },
  { institution_id: 34, fee_category: "atm_non_network", amount: 1, account_product_type: null, fee_name: "Online ATM locator" },
  { institution_id: 34, fee_category: "atm_non_network", amount: 3, account_product_type: null, fee_name: "Foreign ATM" },
];

describe.skipIf(!connection)("product exception value in PostgreSQL (#1911)", () => {
  let db: postgres.Sql;
  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Product exception SQL tests require an owned loopback database");
    db = postgres(connection, { max: 1, ssl: "require" });
    await db`CREATE TEMP TABLE catalog_rows (institution_id bigint, fee_category text, amount numeric, account_product_type text, fee_name text)`;
    for (const row of ROWS) {
      await db`INSERT INTO catalog_rows VALUES (${row.institution_id}, ${row.fee_category}, ${row.amount}, ${row.account_product_type}, ${row.fee_name ?? null})`;
    }
  });
  afterAll(async () => { if (db) await db.end(); });

  it("matches the TypeScript reducer for every institution and category", async () => {
    const sqlRows = await db.unsafe(
      `SELECT ef.institution_id, ef.fee_category, (${institutionValueSql("ef")})::float8 AS value
         FROM catalog_rows ef GROUP BY ef.institution_id, ef.fee_category`,
    ) as unknown as { institution_id: string | number; fee_category: string; value: number }[];
    const fromSql = new Map(sqlRows.map((row) => [`${Number(row.institution_id)}|${row.fee_category}`, Number(row.value)]));
    const fromTs = new Map<string, number>();
    for (const category of new Set(ROWS.map((row) => row.fee_category))) {
      for (const [id, value] of valuePerInstitution(ROWS.filter((row) => row.fee_category === category))) fromTs.set(`${id}|${category}`, value);
    }
    expect(fromSql.size).toBe(fromTs.size);
    for (const [key, value] of fromTs) expect(fromSql.get(key)).toBeCloseTo(value, 9);
    expect(fromSql.get("5|atm_non_network")).toBe(3);
    expect(fromSql.get("5|money_order")).toBe(5);
    expect(fromSql.get("6|money_order")).toBe(1.65);
    expect(fromSql.get("8|excess_withdrawal")).toBe(12.5);
    expect(fromSql.get("9|monthly_maintenance")).toBe(8);
    expect(fromSql.get("10|overdraft")).toBe(35);
    expect(fromSql.get("21|monthly_maintenance")).toBe(14.95);
    expect(fromSql.get("22|minimum_balance")).toBe(5);
    expect(fromSql.get("23|minimum_balance")).toBe(5);
    expect(fromSql.get("24|monthly_maintenance")).toBe(9);
    expect(fromSql.get("25|minimum_balance")).toBe(2);
    expect(fromSql.get("30|wire_domestic_outgoing")).toBe(30);
    expect(fromSql.get("31|wire_domestic_outgoing")).toBe(20);
    expect(fromSql.get("32|wire_intl_outgoing")).toBe(60);
    expect(fromSql.get("33|wire_domestic_outgoing")).toBe(15);
    expect(fromSql.get("34|atm_non_network")).toBe(2);
  });
});
