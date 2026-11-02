/**
 * The account-benefit $0 check in real PostgreSQL (production schema, loopback only, #1397). One credit
 * union's rates page lists what its PremiumSpend Checking account's owners are provided ("free incoming
 * domestic wire transfers", "free Mobile Deposit"), and its schedule states "Incoming Wire Transfers |
 * Free" for everyone under its own heading. The check's SQL brings each live free-item $0 with windows of
 * the text Knox read; only the account's benefits match. Knox v156 holds the same free read as a range
 * instead of sending it to Darwin.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { ACCOUNT_BENEFIT_ZERO_HOLD_FLAG, insertHeldCandidate } from "@/lib/agents/knox/extract";
import { accountBenefitZeroRowsSql, recheckAccountBenefitZeros } from "./account-benefit-zero-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 1397001;
const DOC = 1397101;
const KNOX_DOC = 1397102;
const EVENT = "00000000-0000-4000-8000-000001397000";

const BENEFITS = "(6) PremiumSpend Checking Account owners are provided the following free services: free check writing, free incoming domestic wire transfers, free debit card, free Mobile Banking, free Mobile Deposit, free Bill Pay, free eStatements.";
const BODY = [
  "Checking Accounts",
  "(5) PremiumSpend Checking Account owners are provided access to approximately 32,000 fee-free nationwide ATMs.",
  "",
  BENEFITS,
  "",
  "Schedule of Fees",
  "Stop Payment | $25.00",
  "Incoming Wire Transfers | Free",
  "Outgoing Wire Transfers - Domestic | $20.00",
].join("\n");

describe.skipIf(!connection)("account-benefit $0 fees in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let textId = 0;
  let knoxTextId = 0;
  let nextRaw = 1397200;
  const ids: Record<string, number> = {};

  async function seed(label: string, key: string, name: string, excerpt: string, live = true): Promise<void> {
    const rawId = nextRaw++;
    const note = `Knox read a free fee from Rosetta artifact #${textId}. canonical_hint=${key}; text_hash=t-1397; excerpt="${excerpt}"`;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, source, extraction_note)
              VALUES (${rawId}, ${INST}, ${DOC}, ${EVENT}, ${name}, 0, 'knox', ${note})`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status)
              VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, 0, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, batch_id, source_url, rolled_back_at)
              VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, 0, 'agentic-run-1397', 'https://benefit.test/rates', ${live ? null : new Date()}) RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id IN (${DOC}, ${KNOX_DOC})`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Account-benefit $0 DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code)
              VALUES (${INST}, 'Benefit Test FCU', 'credit_union', 'ncua', 'CA')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://benefit.test/rates', 'h1', NOW()),
                     (${KNOX_DOC}, ${INST}, 'success', 'https://benefit.test/rates-2', 'h2', NOW())`;
    [{ id: textId }] = await raw<{ id: number }[]>`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${DOC}, ${INST}, 'https://benefit.test/rates', 'html', 'completed', ${BODY}, 't-1397', ${BODY.length}) RETURNING id`;
    [{ id: knoxTextId }] = await raw<{ id: number }[]>`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${KNOX_DOC}, ${INST}, 'https://benefit.test/rates-2', 'html', 'completed', ${BODY}, 't-1397b', ${BODY.length}) RETURNING id`;
    await seed("wire", "wire_domestic_incoming", "Incoming domestic wire transfers", "free incoming domestic wire transfers");
    await seed("mobile", "mobile_deposit", "Mobile Deposit", "free Mobile Deposit");
    await seed("schedule", "wire_domestic_incoming", "Incoming Wire Transfers", "Incoming Wire Transfers | Free");
    await seed("down", "bill_pay", "Bill Pay", "free Bill Pay", false);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    await raw.end();
  });

  it("brings each live free-item $0 with a window of the text Knox read", async () => {
    const db = raw as unknown as Parameters<typeof accountBenefitZeroRowsSql>[0];
    const rows = await accountBenefitZeroRowsSql(db, { institutionId: INST });
    // The schedule row's line is not a free item, and the rolled-back fee is not live.
    expect(rows.map((row) => Number(row.fee_published_id))).toEqual([ids.wire, ids.mobile]);
    const wire = rows.find((row) => Number(row.fee_published_id) === ids.wire)!;
    expect(wire.document_lines).toContain("PremiumSpend Checking Account owners are provided the following free services: free check writing, free incoming domestic wire transfers");
  });

  it("matches the account's benefits, and writes nothing on a dry run", async () => {
    const db = raw as unknown as Parameters<typeof recheckAccountBenefitZeros>[0];
    const result = await recheckAccountBenefitZeros(db, { runId: 1, dryRun: true, institutionId: INST, live: true });
    expect(result.checked).toBe(2);
    expect(result.samples.map((fee) => [fee.feePublishedId, fee.kind, fee.account])).toEqual([
      [ids.wire, "holder_grant", "PremiumSpend Checking Account"],
      [ids.mobile, "holder_grant", "PremiumSpend Checking Account"],
    ]);
    const [live] = await raw<{ live: number }[]>`SELECT COUNT(*)::int AS live FROM published_fee_records WHERE institution_id = ${INST} AND rolled_back_at IS NULL`;
    expect(live.live).toBe(3);
  });

  it("Knox v156 holds an account benefit's free read as a range, never for Darwin", async () => {
    const db = raw as unknown as Parameters<typeof insertHeldCandidate>[0];
    const row = { document_text_id: knoxTextId, source_document_id: KNOX_DOC, institution_id: INST, source_url: "https://benefit.test/rates-2", text_hash: "t-1397b", normalized_text: BODY };
    const held = (feeName: string, excerpt: string) => ({ shape: "zero" as const, feeName, amount: 0, amountMax: null, percent: null, frequency: null, canonicalHint: "wire_domestic_incoming", excerpt });
    await insertHeldCandidate(db, { runId: 1397, row, held: held("Incoming domestic wire transfers", "free incoming domestic wire transfers") });
    await insertHeldCandidate(db, { runId: 1397, row, held: held("Incoming Wire Transfers", "Incoming Wire Transfers | Free") });
    const written = await raw<{ fee_name: string; outlier_flags: string[] }[]>`
      SELECT fee_name, outlier_flags FROM raw_fee_observations WHERE source_document_id = ${KNOX_DOC} ORDER BY fee_name`;
    expect(written).toHaveLength(2);
    const flags = Object.fromEntries(written.map((entry) => [entry.fee_name, typeof entry.outlier_flags === "string" ? JSON.parse(entry.outlier_flags) : entry.outlier_flags]));
    expect(flags["Incoming domestic wire transfers"]).toEqual(expect.arrayContaining(["knox_review:range", `${ACCOUNT_BENEFIT_ZERO_HOLD_FLAG}:holder_grant`]));
    expect(flags["Incoming domestic wire transfers"]).not.toContain("needs_darwin_verification");
    expect(flags["Incoming Wire Transfers"]).toEqual(expect.arrayContaining(["knox_review:zero", "needs_darwin_verification"]));
  });
});
