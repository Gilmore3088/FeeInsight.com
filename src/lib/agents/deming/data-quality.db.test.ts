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
      fee_name text, amount numeric, rate_percent numeric, rate_min_amount numeric, rate_max_amount numeric, rate_basis text,
      amount_kind text, frequency text, fee_audience text, variant_type text,
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
      (9, 7, 'stop_payment', 'Stop Payment', 30, 'per_item', 'business', NULL, NULL, 'https://bank.example/fees'),
      (10, 7, 'card_replacement', 'Replacement Card', 10, 'per_item', 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (11, 7, 'card_replacement', 'Replacement Card', 10, NULL, 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (12, 7, 'safe_deposit_box', 'Box Rental', 50, 'monthly', 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (13, 7, 'safe_deposit_box', 'Box Rental', 50, 'monthly', 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (14, 7, 'safe_deposit_box', 'Box Rental', 50, 'annual', 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (15, 7, 'wire_domestic_outgoing', 'Wire  Outgoing', 25, 'per_item', 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (16, 7, 'wire_domestic_outgoing', 'Wire Outgoing', 25, 'per_item', 'consumer', NULL, NULL, 'https://bank.example/fees'),
      (17, 7, 'monthly_maintenance', 'Monthly Service', 6, 'monthly', 'consumer', NULL, ' Checking ', 'https://bank.example/fees')`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("grades only the same fee line twice, and counts a shared category and amount apart", async () => {
    const [row] = await db.unsafe(dataQualitySql("published_fee_catalog"), [90, ["paper_statement"], 20]);
    // The collapse's identity (duplicate-collapse.ts). Same line twice: #2 (case and outer spaces),
    // #8 (per item and per occurrence are one class), #11 (an unstated frequency matches a stated one)
    // and #17 (the product key ignores case and spacing). #12-#14 are left alone: their stated classes
    // disagree, so the collapse closes none. #15/#16 differ by an inner space, which the collapse keeps.
    expect([...(row.duplicates_sample as number[])].map(Number).sort((a, b) => a - b)).toEqual([2, 8, 11, 17]);
    expect(row.duplicates).toBe(4);
    // The old reading: anything sharing institution, category and amount.
    expect(row.same_amount).toBe(10);
  });

  it("keeps rate fees with different caps or bases apart", async () => {
    await db`CREATE TEMP TABLE published_fee_rate_catalog (fee_published_id bigint, institution_id bigint, fee_category text,
      fee_name text, amount numeric, rate_percent numeric, rate_min_amount numeric, rate_max_amount numeric, rate_basis text,
      amount_kind text, frequency text, fee_audience text, variant_type text, account_product_type text, source_url text,
      source_document_id bigint, created_at timestamptz DEFAULT now())`;
    await db`INSERT INTO published_fee_rate_catalog (fee_published_id, institution_id, fee_category, fee_name, rate_percent,
      rate_min_amount, rate_max_amount, rate_basis, amount_kind, frequency, fee_audience, source_url) VALUES
      (21, 7, 'foreign_transaction', 'Foreign Transaction', 1.1, NULL, NULL, 'transaction', 'percent', 'per_item', 'consumer', 'https://bank.example/fees'),
      (22, 7, 'foreign_transaction', 'Foreign Transaction', 1.1, NULL, NULL, 'transaction', 'percent', 'per_item', 'consumer', 'https://bank.example/fees'),
      (23, 7, 'foreign_transaction', 'Foreign Transaction', 1.1, 2, NULL, 'transaction', 'percent', 'per_item', 'consumer', 'https://bank.example/fees')`;
    const [row] = await db.unsafe(dataQualitySql("published_fee_rate_catalog"), [90, ["foreign_transaction"], 20]);
    expect([...(row.duplicates_sample as number[])].map(Number)).toEqual([22]);
    expect(row.same_amount).toBe(2);
  });
});
