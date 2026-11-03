/**
 * One printed line live under two products, in real PostgreSQL (production schema, loopback only).
 * Shaped on re-read backlog dry runs 3 and 4 (Nov 3): Polish & Slavic FCU's older copy carries
 * "Minimum Balance Fee | $0.00" live under no product, and the current copy's re-read reads it under
 * its heading "Savings/Checking Accounts". A line the current copy prints under two accounts
 * (Cambridge Savings' "$10" twice) stays two fees. Publish's read names the live row a re-read repeats.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { selectProductSplitTwin } from "@/lib/agents/hamilton/product-split";
import { PRODUCT_SPLIT_ROWS_SQL, findProductSplits, productSplitPairs, recheckProductSplits, type ProductSplitPairRow } from "./product-split-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 3110301;
const OLD = 3110311;
const NEW = 3110312;
const EVENT = "00000000-0000-4000-8000-000003110300";
const PAGE = "https://www.psfcu.test/fee-schedule";

const MIN = "Minimum Balance Fee | $0.00";
const MONTHLY = "Monthly Fee | $0.00";
const TEN = "Monthly Maintenance Service Charge | $10";
const TEXT = ["Savings/Checking Accounts", "", MONTHLY, "", MIN, "", "PERFORMANCE CHECKING", "", TEN, "", "MONEY MARKET", "", TEN].join("\n");

describe.skipIf(!connection)("product-split pairs in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let nextRaw = 3110400;
  const ids: Record<string, number> = {};
  const rawIds: Record<string, number> = {};

  async function rawRow(label: string, documentId: number, name: string, amount: number, product: string | null, line: string): Promise<number> {
    const rawId = nextRaw++;
    const note = `Knox deterministic extraction from Rosetta artifact #1. canonical_hint=x; excerpt="${line}"`;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source, extraction_note, product_name)
              VALUES (${rawId}, ${INST}, ${documentId}, ${EVENT}, ${name}, ${amount}, 'monthly', 'knox', ${note}, ${product})`;
    rawIds[label] = rawId;
    return rawId;
  }

  async function seed(label: string, documentId: number, key: string, name: string, amount: number, product: string | null, line: string): Promise<void> {
    const rawId = await rawRow(label, documentId, name, amount, product, line);
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'monthly', 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'monthly', 'agentic-run-3110', ${PAGE}) RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id IN (${OLD}, ${NEW})`;
    await raw`UPDATE source_documents SET superseded_by_id = NULL WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Product-split DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: process.env.E2E_DATABASE_SSL === "disable" ? false : "require", onnotice: () => {},
      types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Product Split Test FCU', 'credit_union', 'ncua', 'IL')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${NEW}, ${INST}, 'success', ${PAGE}, 'h-new', '2026-11-01T00:00:00Z'),
                     (${OLD}, ${INST}, 'success', ${PAGE}, 'h-old', '2026-05-01T00:00:00Z')`;
    await raw`UPDATE source_documents SET superseded_by_id = ${NEW} WHERE id = ${OLD}`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${NEW}, ${INST}, ${PAGE}, 'html', 'completed', ${TEXT}, 't-3110', ${TEXT.length})`;
    // Live: the older copy's reads under no product; the current copy's re-read of the minimum balance line.
    await seed("oldMin", OLD, "minimum_balance", "Minimum Balance Fee", 0, null, MIN);
    await seed("newMin", NEW, "minimum_balance", "Minimum Balance Fee", 0, "Savings/Checking Accounts", MIN);
    await seed("oldMonthly", OLD, "monthly_maintenance", "Monthly Fee", 0, null, MONTHLY);
    await seed("oldTen", OLD, "monthly_maintenance", "Monthly Maintenance Service Charge", 10, "PERFORMANCE PLUS CHECKING", TEN);
    await seed("newTen", NEW, "monthly_maintenance", "Monthly Maintenance Service Charge", 10, null, TEN);
    // About to publish: the current copy's re-read of the monthly fee line.
    await rawRow("candidate", NEW, "Monthly Fee", 0, "Savings/Checking Accounts", MONTHLY);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    await raw.end();
  });

  it("pairs one line under two products across copies, and leaves the line printed twice", async () => {
    const rows = (await raw.unsafe(PRODUCT_SPLIT_ROWS_SQL, [INST, 100])) as unknown as ProductSplitPairRow[];
    expect(rows.map((row) => [Number(row.older_id), Number(row.newer_id)])).toEqual([[ids.oldMin, ids.newMin], [ids.oldTen, ids.newTen]]);
    const { texts } = await productSplitPairs(raw as unknown as Parameters<typeof productSplitPairs>[0], { institutionId: INST });
    const found = findProductSplits(rows, texts);
    expect(found.matches.map((match) => [match.feePublishedId, match.keptFeePublishedId])).toEqual([[ids.oldMin, ids.newMin]]);
  });

  it("names the live row a re-read repeats under another product, and whose product wins", async () => {
    const db = raw as unknown as Parameters<typeof selectProductSplitTwin>[0];
    const base = { institutionId: INST, variantType: null, frequency: "monthly", sourceDocumentId: NEW, documentUrl: PAGE, sourceUrl: PAGE,
      documentStream: null, documentCrawledAt: "2026-11-01T00:00:00Z" };
    const found = await selectProductSplitTwin(db, { ...base, feeRawId: rawIds.candidate, canonicalFeeKey: "monthly_maintenance", amount: 0, productName: "Savings/Checking Accounts" });
    expect(found.state === "available" && found.value ? [Number(found.value.prior.fee_published_id), found.value.winner, Boolean(found.value.prior.published_state)] : found)
      .toEqual([ids.oldMonthly, "read", true]);
    // Another amount is another fee.
    expect(await selectProductSplitTwin(db, { ...base, feeRawId: rawIds.candidate, canonicalFeeKey: "monthly_maintenance", amount: 5, productName: "Savings/Checking Accounts" }))
      .toEqual({ state: "available", value: null });
  });

  it("switched on, archives the older row on its second look as a same-line duplicate behind the re-read", async () => {
    const db = raw as unknown as Parameters<typeof recheckProductSplits>[0];
    try {
      const report = await recheckProductSplits(db, { runId: 3110901, dryRun: false, institutionId: INST });
      expect(report).toMatchObject({ live: false, matched: 1, flagged: 0, takenDown: [] });
      const first = await recheckProductSplits(db, { runId: 3110902, dryRun: false, institutionId: INST, live: true, now: new Date("2026-11-03T00:00:00Z") });
      expect(first).toMatchObject({ matched: 1, flagged: 1, takenDown: [] });
      const second = await recheckProductSplits(db, { runId: 3110903, dryRun: false, institutionId: INST, live: true, now: new Date("2026-11-03T13:00:00Z") });
      expect(second.takenDown).toEqual([ids.oldMin]);
      const [row] = await raw`SELECT rolled_back_reason FROM published_fee_records WHERE fee_published_id = ${ids.oldMin}`;
      expect(row.rolled_back_reason).toBe(`same_line_duplicate: live fee #${ids.newMin}`);
      const [kept] = await raw`SELECT rolled_back_at FROM published_fee_records WHERE fee_published_id = ${ids.newMin}`;
      expect(kept.rolled_back_at).toBeNull();
    } finally {
      await raw`DELETE FROM agent_run_events WHERE agent_run_id IN (3110901, 3110902, 3110903)`;
    }
  });
});
