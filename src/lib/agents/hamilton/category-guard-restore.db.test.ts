/** The category guard's restore against real SQL in loopback-only temporary tables (#1675). */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { restorePassingTakedowns } from "./category-guard";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof restorePassingTakedowns>[0];
const text = "Monthly Maintenance Fee | $10.00\nStop Payment | $30.00";
const HELD = "account_type_hold: savings (#1100)";

describe.skipIf(!connection)("Category guard restore in isolated PostgreSQL (#1675)", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Category guard restore tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE agent_source_texts (id bigint PRIMARY KEY, source_document_id bigint,
      status text, normalized_text text)`;
    await db`CREATE TEMP TABLE raw_fee_observations (fee_raw_id bigint PRIMARY KEY, source_document_id bigint,
      source text, fee_name text, amount numeric, extraction_note text, conditions text)`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigint PRIMARY KEY, fee_raw_id bigint,
      review_status text, canonical_fee_key text, outlier_flags jsonb)`;
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigint PRIMARY KEY, lineage_ref bigint,
      institution_id bigint, canonical_fee_key text, fee_name text, amount numeric,
      rolled_back_at timestamptz, rolled_back_reason text, rolled_back_by_batch_id text)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE agent_source_texts, raw_fee_observations, verified_fee_observations, published_fee_records`;
    await db`INSERT INTO agent_source_texts VALUES (1, 500, 'completed', ${text})`;
    await db`INSERT INTO raw_fee_observations VALUES
      (1, 500, 'knox', 'Monthly Maintenance Fee', 10, NULL, NULL),
      (2, 500, 'knox', 'Monthly Maintenance Fee', 10, NULL, NULL)`;
    await db`INSERT INTO verified_fee_observations VALUES
      (1001, 1, 'rejected', 'monthly_maintenance', '["category_guard:test"]'),
      (1002, 2, 'verified', 'monthly_maintenance', '[]')`;
    // Fee 1: an earlier category-guard takedown that traces on its own stored text today.
    await db`INSERT INTO published_fee_records VALUES
      (1, 1001, 42, 'monthly_maintenance', 'Monthly Maintenance Fee', 10, '2026-10-10', 'category_guard:test: old rule', 'b1')`;
  });

  const twin = (reason: string | null) => db`INSERT INTO published_fee_records VALUES
    (2, 1002, 42, 'monthly_maintenance', 'Monthly Maintenance Fee', 10,
     ${reason == null ? null : "2026-10-11"}::timestamptz, ${reason}, ${reason == null ? null : "b2"})`;
  const run = (dryRun = false) => restorePassingTakedowns(db as unknown as Db, { dryRun, institutionId: 42, runId: 1675 });
  const fee = async (id: number) => (await db`SELECT rolled_back_at, rolled_back_reason FROM published_fee_records WHERE fee_published_id = ${id}`)[0];
  const verified = async (id: number) => (await db`SELECT review_status, outlier_flags FROM verified_fee_observations WHERE fee_verified_id = ${id}`)[0];

  it("brings back a takedown with no twin, with its verified row", async () => {
    expect(await run()).toEqual({ restored: 1, refiled: 0 });
    expect(await fee(1)).toMatchObject({ rolled_back_at: null, rolled_back_reason: null });
    expect(await verified(1001)).toMatchObject({ review_status: "verified", outlier_flags: [] });
  });

  it("keeps a takedown down beside a live twin", async () => {
    await twin(null);
    expect(await run()).toEqual({ restored: 0, refiled: 0 });
    expect((await fee(1)).rolled_back_reason).toBe("category_guard:test: old rule");
  });

  it("keeps a takedown down beside a twin the account type hold took down", async () => {
    await twin(HELD);
    expect(await run()).toEqual({ restored: 0, refiled: 0 });
    expect((await fee(1)).rolled_back_reason).toBe("category_guard:test: old rule");
    expect(await verified(1001)).toMatchObject({ review_status: "rejected" });
    expect((await fee(2)).rolled_back_reason).toBe(HELD);
  });

  it("still brings a takedown back beside a twin closed for another reason", async () => {
    await twin("operator_closed");
    expect(await run()).toEqual({ restored: 1, refiled: 0 });
    expect(await fee(1)).toMatchObject({ rolled_back_at: null, rolled_back_reason: null });
  });

  it("does not count a held fee at another price as a twin", async () => {
    await twin(HELD);
    await db`UPDATE published_fee_records SET amount = 12 WHERE fee_published_id = 2`;
    expect(await run()).toEqual({ restored: 1, refiled: 0 });
  });
});
