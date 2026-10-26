/**
 * The banded $0 check in real PostgreSQL (production schema, loopback only, #1882). One credit union's
 * schedule prints a Safety Net overdraft priced by negative balance in one cell, a Courtesy Pay row
 * for a small negative balance at "N/C" with its priced row below, a stated "No-Fee Overdraft | Free",
 * and a consumer "No Fee" NSF beside a business price. The check's SQL brings each fee's line and the
 * line after it from the text Knox read; only the two band reads match. Knox v122 holds the same free
 * read as a range instead of sending it to Darwin.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { BANDED_ZERO_HOLD_FLAG, insertHeldCandidate } from "@/lib/agents/knox/extract";
import { bandedZeroRowsSql, recheckBandedZeros } from "./banded-zero-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 1882001;
const OTHER = 1882002;
const DOC = 1882101;
const OTHER_DOC = 1882102;
const KNOX_DOC = 1882103;
const EVENT = "00000000-0000-4000-8000-000001882000";

const SAFETY = "Safety Net Overdraft | $0 if the negative balance is $5 or less. $10 if the negative balance is $5.01 to $20. $35 per item** if negative balance is $20.01 or greater.";
const COURTESY = "Item paid in overdraft fee (Courtesy Pay) | N/C | Early account closed fee (within 6 months) | 25.00";
const STATED = "No-Fee Overdraft | Free";
const CONSUMER_NSF = "Non-Sufficient Funds Fee (Returned Item) | No Fee | 6.";
const BODY = [
  "Personal Fee Schedule",
  SAFETY,
  "Non-Sufficient Funds (NSF) | $35 per item/per presentment**",
  COURTESY,
  "Negative account balance $0-$9.99 | Medallion Signature guarantee, members | 5.00",
  "Item paid in overdraft fee (Courtesy Pay) | up to 19.00 | Money order | 3.00",
  "Negative account balance $10.00 or more",
  STATED,
  "CONSUMER ACCOUNTS",
  CONSUMER_NSF,
  "NON-CONSUMER ACCOUNTS",
  "Non-Sufficient Funds Fee (Returned Item) $36.00 Each | Early Closure Fee | $25.00 per Account",
].join("\n");

describe.skipIf(!connection)("banded $0 overdraft fees in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let textId = 0;
  let otherTextId = 0;
  let knoxTextId = 0;
  let nextRaw = 1882200;
  const ids: Record<string, number> = {};

  async function seed(label: string, institution: number, documentId: number, artifact: number, key: string, name: string, line: string, live = true): Promise<void> {
    const rawId = nextRaw++;
    const note = `Knox read a free fee from Rosetta artifact #${artifact}. canonical_hint=${key}; text_hash=t-1882; excerpt="${line.slice(0, 180)}"`;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, source, extraction_note)
              VALUES (${rawId}, ${institution}, ${documentId}, ${EVENT}, ${name}, 0, 'knox', ${note})`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status)
              VALUES (${rawId}, ${institution}, ${key}, ${EVENT}, ${name}, 0, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, batch_id, source_url, rolled_back_at)
              VALUES (${verified.fee_verified_id}, ${institution}, ${key}, ${EVENT}, ${name}, 0, 'agentic-run-1882', 'https://band.test/', ${live ? null : new Date()}) RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM published_fee_records WHERE institution_id IN (${INST}, ${OTHER})`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id IN (${INST}, ${OTHER})`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id IN (${INST}, ${OTHER})`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id IN (${DOC}, ${OTHER_DOC}, ${KNOX_DOC})`;
    await raw`DELETE FROM source_documents WHERE institution_id IN (${INST}, ${OTHER})`;
    await raw`DELETE FROM institution_sources WHERE id IN (${INST}, ${OTHER})`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Banded $0 DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code)
              VALUES (${INST}, 'Band Test FCU', 'credit_union', 'ncua', 'MN'), (${OTHER}, 'Other Band FCU', 'credit_union', 'ncua', 'MN')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://band.test/fees.pdf', 'h1', NOW()),
                     (${OTHER_DOC}, ${OTHER}, 'success', 'https://other.test/fees.pdf', 'h2', NOW()),
                     (${KNOX_DOC}, ${OTHER}, 'success', 'https://other.test/schedule.pdf', 'h3', NOW())`;
    [{ id: textId }] = await raw<{ id: number }[]>`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${DOC}, ${INST}, 'https://band.test/fees.pdf', 'pdf', 'completed', ${BODY}, 't-1882', ${BODY.length}) RETURNING id`;
    [{ id: otherTextId }] = await raw<{ id: number }[]>`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${OTHER_DOC}, ${OTHER}, 'https://other.test/fees.pdf', 'pdf', 'completed', ${SAFETY}, 't-1882b', ${SAFETY.length}) RETURNING id`;
    [{ id: knoxTextId }] = await raw<{ id: number }[]>`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${KNOX_DOC}, ${OTHER}, 'https://other.test/schedule.pdf', 'pdf', 'completed', ${BODY}, 't-1882c', ${BODY.length}) RETURNING id`;
    await seed("safety", INST, DOC, textId, "overdraft", "Safety Net Overdraft", SAFETY);
    await seed("courtesy", INST, DOC, textId, "overdraft", "Item paid in overdraft fee (Courtesy Pay)", COURTESY);
    await seed("stated", INST, DOC, textId, "overdraft", "No-Fee Overdraft", STATED);
    await seed("consumerNsf", INST, DOC, textId, "nsf", "Non-Sufficient Funds Fee (Returned Item)", CONSUMER_NSF);
    await seed("down", INST, DOC, textId, "overdraft", "Safety Net Overdraft (old)", SAFETY, false);
    await seed("other", OTHER, OTHER_DOC, otherTextId, "overdraft", "Safety Net Overdraft", SAFETY);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    await raw.end();
  });

  it("brings each live $0's lines from the text Knox read, with the line after each", async () => {
    const db = raw as unknown as Parameters<typeof bandedZeroRowsSql>[0];
    const rows = await bandedZeroRowsSql(db, { institutionId: INST });
    expect(rows.map((row) => Number(row.fee_published_id))).toEqual([ids.safety, ids.courtesy, ids.stated, ids.consumerNsf]);
    const courtesy = rows.find((row) => Number(row.fee_published_id) === ids.courtesy)!;
    expect(courtesy.document_lines).toBe([
      COURTESY,
      "Negative account balance $0-$9.99 | Medallion Signature guarantee, members | 5.00",
      "Item paid in overdraft fee (Courtesy Pay) | up to 19.00 | Money order | 3.00",
      "Negative account balance $10.00 or more",
    ].join("\n"));
  });

  it("matches only the band reads, and writes nothing on a dry run", async () => {
    const db = raw as unknown as Parameters<typeof recheckBandedZeros>[0];
    const result = await recheckBandedZeros(db, { runId: 1, dryRun: true, institutionId: INST });
    expect(result.live).toBe(false);
    expect(result.checked).toBe(4);
    expect(result.samples.map((fee) => [fee.feePublishedId, fee.kind, fee.price])).toEqual([
      [ids.safety, "own_cell", 35],
      [ids.courtesy, "priced_twin_row", 19],
    ]);
    const [live] = await raw<{ live: number }[]>`SELECT COUNT(*)::int AS live FROM published_fee_records WHERE institution_id = ${INST} AND rolled_back_at IS NULL`;
    expect(live.live).toBe(4);
    const all = await recheckBandedZeros(db, { runId: 1, dryRun: true });
    expect(all.samples.map((fee) => fee.feePublishedId)).toEqual(expect.arrayContaining([ids.safety, ids.courtesy, ids.other]));
  });

  it("Knox v122 holds the band's free read as a range, never for Darwin", async () => {
    const db = raw as unknown as Parameters<typeof insertHeldCandidate>[0];
    const row = { document_text_id: knoxTextId, source_document_id: KNOX_DOC, institution_id: OTHER, source_url: "https://other.test/schedule.pdf", text_hash: "t-1882c", normalized_text: BODY };
    const held = (feeName: string, excerpt: string) => ({ shape: "zero" as const, feeName, amount: 0, amountMax: null, percent: null, frequency: null, canonicalHint: "overdraft", excerpt });
    await insertHeldCandidate(db, { runId: 1882, row, held: held("Item paid in overdraft fee (Courtesy Pay)", COURTESY) });
    await insertHeldCandidate(db, { runId: 1882, row, held: held("No-Fee Overdraft", STATED) });
    const written = await raw<{ fee_name: string; outlier_flags: string[] }[]>`
      SELECT fee_name, outlier_flags FROM raw_fee_observations WHERE source_document_id = ${KNOX_DOC} ORDER BY fee_name`;
    expect(written).toHaveLength(2);
    const flags = Object.fromEntries(written.map((entry) => [entry.fee_name, typeof entry.outlier_flags === "string" ? JSON.parse(entry.outlier_flags) : entry.outlier_flags]));
    expect(flags["Item paid in overdraft fee (Courtesy Pay)"]).toEqual(expect.arrayContaining(["knox_review:range", `${BANDED_ZERO_HOLD_FLAG}:priced_twin_row`]));
    expect(flags["Item paid in overdraft fee (Courtesy Pay)"]).not.toContain("needs_darwin_verification");
    expect(flags["No-Fee Overdraft"]).toEqual(expect.arrayContaining(["knox_review:zero", "needs_darwin_verification"]));
  });
});
