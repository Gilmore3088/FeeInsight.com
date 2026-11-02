/**
 * The superseded-copy re-check's reads and archive write in real PostgreSQL (loopback only, review of
 * #2906), on temporary tables that shadow the production ones for this connection:
 * - `staleCopyRowsSql` starts from superseded copies (cursor and limit first), follows the
 *   `superseded_by_id` chain to the newest copy, leaves out admin-corrected fees and the current
 *   copy's own fees, and reads the Knox versions once per copy (the current copy's on its latest text);
 * - `recheckStaleCopies` on a dry run lets one current-copy twin retire one old fee, not two;
 * - `archiveStaleCopies` retires a twin only while the fee it keeps is live with no takedown pending.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import {
  STALE_COPY_FLAG,
  archiveStaleCopies,
  currentRawRowsSql,
  currentTwinsSql,
  recheckStaleCopies,
  staleCopyRowsSql,
  type StaleCopyJudgement,
} from "./stale-copy-check";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof staleCopyRowsSql>[0];

// Citizens Savings Bank (IA, institution 3416), excerpt of its stored fee page text.
const CSB = `Account Research or Balancing- $25.00 per hour*-$25.00 minimum

Check Copies- $1.00 per check*

Dormant Account Fee- $3.00 per month (after 24 months of inactivity and applies to all accounts)

Stop Payment - all items- $15.00 per item*

Wire Transfer (incoming)- $10.00

Wire Transfer (outgoing - domestic)- $20.00

Overdraft Policy

All items returned for non-sufficient funds (NSF) will be charged $25.00 per presentment returned. An overdraft charge of $25.00 per presentment with a maximum of $125.00 per day.
`;

const INST = 3416;
const FEBRUARY = 1048; // superseded by MIDDLE
const MIDDLE = 2000; // superseded by CURRENT
const CURRENT = 38158;
const CORRECTED_ONLY = 1500; // superseded, only an admin-corrected live fee
const OTHER = 900; // another bank's page, never superseded

describe.skipIf(!connection)("superseded-copy re-check in isolated PostgreSQL (review of #2906)", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  const sql = () => db as unknown as Db;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Stale copy DB tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE source_documents (id bigint PRIMARY KEY, institution_id bigint, superseded_by_id bigint)`;
    await db`CREATE TEMP TABLE agent_source_texts (id bigserial PRIMARY KEY, source_document_id bigint, status text, normalized_text text, text_hash text)`;
    await db`CREATE TEMP TABLE pipeline_attempts (id bigserial PRIMARY KEY, source_document_id bigint, stage text, strategy text,
      strategy_version integer, input_fingerprint text)`;
    await db`CREATE TEMP TABLE raw_fee_observations (fee_raw_id bigint PRIMARY KEY, source_document_id bigint, source text,
      fee_name text, amount numeric, product_name text)`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigint PRIMARY KEY, fee_raw_id bigint, review_status text, outlier_flags jsonb)`;
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigint PRIMARY KEY, lineage_ref bigint, institution_id bigint,
      canonical_fee_key text, fee_name text, amount numeric, amount_kind text DEFAULT 'flat', fee_audience text,
      rolled_back_at timestamptz, rolled_back_by_batch_id text, rolled_back_reason text, quarantined_at timestamptz)`;
    await db`CREATE TEMP TABLE published_fee_corrections (fee_published_id bigint, status text)`;
    await db`CREATE TEMP TABLE pipeline_feedback (fee_published_id bigint, kind text)`;
    await db`CREATE TEMP TABLE agent_run_events (id bigserial PRIMARY KEY, agent_run_id bigint, step_id bigint, event_type text,
      status text, message text, detail jsonb, created_at timestamptz DEFAULT NOW())`;
  });
  afterAll(async () => { if (db) await db.end(); });

  async function fee(id: number, documentId: number, key: string, name: string, amount: number, institutionId = INST): Promise<void> {
    await db`INSERT INTO raw_fee_observations VALUES (${id}, ${documentId}, 'knox', ${name}, ${amount}, NULL)`;
    await db`INSERT INTO verified_fee_observations VALUES (${id}, ${id}, 'verified', '[]'::jsonb)`;
    await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id, canonical_fee_key, fee_name, amount)
             VALUES (${id}, ${id}, ${institutionId}, ${key}, ${name}, ${amount})`;
  }

  beforeEach(async () => {
    await db`TRUNCATE source_documents, agent_source_texts, pipeline_attempts, raw_fee_observations, verified_fee_observations,
      published_fee_records, published_fee_corrections, pipeline_feedback, agent_run_events`;
    await db`INSERT INTO source_documents VALUES (${FEBRUARY}, ${INST}, ${MIDDLE}), (${MIDDLE}, ${INST}, ${CURRENT}), (${CURRENT}, ${INST}, NULL),
                                                 (${CORRECTED_ONLY}, ${INST}, ${CURRENT}), (${OTHER}, 77, NULL)`;
    // The current copy's text was re-captured: its read version is the one on the latest text's hash.
    await db`INSERT INTO agent_source_texts (source_document_id, status, normalized_text, text_hash)
             VALUES (${FEBRUARY}, 'completed', ${CSB}, 'feb'), (${CURRENT}, 'completed', 'An older capture', 'cur-old'),
                    (${CURRENT}, 'completed', ${CSB}, 'cur')`;
    await db`INSERT INTO pipeline_attempts (source_document_id, stage, strategy, strategy_version, input_fingerprint)
             VALUES (${FEBRUARY}, 'extract', 'extract.rules', 150, 'feb'),
                    (${CURRENT}, 'extract', 'extract.rules', 157, 'cur'),
                    (${CURRENT}, 'extract', 'extract.rules', 160, 'cur-old'),
                    (${CURRENT}, 'extract', 'extract.llm', 170, 'cur')`;
    // Two live February reads of the overdraft line and one live current-copy read of it.
    await fee(12449, FEBRUARY, "overdraft", "Overdraft Fee", 25);
    await fee(12450, FEBRUARY, "overdraft", "Overdraft charge", 25);
    await fee(12451, FEBRUARY, "wire_domestic_incoming", "Wire Transfer (incoming)", 10);
    await fee(16570, CURRENT, "overdraft", "Overdraft charge", 25);
    await fee(16571, CURRENT, "wire_domestic_incoming", "Wire Transfer (incoming)", 10);
    await fee(15000, CORRECTED_ONLY, "stop_payment", "Stop Payment - all items", 15);
    await db`INSERT INTO published_fee_corrections VALUES (15000, 'current')`;
    await fee(9000, OTHER, "overdraft", "Overdraft Fee", 30, 77);
  });

  it("reads superseded copies' live fees against the newest copy, with versions per copy", async () => {
    const rows = await staleCopyRowsSql(sql(), { institutionId: INST });
    expect(rows.map((row) => Number(row.fee_published_id))).toEqual([12449, 12450, 12451]);
    for (const row of rows) {
      expect(Number(row.older_document_id)).toBe(FEBRUARY);
      expect(Number(row.current_document_id)).toBe(CURRENT);
      expect(Number(row.fee_read_version)).toBe(150);
      // 160 read an older capture and the LLM pass is another strategy: the current text's rules read is v157.
      expect(Number(row.current_read_version)).toBe(157);
    }
  });

  it("pages by superseded copy after the cursor, skipping copies with no uncorrected live fee", async () => {
    expect((await staleCopyRowsSql(sql(), { afterId: FEBRUARY })).length).toBe(0);
    const first = await staleCopyRowsSql(sql(), { limit: 1 });
    expect([...new Set(first.map((row) => Number(row.older_document_id)))]).toEqual([FEBRUARY]);
  });

  it("reads the current copy's live fees and Knox rows", async () => {
    const twins = await currentTwinsSql(sql(), [{ currentDocumentId: CURRENT, institutionId: INST }]);
    expect(twins.map((row) => Number(row.fee_published_id)).sort()).toEqual([16570, 16571]);
    const raw = await currentRawRowsSql(sql(), [CURRENT]);
    expect(raw.map((row) => row.fee_name).sort()).toEqual(["Overdraft charge", "Wire Transfer (incoming)"]);
  });

  it("a dry run lets one twin retire one old fee and writes nothing", async () => {
    const result = await recheckStaleCopies(sql(), { runId: 1, dryRun: true, institutionId: INST, live: true, knoxVersion: 157 });
    expect(result.checked).toBe(3);
    expect(result.byVerdict.twin).toBe(2);
    expect(result.matched).toBe(2);
    const kept = result.samples.filter((sample) => sample.verdict === "twin").map((sample) => sample.keptFeePublishedId).sort();
    expect(kept).toEqual([16570, 16571]);
    const [live] = await db`SELECT count(*)::int AS n FROM published_fee_records WHERE rolled_back_at IS NULL`;
    expect(live.n).toBe(7);
    const [events] = await db`SELECT count(*)::int AS n FROM agent_run_events`;
    expect(events.n).toBe(0);
  });

  it("archives a twin only while the fee it keeps is live with no takedown pending", async () => {
    const twin: StaleCopyJudgement = {
      feePublishedId: 12449, feeVerifiedId: 12449, institutionId: INST, sourceDocumentId: FEBRUARY, currentDocumentId: CURRENT,
      canonicalFeeKey: "overdraft", feeName: "Overdraft Fee", amount: 25, verdict: "twin", keptFeePublishedId: 16570,
      currentLine: null, reason: "stale_copy_twin: kept #16570 (#1048 -> #38158)",
    };
    // Another check has the kept fee under a pending takedown: both must not come down.
    await db`INSERT INTO pipeline_feedback VALUES (16570, 'takedown_pending')`;
    expect(await archiveStaleCopies(sql(), 7, [twin])).toEqual([]);
    await db`UPDATE pipeline_feedback SET kind = 'takedown_cleared'`;
    await db`UPDATE published_fee_records SET rolled_back_at = NOW() WHERE fee_published_id = 16570`;
    expect(await archiveStaleCopies(sql(), 7, [twin])).toEqual([]);
    await db`UPDATE published_fee_records SET rolled_back_at = NULL WHERE fee_published_id = 16570`;
    expect(await archiveStaleCopies(sql(), 7, [twin])).toEqual([12449]);
    const [archived] = await db`SELECT rolled_back_by_batch_id, rolled_back_reason FROM published_fee_records WHERE fee_published_id = 12449`;
    expect(archived.rolled_back_by_batch_id).toBe("darwin-stale-copy-7");
    expect(archived.rolled_back_reason).toBe(twin.reason);
    const [verified] = await db`SELECT review_status, outlier_flags::text AS flags FROM verified_fee_observations WHERE fee_verified_id = 12449`;
    expect(verified.review_status).toBe("rejected");
    expect(JSON.parse(String(verified.flags))).toEqual([STALE_COPY_FLAG]);
  });
});
