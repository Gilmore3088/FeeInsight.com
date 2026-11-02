/**
 * Real PostgreSQL checks of the hold source re-read's replacement (Pipeline wiring audit gap 2):
 * Knox's real insert and ON CONFLICT, in a loopback-only, temporary-table connection.
 */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { insertCandidate, insertCandidateWithLearning, type KnoxTextRow } from "@/lib/agents/knox/extract";
import { emptyTakedownLessons } from "@/lib/agents/knox/takedown-lessons";
import { HOLD_REREAD_FLAG, HOLD_REREAD_REPLACED_FLAG, replaceHeldWithReread } from "./hold-source-reread";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof insertCandidate>[0];
type Candidate = Parameters<typeof insertCandidate>[1]["candidate"];

// Inst 6191's line (held raw 111826): held as a non-network ATM fee, read today as a card replacement.
const text = "Reinstatement of Account | $50\n\nReissue Lost/Stolen Visa ATM/Check Card | $15\n\nStop Payment (Check or ACH) | $32 per request";
const copy: KnoxTextRow = {
  document_text_id: 801,
  source_document_id: 10,
  institution_id: 6191,
  source_url: "https://bank.example/fees",
  normalized_text: text,
  text_hash: createHash("sha256").update(text).digest("hex"),
} as KnoxTextRow;
const reissue = {
  feeName: "Reissue Lost/Stolen Visa ATM/Check Card",
  amount: 15,
  canonicalHint: "atm_non_network",
  frequency: "per_item",
  confidence: 0.9,
  excerpt: "Reissue Lost/Stolen Visa ATM/Check Card | $15",
  waivable: false,
} as Candidate;
const stop = { ...reissue, feeName: "Stop Payment (Check or ACH)", amount: 320, canonicalHint: "stop_payment",
  excerpt: "Stop Payment (Check or ACH) | $32 per request" } as Candidate;

