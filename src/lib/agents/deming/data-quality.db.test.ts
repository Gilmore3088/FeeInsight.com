import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dataQualitySql } from "./data-quality";

const connection = process.env.E2E_DATABASE_URL;

/**
 * Deming's daily duplicate check against real PostgreSQL. Temporary tables shadow the catalog
 * view and its joins, so the shipped SQL runs unchanged over controlled rows.
 */
describe.skipIf(!connection)("Deming data-quality duplicates in isolated PostgreSQL", () => {
  let db: postgres.Sql;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Data-quality SQL tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require" });
    await db`CREATE TEMP TABLE published_fee_catalog (fee_published_id bigint, institution_id bigint, fee_category text,
      fee_name text, amount numeric, rate_percent numeric, frequency text, fee_audience text, variant_type text,
      account_product_type text, source_url text, source_document_id bigint, created_at timestamptz DEFAULT now())`;
    await db`CREATE TEMP TABLE source_documents (id bigint, document_url text, last_checked_at timestamptz, crawled_at timestamptz)`;
    await db`CREATE TEMP TABLE agent_source_texts (source_document_id bigint, source_url text)`;
    await db`INSERT INTO published_fee_catalog
      (fee_published_id, institution_id, fee_category, fee_name, amount, frequency, fee_audience, variant_type, account_product_type, source_url)
      VALUES
      (1, 7, 'paper_statement', 'Paper Statement', 3, 'monthly', 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (2, 7, 'paper_statement', 'paper statement ', 3, 'monthly', 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (3, 7, 'document_reproduction', 'Statement Copy', 5, NULL, 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (4, 7, 'document_reproduction', 'Check Image', 5, NULL, 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (5, 7, 'monthly_maintenance', 'Monthly Service', 6, 'monthly', 'consumer', NULL, 'CHECKING', 'https://bank.example/fees'),
      (6, 7, 'monthly_maintenance', 'Monthly Service', 6, 'monthly', 'consumer', NULL, 'SAVINGS', 'https://bank.example/fees'),
      (7, 7, 'stop_payment', 'Stop Payment', 30, 'per_item', 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (8, 7, 'stop_payment', 'Stop Payment', 30, 'per_occurrence', 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (9, 7, 'stop_payment', 'Stop Payment', 30, 'per_item', 'business', NULL, NULL, 'https://bank.example/fees')`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("grades only the same fee line twice, and counts a shared category and amount apart", async () => {
    const [row] = await db.unsafe(dataQualitySql("published_fee_catalog"), [90, ["paper_statement"], 20]);
    // Same line twice: #2 (name differs only in case and spacing) and #8 (per item and per occurrence
    // name the same charge). Different names, products or audiences are separate fee lines.
    expect(row.duplicates).toBe(2);
    expect([...(row.duplicates_sample as number[])].map(Number).sort()).toEqual([2, 8]);
    // The old reading: anything sharing institution, category and amount.
    expect(row.same_amount).toBe(5);
  });
});
