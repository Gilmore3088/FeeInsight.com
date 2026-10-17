/** Real PostgreSQL checks of the peer fee reads, in a loopback-only, temporary-table connection. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPublishedPeerFees, getPublishedPeerRateFees } from "./hamilton-peer-fees";

const connection = process.env.E2E_DATABASE_URL;
describe.skipIf(!connection)("peer fee SQL in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  const asDb = () => db as unknown as NonNullable<Parameters<typeof getPublishedPeerFees>[2]>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Peer fee SQL tests require a loopback E2E database; production connections are forbidden");
    db = postgres(connection, { max: 1, ssl: "require" });
    // Temporary tables shadow the views for this connection only; nothing persists.
    for (const name of ["published_fee_catalog", "published_fee_rate_catalog"]) {
      await db.unsafe(`CREATE TEMP TABLE ${name} (
        id bigint, institution_id bigint, fee_name text, amount numeric, frequency text, created_at timestamptz,
        source_document_id bigint, document_url text, source_url text, fee_category text, review_status text,
        fee_audience text, amount_kind text, rate_percent numeric, rate_min_amount numeric, rate_max_amount numeric, rate_basis text)`);
    }
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE published_fee_catalog, published_fee_rate_catalog`;
    await db`INSERT INTO published_fee_catalog (id, institution_id, fee_name, amount, frequency, created_at, source_document_id, document_url, source_url, fee_category, review_status, fee_audience, amount_kind) VALUES
      (1, 303, 'Foreign transaction fee', 0, 'per_item', '2026-09-01', 11, 'https://bank.test/fees.pdf', NULL, 'card_foreign_txn', 'approved', 'consumer', 'flat'),
      (2, 404, 'NSF fee', 30, 'per_item', '2026-09-01', 12, NULL, 'https://bank.test/fees', 'nsf', 'approved', 'consumer', 'flat')`;
    await db`INSERT INTO published_fee_rate_catalog (id, institution_id, fee_name, frequency, created_at, source_document_id, document_url, source_url, fee_category, review_status, fee_audience, amount_kind, rate_percent, rate_min_amount, rate_basis) VALUES
      (10, 303, 'International purchase', 'per_item', '2026-08-15', 13, 'https://bank.test/fees.pdf', NULL, 'card_foreign_txn', 'approved', 'consumer', 'percent', 1.1, NULL, 'transaction'),
      (11, 404, 'Foreign transaction', 'per_item', '2024-05-01', 14, NULL, 'https://bank.test/fees', 'card_foreign_txn', 'approved', 'both', 'percent', 3, 10, 'transaction'),
      (12, 404, 'Business foreign transaction', 'per_item', '2026-08-15', 15, NULL, 'https://bank.test/fees', 'card_foreign_txn', 'approved', 'business', 'percent', 2, NULL, 'transaction'),
      (13, 505, 'Foreign transaction', 'per_item', '2026-08-15', NULL, NULL, 'https://bank.test/fees', 'card_foreign_txn', 'approved', 'consumer', 'percent', 1, NULL, 'transaction'),
      (14, 606, 'Foreign transaction', 'per_item', '2026-08-15', 16, NULL, 'https://bank.test/fees', 'card_foreign_txn', 'approved', 'consumer', 'percent', 1, NULL, 'transaction'),
      (15, 303, 'Cash advance', 'per_item', '2026-08-15', 17, NULL, 'https://bank.test/fees', 'cash_advance', 'approved', 'consumer', 'percent', 4, NULL, 'advance')`;
  });

  it("reads each selected peer's consumer rate fees for the category, one line each", async () => {
    const rates = await getPublishedPeerRateFees([303, 404, 505], "card_foreign_txn", asDb());
    // 404's business-only line, 505's line without a stored document, 606 (not selected) and
    // 303's cash advance (another category) are all left out.
    expect(rates.map(r => [r.institutionId, r.id, r.rateLabel])).toEqual([
      [303, 10, "1.1% of the transaction"],
      [404, 11, "3% of the transaction ($10 minimum)"],
    ]);
    expect(rates[1].publishedAt).toBe("2024-05-01T00:00:00.000Z");
    expect(rates[1].sourceUrl).toBe("https://bank.test/fees");
  });

  it("keeps the dollar read on the dollar view, so a $0 line and a rate line stay apart", async () => {
    const dollars = await getPublishedPeerFees([303, 404], "card_foreign_txn", asDb());
    expect(dollars.map(f => [f.institutionId, f.id, f.amount])).toEqual([[303, 1, 0]]);
    const rates = await getPublishedPeerRateFees([303, 404], "card_foreign_txn", asDb());
    expect(rates.map(r => r.id)).toEqual([10, 11]);
  });

  it("returns no rate lines for a category with none", async () => {
    expect(await getPublishedPeerRateFees([303, 404], "nsf", asDb())).toEqual([]);
  });
});
