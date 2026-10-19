/** Real PostgreSQL checks of Knox's re-read path (#1093) in a loopback-only, temporary-table connection. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { insertCandidate, retireRowsFromOlderText, type KnoxTextRow } from "./extract";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof insertCandidate>[0];

const firstRead: KnoxTextRow = {
  document_text_id: 701,
  source_document_id: 501,
  institution_id: 42,
  source_url: "https://testbank.example/fees",
  text_hash: "old-hash",
} as KnoxTextRow;
const reread: KnoxTextRow = { ...firstRead, document_text_id: 702, text_hash: "new-hash" } as KnoxTextRow;
const overdraft = {
  feeName: "Overdraft fee",
  amount: 35,
  canonicalHint: "overdraft",
  frequency: "per_item",
  confidence: 0.95,
  excerpt: "Overdraft fee $35.00 per item",
  waivable: false,
} as Parameters<typeof insertCandidate>[1]["candidate"];

describe.skipIf(!connection)("Knox re-read in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Knox re-read tests require a loopback E2E database; production connections are forbidden");
    }
    // The app's own type handling (connection.ts), so jsonb flags round-trip as they do in production.
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE raw_fee_observations (
      fee_raw_id bigserial PRIMARY KEY, institution_id bigint, source_document_id bigint, document_r2_key text,
      source_url text, extraction_confidence numeric, agent_event_id uuid, fee_name text, amount numeric,
      frequency text, conditions text, extraction_note text, outlier_flags jsonb, source text, product_name text,
      min_balance_to_avoid numeric, min_opening_deposit numeric, waiver_text text,
      fee_audience text NOT NULL DEFAULT 'unknown', audience_evidence text, fee_treatment text NOT NULL DEFAULT 'unknown')`;
    await db`CREATE UNIQUE INDEX ON raw_fee_observations
      (source_document_id, lower(fee_name), COALESCE(amount, '-1'::numeric), fee_audience)
      WHERE source = 'knox' AND source_document_id IS NOT NULL`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigserial PRIMARY KEY, fee_raw_id bigint)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => { await db`TRUNCATE raw_fee_observations, verified_fee_observations`; });

  const flagsOf = async () => (await db`SELECT outlier_flags, COALESCE(extraction_note, conditions) AS conditions FROM raw_fee_observations`)
    .map((row) => ({ flags: row.outlier_flags as string[], conditions: String(row.conditions) }));

  it("sends the same fee read again on a re-read back to Darwin instead of leaving it retired", async () => {
    expect(await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: overdraft })).toBe(true);
    expect(await retireRowsFromOlderText(db as unknown as Db, reread)).toBe(1);
    expect((await flagsOf())[0].flags).toContain("superseded_by_reread");

    expect(await insertCandidate(db as unknown as Db, { runId: 2, row: reread, candidate: overdraft })).toBe(true);
    const [row] = await flagsOf();
    expect(row.flags).toContain("needs_darwin_verification");
    expect(row.flags).toContain("knox_reread_took_over");
    expect(row.flags).not.toContain("superseded_by_reread");
    expect(row.conditions).toContain("text_hash=new-hash;");
  });

  it("files a re-read under today's category only, so Darwin does not judge it under the old one", async () => {
    // Peoples National Bank of Kewanee (document 4506): "NSF Return/Paid Item Fee for Chkg. & Sav | $25.00"
    // was read as nsf; today's rules read the same line as overdraft. Darwin reads the first
    // canonical_hint flag, so the old flag must not survive the take-over.
    const nsfLine = {
      ...overdraft,
      feeName: "NSF Return/Paid Item Fee for Chkg. & Sav",
      amount: 25,
      canonicalHint: "nsf",
      excerpt: "NSF Return/Paid Item Fee for Chkg. & Sav | $25.00",
    } as Parameters<typeof insertCandidate>[1]["candidate"];
    await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: nsfLine });
    await retireRowsFromOlderText(db as unknown as Db, reread);

    expect(await insertCandidate(db as unknown as Db, { runId: 2, row: reread, candidate: { ...nsfLine, canonicalHint: "overdraft" } })).toBe(true);
    const [row] = await flagsOf();
    expect(row.flags.filter((flag) => flag.startsWith("canonical_hint:"))).toEqual(["canonical_hint:overdraft"]);
    expect(row.flags).toContain("needs_darwin_verification");
    expect(row.flags).toContain("knox_reread_took_over");
    expect(row.conditions).toContain("canonical_hint=overdraft;");
    // #1295: the old category stays on the row as proof Darwin's earlier decision was under it.
    expect(row.flags).toContain("knox_takeover_from:nsf");
  });

  it("marks no category change when the take-over keeps the category (#1295)", async () => {
    await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: overdraft });
    await retireRowsFromOlderText(db as unknown as Db, reread);
    expect(await insertCandidate(db as unknown as Db, { runId: 2, row: reread, candidate: overdraft })).toBe(true);
    const [row] = await flagsOf();
    expect(row.flags).toContain("knox_reread_took_over");
    expect(row.flags.some((flag) => flag.startsWith("knox_takeover_from:"))).toBe(false);
  });

  it("leaves a retired row alone once Darwin has a verified row for it", async () => {
    await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: overdraft });
    await retireRowsFromOlderText(db as unknown as Db, reread);
    const [{ fee_raw_id: id }] = await db`SELECT fee_raw_id FROM raw_fee_observations`;
    await db`INSERT INTO verified_fee_observations (fee_raw_id) VALUES (${id})`;
    expect(await insertCandidate(db as unknown as Db, { runId: 2, row: reread, candidate: overdraft })).toBe(false);
    expect((await flagsOf())[0].flags).toContain("superseded_by_reread");
  });

  it("does not touch a live, unretired row read again from the same text", async () => {
    await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: overdraft });
    expect(await insertCandidate(db as unknown as Db, { runId: 2, row: firstRead, candidate: overdraft })).toBe(false);
    const [row] = await flagsOf();
    expect(row.flags).toContain("needs_darwin_verification");
    expect(row.flags).not.toContain("knox_reread_took_over");
  });
});
