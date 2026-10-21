/**
 * The product-page repeat read in real PostgreSQL (production schema, loopback only, #1910): a
 * product page Rosetta typed `product_page` (TD's campaign page has no product word the address rule
 * misses) repeats the schedule's paper statement line at $3; a different price, a tier schedule and
 * monthly maintenance never pair.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { PRODUCT_PAGE_REPEAT_ROWS_SQL, findProductPageRepeats, type ProductPageRepeatRow } from "./product-page-repeat-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 1910001;
const CAMPAIGN = 1910101;
const SCHEDULE = 1910102;
const PREMIUM = 1910103;
const EVENT = "00000000-0000-4000-8000-000001910000";

describe.skipIf(!connection)("product-page repeats in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let nextRaw = 1910200;
  const ids: Record<string, number> = {};

  async function seed(label: string, documentId: number, key: string, name: string, amount: number, frequency = "monthly"): Promise<void> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
              VALUES (${rawId}, ${INST}, ${documentId}, ${EVENT}, ${name}, ${amount}, ${frequency}, 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, ${frequency}, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, ${frequency}, 'agentic-run-1910', 'https://bank.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id IN (${CAMPAIGN}, ${SCHEDULE}, ${PREMIUM})`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Product-page repeat DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Repeat Test Bank', 'bank', 'fdic', 'NJ')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${CAMPAIGN}, ${INST}, 'success', 'https://bank.test/us/en/offers/spring?cm_sp=b000', 'h1', NOW()),
                     (${SCHEDULE}, ${INST}, 'success', 'https://bank.test/content/dam/pdf/1-fees-en.pdf', 'h2', NOW()),
                     (${PREMIUM}, ${INST}, 'success', 'https://bank.test/content/dam/pdf/premium-fees.pdf', 'h3', NOW())`;
    const body = "Paper statements | $3 monthly fee";
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count, document_kind, document_kind_version)
              VALUES (${CAMPAIGN}, ${INST}, 'https://bank.test/us/en/offers/spring?cm_sp=b000', 'html', 'completed', ${body}, 't-1910', ${body.length}, 'product_page', 1)`;
    await seed("schedPaper", SCHEDULE, "paper_statement", "Paper statement (per statement cycle)", 3);
    await seed("schedStop", SCHEDULE, "stop_payment", "Stop Payment", 30, "per_item");
    await seed("schedMonthly", SCHEDULE, "monthly_maintenance", "Monthly maintenance fee", 15);
    await seed("premiumWire", PREMIUM, "wire_domestic_outgoing", "Premium Outgoing wire", 0, "per_item");
    await seed("paper", CAMPAIGN, "paper_statement", "Paper statements", 3);
    await seed("stop", CAMPAIGN, "stop_payment", "Stop payment", 25, "per_item");
    await seed("monthly", CAMPAIGN, "monthly_maintenance", "Monthly fee", 15);
    await seed("wire", CAMPAIGN, "wire_domestic_outgoing", "Outgoing wire", 0, "per_item");
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    await raw.end();
  });

  it("reads the Rosetta-typed product page's same-price repeat and nothing else", async () => {
    const rows = (await raw.unsafe(PRODUCT_PAGE_REPEAT_ROWS_SQL, [INST, 100])) as unknown as ProductPageRepeatRow[];
    expect(rows.map((row) => Number(row.fee_published_id))).toEqual([ids.paper]);
    const found = findProductPageRepeats(rows);
    expect(found.matches.map((match) => [match.feePublishedId, match.twinFeePublishedId])).toEqual([[ids.paper, ids.schedPaper]]);
  });
});
