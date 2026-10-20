/**
 * The product-page conflict read in real PostgreSQL (production schema, loopback only): the
 * schedule must price the same item, not only the same category, and a tier's own product page
 * never counts (Lane speed's sample of 2026-10-20 found 12 of 20 takedowns wrong).
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { productPageConflictSql, isSameItemConflict } from "./product-page-conflict";

const connection = process.env.E2E_DATABASE_URL;
const INST = 2438001;
const PRODUCT = 2438101;
const SCHEDULE = 2438102;
const BANKON = 2438103;
const EVENT = "00000000-0000-4000-8000-000002438000";

describe.skipIf(!connection)("product-page conflicts in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let nextRaw = 2438200;
  const ids: Record<string, number> = {};

  async function seed(label: string, documentId: number, key: string, name: string, amount: number): Promise<void> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
              VALUES (${rawId}, ${INST}, ${documentId}, ${EVENT}, ${name}, ${amount}, 'per_item', 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'agentic-run-2438', 'https://bank.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Product-page conflict DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Conflict Test Bank', 'bank', 'fdic', 'TX')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${PRODUCT}, ${INST}, 'success', 'https://bank.test/personal/checking', 'h1', NOW()),
                     (${SCHEDULE}, ${INST}, 'success', 'https://bank.test/documents/fee-schedule.pdf', 'h2', NOW()),
                     (${BANKON}, ${INST}, 'success', 'https://bank.test/personal/checking/bankon', 'h3', NOW())`;
    // Schedule side.
    await seed("schedStop", SCHEDULE, "stop_payment", "Stop Payment", 30);
    await seed("schedBillPay", SCHEDULE, "nsf", "Bill Pay NSF Fee", 25);
    await seed("schedOverdraft", SCHEDULE, "overdraft", "Overdraft Fee", 35);
    // Product side.
    await seed("stop", PRODUCT, "stop_payment", "Stop Payment Fee", 25);
    await seed("returned", PRODUCT, "nsf", "Returned Item Fee", 30);
    await seed("bankon", BANKON, "overdraft", "Overdraft Fee", 0);
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
    await raw.end();
  });

  it("flags only the same item priced differently, and never a tier's own product page", async () => {
    const rows = await raw.unsafe(productPageConflictSql("institution"), [INST]);
    const conflicts = (rows as unknown as Parameters<typeof isSameItemConflict>[0][]).filter(isSameItemConflict).map((row) => Number(row.fee_published_id));
    // The SQL still reads the returned item against the category; the same-item rule drops it.
    expect(rows.map((row) => Number(row.fee_published_id)).sort()).toEqual([ids.stop, ids.returned].sort());
    expect(conflicts).toEqual([ids.stop]);
  });
});
