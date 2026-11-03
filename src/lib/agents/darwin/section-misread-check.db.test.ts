/**
 * The section misread re-check's read in real PostgreSQL (production schema, loopback only). The review of Knox v182
 * found version 5's read was invalid SQL (a missing comma) that `recheckSectionMisreads` swallowed, so its dry run
 * reported nothing: this file runs the real `sectionMisreadRowsSql` and the whole step (dry run) on seeded live fees,
 * so a read that does not parse or plan fails here. Lines as printed: Ameris Bank text 1338, a box late fee, the page
 * live #133756 was read from, TXN Bank text 10944 and Parthenon FCU text 5186.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { recheckSectionMisreads, sectionMisreadRowsSql } from "./section-misread-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 1982001;
const EVENT = "00000000-0000-4000-8000-000001982000";
const TEXTS: Record<string, { id: number; text: string }> = {
  wire: { id: 1982301, text: "Account Activity/Statement Print Out | $5.00 | Online Wire Monthly Maintenance Fee | $25.00" },
  box: { id: 1982302, text: "Safe Deposit Boxes\nBox Late Fee | $20.00" },
  freeNsf: { id: 1982303, text: "Returned Check | $20\nOverdraft Transfer | $2.50\nInsufficient Funds (NSF) | $0" },
  txn: { id: 1982304, text: "NSF | $30.00\nReturn Items | $10.00\nCharge Backs | $10/Item" },
  parthenon: { id: 1982305, text: "NSF Fee- | $33.00/item\nReturned Item Fee- | $30.00/item\nDeposited Item Return Fee- | $25.00/item" },
  plain: { id: 1982306, text: "Stop payment for a single item | $20.00" },
};

describe.skipIf(!connection)("section misread re-check read in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let nextRaw = 1982200;
  const ids: Record<string, number> = {};

  async function seed(label: string, text: keyof typeof TEXTS, key: string, name: string, amount: number, line: string): Promise<void> {
    const rawId = nextRaw++;
    const note = `knox read artifact #${TEXTS[text].id}; excerpt="${line}"`;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, source, extraction_note)
              VALUES (${rawId}, ${INST}, ${TEXTS[text].id}, ${EVENT}, ${name}, ${amount}, 'knox', ${note})`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status)
              VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'agentic-run-1982', 'https://bank.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Section misread DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Section Misread Test Bank', 'bank', 'fdic', 'TX')`;
    // One text per document: each text's id is its document's id too.
    for (const [label, { id, text }] of Object.entries(TEXTS)) {
      await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
                VALUES (${id}, ${INST}, 'success', ${`https://bank.test/${label}`}, ${`h-1982-${label}`}, NOW())`;
      await raw`INSERT INTO agent_source_texts (id, source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
                VALUES (${id}, ${id}, ${INST}, ${`https://bank.test/${label}`}, 'html', 'completed', ${text}, ${`t-1982-${label}`}, ${text.length})`;
    }
    await seed("wire", "wire", "monthly_maintenance", "Online Wire Monthly Maintenance Fee", 25, "Online Wire Monthly Maintenance Fee | $25.00");
    await seed("box", "box", "late_payment", "Box Late Fee", 20, "Box Late Fee | $20.00");
    await seed("returnedCheck", "freeNsf", "nsf", "Returned Check", 20, "Returned Check | $20");
    await seed("freeNsf", "freeNsf", "nsf", "Insufficient Funds (NSF)", 0, "Insufficient Funds (NSF) | $0");
    await seed("txnReturn", "txn", "nsf", "Return Items", 10, "Return Items | $10.00");
    await seed("txnNsf", "txn", "nsf", "NSF", 30, "NSF | $30.00");
    await seed("txnChargeBack", "txn", "deposited_item_return", "Charge Backs", 10, "Charge Backs | $10/Item");
    await seed("parthenonReturn", "parthenon", "nsf", "Returned Item Fee", 30, "Returned Item Fee- | $30.00/item");
    await seed("parthenonNsf", "parthenon", "nsf", "NSF Fee", 33, "NSF Fee- | $33.00/item");
    await seed("parthenonDeposited", "parthenon", "deposited_item_return", "Deposited Item Return Fee", 25, "Deposited Item Return Fee- | $25.00/item");
    await seed("stop", "plain", "stop_payment", "Stop payment for a single item", 20, "Stop payment for a single item | $20.00");
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    await raw.end();
  });

  it("the read parses, selects the version 5 candidates and gathers each plain return's text siblings", async () => {
    const rows = await sectionMisreadRowsSql(raw as never, { institutionId: INST });
    const picked = new Map(rows.map((row) => [Number(row.fee_published_id), row]));
    for (const label of ["wire", "box", "returnedCheck", "freeNsf", "txnReturn", "parthenonReturn"]) expect(picked.has(ids[label]), label).toBe(true);
    for (const label of ["stop", "txnChargeBack", "parthenonDeposited"]) expect(picked.has(ids[label]), label).toBe(false);
    const siblings = (picked.get(ids.txnReturn)?.siblings ?? []).map((sibling) => `${sibling.canonical_fee_key} ${sibling.fee_name} ${Number(sibling.amount)}`).sort();
    // The fee itself rides along (left out in findSectionMisreads); the other text's fees never do.
    expect(siblings).toEqual(["deposited_item_return Charge Backs 10", "nsf NSF 30", "nsf Return Items 10"]);
    expect(picked.get(ids.wire)?.siblings ?? null).toBeNull();
    expect(Number(picked.get(ids.box)?.artifact_id)).toBe(TEXTS.box.id);
  });

  it("a dry run reads the real query, finds the version 5 matches, and writes nothing", async () => {
    const result = await recheckSectionMisreads(raw as never, { runId: 0, dryRun: true, institutionId: INST, live: true });
    expect(result.checked).toBeGreaterThan(0);
    expect(result.byKind).toMatchObject({ wire_service_monthly_fee: 1, read_name_review: 1, return_beside_nsf: 2 });
    expect(result.samples.map((fee) => fee.feePublishedId).sort((a, b) => a - b)).toEqual([ids.wire, ids.box, ids.returnedCheck, ids.txnReturn].sort((a, b) => a - b));
    expect(result.takenDown).toEqual([]);
    const [live] = await raw`SELECT count(*)::int AS n FROM published_fee_records WHERE institution_id = ${INST} AND rolled_back_at IS NULL`;
    expect(live.n).toBe(11);
  });
});
