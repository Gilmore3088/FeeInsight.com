/**
 * The same-line read check in real PostgreSQL (production schema, loopback only, #1876): Access FCU's
 * doc prints "- $30.00 charge for each one-time debit overdraft." once, read twice (a deterministic
 * read with no frequency and a paid read per item), beside its own ATM overdraft line at $30. A line
 * a second document prints twice stays two fees. Publish's read names the live read a new row repeats.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { namesShareReading } from "@/lib/agents/hamilton/publish";
import { selectSameLineReadOf } from "@/lib/agents/hamilton/same-line-read";
import { secondLookDedupeKey } from "@/lib/agents/hamilton/second-look";
import { SAME_LINE_READ_CHECK, SAME_LINE_READ_ROWS_SQL, findSameLineReads, recheckSameLineReads, type SameLineReadRow } from "./same-line-read-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 1876001;
const DOC = 1876101;
const TWICE = 1876102;
const EVENT = "00000000-0000-4000-8000-000001876000";

const ATM = "- $30.00 charge for each ATM overdraft.";
const DEBIT = "- $30.00 charge for each one-time debit overdraft.";
const NSF = "- Nonsufficient funds fee of $30.00 per submission/resubmission of an item.";

describe.skipIf(!connection)("same-line reads in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let nextRaw = 1876200;
  const ids: Record<string, number> = {};
  const rawIds: Record<string, number> = {};

  async function rawRow(label: string, documentId: number, name: string, frequency: string | null, line: string): Promise<number> {
    const rawId = nextRaw++;
    const note = `Knox deterministic extraction from Rosetta artifact #1. canonical_hint=overdraft; excerpt="${line}"`;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source, extraction_note)
              VALUES (${rawId}, ${INST}, ${documentId}, ${EVENT}, ${name}, 30, ${frequency}, 'knox', ${note})`;
    rawIds[label] = rawId;
    return rawId;
  }

  async function seed(label: string, documentId: number, key: string, name: string, frequency: string | null, line: string): Promise<void> {
    const rawId = await rawRow(label, documentId, name, frequency, line);
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, 30, ${frequency}, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, 30, ${frequency}, 'agentic-run-1876', 'https://access.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id IN (${DOC}, ${TWICE})`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Same-line read DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Same Line Test FCU', 'credit_union', 'ncua', 'PA')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://access.test/disclosure.pdf', 'h1', NOW()),
                     (${TWICE}, ${INST}, 'success', 'https://access.test/other.pdf', 'h2', NOW())`;
    const body = `a. ATM fees.\n${ATM}\nb. Debit card fees.\n${NSF}\n${DEBIT}\nc. Atlas fees.`;
    const twice = `Personal:\n${DEBIT}\nBusiness:\n${DEBIT}`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${DOC}, ${INST}, 'https://access.test/disclosure.pdf', 'pdf', 'completed', ${body}, 't-1876a', ${body.length}),
                     (${TWICE}, ${INST}, 'https://access.test/other.pdf', 'pdf', 'completed', ${twice}, 't-1876b', ${twice.length})`;
    await seed("atm", DOC, "overdraft", "charge for each ATM overdraft", "per_item", ATM);
    await seed("debit", DOC, "overdraft", "charge for each one-time debit overdraft", null, DEBIT);
    await seed("debitPaid", DOC, "overdraft", "One-time debit overdraft charge", "per_item", DEBIT);
    await seed("twiceA", TWICE, "overdraft", "charge for each one-time debit overdraft", null, DEBIT);
    await seed("twiceB", TWICE, "overdraft", "One-time debit overdraft charge", "per_item", DEBIT);
    await rawRow("candidate", DOC, "Debit overdraft charge (one-time)", "per_item", DEBIT);
    await rawRow("atmCandidate", DOC, "ATM overdraft charge", "per_item", ATM);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    await raw.end();
  });

  it("reads the one line printed once as one fee, and leaves the line printed twice", async () => {
    const rows = (await raw.unsafe(SAME_LINE_READ_ROWS_SQL, [INST, 100])) as unknown as SameLineReadRow[];
    expect(rows.map((row) => Number(row.fee_published_id))).toEqual([ids.debit, ids.debitPaid, ids.twiceA, ids.twiceB]);
    expect(rows.map((row) => Number(row.line_prints))).toEqual([1, 1, 2, 2]);
    expect(rows[0].excerpt).toBe(DEBIT.toLowerCase());
    const found = findSameLineReads(rows);
    expect(found.matches.map((match) => [match.feePublishedId, match.keptFeePublishedId])).toEqual([[ids.debit, ids.debitPaid]]);
  });

  it("names the live read a row about to publish repeats; another line's row repeats nothing", async () => {
    const db = raw as unknown as Parameters<typeof selectSameLineReadOf>[0];
    const base = { institutionId: INST, canonicalFeeKey: "overdraft", variantType: null, amount: 30, feeAudience: "unknown", frequency: "per_item" };
    expect(await selectSameLineReadOf(db, { ...base, feeRawId: rawIds.candidate, feeName: "Debit overdraft charge (one-time)" }, namesShareReading))
      .toEqual({ state: "available", value: ids.debit });
    expect(await selectSameLineReadOf(db, { ...base, feeRawId: rawIds.atmCandidate, feeName: "ATM overdraft charge" }, namesShareReading))
      .toEqual({ state: "available", value: ids.atm });
    expect(await selectSameLineReadOf(db, { ...base, feeRawId: rawIds.candidate, feeName: "Debit overdraft charge (one-time)", amount: 25 }, namesShareReading))
      .toEqual({ state: "available", value: null });
  });

  it("a full read clears a pending flag whose fee it no longer returns; a read at its row cap clears nothing (#1876)", async () => {
    const stale = secondLookDedupeKey(SAME_LINE_READ_CHECK, ids.atm);
    const evidence = { flag_run_id: 1876900, flagged_at: "2026-10-26T13:00:00.000Z", reason: `same_line_duplicate: live fee #${ids.debitPaid}` };
    const pendingRow = async () => {
      await raw`DELETE FROM pipeline_feedback WHERE check_name = ${SAME_LINE_READ_CHECK} AND institution_id = ${INST}`;
      await raw`DELETE FROM pipeline_feedback WHERE check_name = ${SAME_LINE_READ_CHECK} AND fee_published_id = ANY(${Object.values(ids)}::bigint[])`;
      await raw`INSERT INTO pipeline_feedback (about_stage, about_strategy, signal, kind, reported_by, check_name, institution_id, fee_published_id, weight, evidence, agent_run_id, dedupe_key)
                VALUES ('publish', ${SAME_LINE_READ_CHECK}, 'wrong', 'takedown_pending', 'gutenberg', ${SAME_LINE_READ_CHECK}, ${INST}, ${ids.atm}, 0, ${JSON.stringify(evidence)}::jsonb, 1876900, ${stale})`;
    };
    const kind = async () => String((await raw`SELECT kind FROM pipeline_feedback WHERE dedupe_key = ${stale}`)[0].kind);
    const db = raw as unknown as Parameters<typeof recheckSameLineReads>[0];
    const now = new Date("2026-10-27T03:00:00Z");
    try {
      // The ATM line is read once, so the read never returns it: only a full read can clear its flag.
      await pendingRow();
      const capped = await recheckSameLineReads(db, { runId: 1876901, dryRun: false, institutionId: INST, live: true, limit: 2, now });
      expect(capped.flagged).toBe(1);
      expect(capped.cleared).toBe(0);
      expect(await kind()).toBe("takedown_pending");
      const full = await recheckSameLineReads(db, { runId: 1876902, dryRun: false, institutionId: INST, live: true, now });
      // The match stays under its first look (same minute), confirming exactly as before.
      expect(full.waiting).toBe(1);
      expect(full.takenDown).toEqual([]);
      expect(full.cleared).toBe(1);
      expect(await kind()).toBe("takedown_cleared");
    } finally {
      await raw`DELETE FROM pipeline_feedback WHERE check_name = ${SAME_LINE_READ_CHECK} AND fee_published_id = ANY(${Object.values(ids)}::bigint[])`;
      await raw`DELETE FROM agent_run_events WHERE agent_run_id IN (1876901, 1876902)`;
    }
  });
});
