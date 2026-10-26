/**
 * The loan section re-check's reads in real PostgreSQL (production schema, loopback only, #1905):
 * the step's document read (`loanSectionDocumentsSql`) and the whole-table dry-run mirror
 * (`loanSectionFeesSql`) select the same deposit-category fees printed in a loan section, and nothing
 * else: the account's own NSF, a loan category, a stop payment and a text with no loan word stay out.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { findLoanSectionFees, loanSectionDocumentsSql, loanSectionFeesSql, recheckLoanSections } from "./loan-section-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 1905001;
const SCHEDULE = 1905101;
const PLAIN = 1905102;
const EVENT = "00000000-0000-4000-8000-000001905000";

const SCHEDULE_TEXT = [
  "Checking Fees",
  "",
  "Fee | Amount",
  "",
  "Non-sufficient funds/NSF (item returned unpaid) | $25.00",
  "",
  "Stop payment for a single item | $20.00",
  "",
  "Equity Loan",
  "",
  "Fee | Amount",
  "",
  "Home Equity Line Check returned (due to non-sufficient funds) | $29.00",
  "",
  "Returned loan payment | $29.00",
  "",
  "Stop payment of Home Equity Line check | $20.00",
  "",
  "Tax Service Charge | $25.00",
].join("\n");
// The same rows with no loan word anywhere in the text: never read.
const PLAIN_TEXT = ["Other Services", "Fee | Amount", "Tax Service Charge | $25.00"].join("\n");

describe.skipIf(!connection)("loan section re-check in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let nextRaw = 1905200;
  const ids: Record<string, number> = {};

  async function seed(label: string, documentId: number, key: string, name: string, amount: number): Promise<void> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, source)
              VALUES (${rawId}, ${INST}, ${documentId}, ${EVENT}, ${name}, ${amount}, 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status)
              VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'agentic-run-1905', 'https://bank.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id IN (${SCHEDULE}, ${PLAIN})`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Loan section DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Loan Section Test CU', 'credit_union', 'ncua', 'VA')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${SCHEDULE}, ${INST}, 'success', 'https://bank.test/membership/fees-and-charges.html', 'h1', NOW()),
                     (${PLAIN}, ${INST}, 'success', 'https://bank.test/other-fees.html', 'h2', NOW())`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${SCHEDULE}, ${INST}, 'https://bank.test/membership/fees-and-charges.html', 'html', 'completed', ${SCHEDULE_TEXT}, 't-1905-a', ${SCHEDULE_TEXT.length}),
                     (${PLAIN}, ${INST}, 'https://bank.test/other-fees.html', 'html', 'completed', ${PLAIN_TEXT}, 't-1905-b', ${PLAIN_TEXT.length})`;
    await seed("returnedCheck", SCHEDULE, "nsf", "Home Equity Line Check returned (due to non-sufficient funds)", 29);
    await seed("tax", SCHEDULE, "monthly_maintenance", "Tax Service Charge", 25);
    await seed("accountNsf", SCHEDULE, "nsf", "Non-sufficient funds/NSF (item returned unpaid)", 25);
    await seed("loanReturn", SCHEDULE, "other_lending_fee", "Returned loan payment", 29);
    await seed("helocStop", SCHEDULE, "stop_payment", "Stop payment of Home Equity Line check", 20);
    await seed("plainTax", PLAIN, "monthly_maintenance", "Tax Service Charge", 25);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    await raw.end();
  });

  it("reads the step's documents and finds only the loan section's deposit-category fees", async () => {
    const documents = await loanSectionDocumentsSql(raw as never, { institutionId: INST });
    expect(documents.map((document) => Number(document.source_document_id))).toEqual([SCHEDULE]);
    const found = findLoanSectionFees(documents);
    expect(found.matches.map((match) => match.feePublishedId)).toEqual([ids.returnedCheck, ids.tax].sort((a, b) => a - b));
    // Only deposit categories are read: the loan's own fee and the stop payment are not loaded.
    expect(found.checked).toBe(3);
  });

  it("pages by document id after the cursor", async () => {
    const after = await loanSectionDocumentsSql(raw as never, { afterId: SCHEDULE, limit: 10 });
    expect(after.some((document) => Number(document.source_document_id) === SCHEDULE)).toBe(false);
  });

  it("the whole-table dry-run mirror selects the same fees", async () => {
    const rows = (await raw.unsafe(loanSectionFeesSql({ fromDocumentId: SCHEDULE, toDocumentId: PLAIN }))) as unknown as Array<{ fee_published_id: number; heading: string }>;
    expect(rows.map((row) => Number(row.fee_published_id))).toEqual([ids.returnedCheck, ids.tax].sort((a, b) => a - b));
    expect(new Set(rows.map((row) => row.heading))).toEqual(new Set(["Equity Loan"]));
  });

  it("a dry run writes nothing and takes nothing down", async () => {
    const result = await recheckLoanSections(raw as never, { runId: 0, dryRun: true, institutionId: INST, live: true });
    expect(result.matched).toBe(2);
    expect(result.takenDown).toEqual([]);
    const [live] = await raw`SELECT count(*)::int AS n FROM published_fee_records WHERE institution_id = ${INST} AND rolled_back_at IS NULL`;
    expect(live.n).toBe(6);
  });
});