describe.skipIf(!connection)("hold source re-read replacement in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Hold re-read tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE raw_fee_observations (
      fee_raw_id bigserial PRIMARY KEY, institution_id bigint, source_document_id bigint, document_r2_key text,
      source_url text, extraction_confidence numeric, agent_event_id uuid, fee_name text, amount numeric,
      frequency text, conditions text, extraction_note text, outlier_flags jsonb, source text, product_name text,
      min_balance_to_avoid numeric, min_opening_deposit numeric, waiver_text text,
      fee_audience text NOT NULL DEFAULT 'unknown', audience_evidence text, fee_treatment text NOT NULL DEFAULT 'unknown',
      line_share text NOT NULL DEFAULT '')`;
    await db`CREATE UNIQUE INDEX ON raw_fee_observations
      (source_document_id, lower(fee_name), COALESCE(amount, '-1'::numeric), fee_audience, line_share)
      WHERE source = 'knox' AND source_document_id IS NOT NULL`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigserial PRIMARY KEY, fee_raw_id bigint)`;
    // Knox's insert names it in its lesson guard; empty, as no takedown lesson applies here.
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigserial PRIMARY KEY, rolled_back_at timestamptz, rolled_back_reason text)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => { await db`TRUNCATE raw_fee_observations, verified_fee_observations`; });

  /** A held row as Knox wrote it: read from the same copy, waiting for Darwin. */
  const hold = async (candidate: Candidate) => {
    expect(await insertCandidate(db as unknown as Db, { runId: 1, row: copy, candidate })).toBe(true);
    const [row] = await db`SELECT fee_raw_id FROM raw_fee_observations WHERE lower(fee_name) = lower(${candidate.feeName}) AND amount = ${candidate.amount}`;
    return Number(row.fee_raw_id);
  };
  const rows = async () => (await db`SELECT fee_raw_id, amount, outlier_flags FROM raw_fee_observations ORDER BY fee_raw_id`)
    .map((row) => ({ id: Number(row.fee_raw_id), amount: Number(row.amount), flags: row.outlier_flags as string[] }));
  const replace = (scope: unknown, feeRawId: number, candidate: Candidate) => replaceHeldWithReread(scope as Db, {
    feeRawId, runId: 2, row: copy, candidate, lessons: emptyTakedownLessons(),
  });

  it("an insert before the retire writes nothing for a recategorized read of the held row's own copy", async () => {
    // The order the review blocked: the held row still has needs_darwin_verification, so the ON CONFLICT does nothing.
    await hold(reissue);
    const receipt = await insertCandidateWithLearning(db as unknown as Db, { runId: 2, row: copy, candidate: { ...reissue, canonicalHint: "card_replacement" } }, emptyTakedownLessons());
    expect(receipt).toEqual({ inserted: false, takenDownBy: null, declinedReason: null });
  });

  it("re-keys a recategorized hold under today's category through Knox's take-over, and sends it to Darwin", async () => {
    const id = await hold(reissue);
    const written = await db.begin((tx) => replace(tx, id, { ...reissue, canonicalHint: "card_replacement" }));
    expect(written).toEqual({ result: "taken_over", note: "taken_over" });
    const [row, ...others] = await rows();
    expect(others).toEqual([]);
    expect(row.id).toBe(id);
    expect(row.flags).toContain("needs_darwin_verification");
    expect(row.flags).toContain("knox_reread_took_over");
    expect(row.flags).toContain("knox_takeover_from:atm_non_network");
    expect(row.flags).toContain(HOLD_REREAD_FLAG);
    expect(row.flags.filter((flag) => flag.startsWith("canonical_hint:"))).toEqual(["canonical_hint:card_replacement"]);
    expect(row.flags).not.toContain("superseded_by_reread");
    expect(row.flags).not.toContain(HOLD_REREAD_REPLACED_FLAG);
  });

  it("replaces a changed amount with a new raw row and retires the held one", async () => {
    const id = await hold(stop);
    const written = await db.begin((tx) => replace(tx, id, { ...stop, amount: 32 }));
    expect(written).toEqual({ result: "replaced", note: "inserted" });
    const [held, fresh] = await rows();
    expect(held.flags).toEqual(expect.arrayContaining(["superseded_by_reread", HOLD_REREAD_REPLACED_FLAG]));
    expect(held.flags).not.toContain("needs_darwin_verification");
    expect(fresh).toMatchObject({ amount: 32 });
    expect(fresh.flags).toEqual(expect.arrayContaining(["needs_darwin_verification", HOLD_REREAD_FLAG]));
  });

  it("calls a changed amount already read only when another row with its key is waiting for Darwin", async () => {
    const id = await hold(stop);
    const pending = await hold({ ...stop, amount: 32 });
    const written = await db.begin((tx) => replace(tx, id, { ...stop, amount: 32 }));
    expect(written).toEqual({ result: "already_read", note: `already_read:${pending}` });
    expect((await rows()).find((row) => row.id === id)?.flags).toContain(HOLD_REREAD_REPLACED_FLAG);
  });

  it("keeps the hold, rolled back, when Knox writes nothing and no live or pending row has the new key", async () => {
    const id = await hold(stop);
    // An existing row with the new key that is neither waiting for Darwin nor verified (judged and dropped).
    await db`INSERT INTO raw_fee_observations (institution_id, source_document_id, source, fee_name, amount, outlier_flags)
             VALUES (6191, 10, 'knox', ${stop.feeName}, 32, '["darwin_rejected"]'::jsonb)`;
    const before = await rows();
    const written = await db.begin((tx) => replace(tx, id, { ...stop, amount: 32 }));
    expect(written).toEqual({ result: "kept", note: "insert_no_row" });
    expect(await rows()).toEqual(before);
  });

  it("restores the hold without a savepoint too", async () => {
    const id = await hold(stop);
    await db`INSERT INTO raw_fee_observations (institution_id, source_document_id, source, fee_name, amount, outlier_flags)
             VALUES (6191, 10, 'knox', ${stop.feeName}, 32, '["darwin_rejected"]'::jsonb)`;
    const bare = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => db(strings, ...(values as never[])), { unsafe: db.unsafe });
    const written = await replace(bare, id, { ...stop, amount: 32 });
    expect(written.result).toBe("kept");
    const held = (await rows()).find((row) => row.id === id);
    expect(held?.flags).toContain("needs_darwin_verification");
    expect(held?.flags).not.toContain("superseded_by_reread");
  });
});
