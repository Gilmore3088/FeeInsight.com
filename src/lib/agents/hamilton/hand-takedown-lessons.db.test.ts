/** #1677: hand takedown lessons charged to the step that erred, against real SQL in loopback-only temporary tables. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { applyHandTakedowns, HAND_TAKEDOWNS, type HandTakedown } from "./hand-takedowns";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof applyHandTakedowns>[0];

// Shaped like #1671's 42961 (charged to the document by HAND_TAKEDOWN_LESSON_OVERRIDES) and
// #1659's 15727 (a misread, Knox's), at test ids.
const base1671 = HAND_TAKEDOWNS.find((entry) => entry.feePublishedId === 42961)!;
const base1659 = HAND_TAKEDOWNS.find((entry) => entry.feePublishedId === 15727)!;
const BUSINESS: HandTakedown = { ...base1671, feePublishedId: 1 };
const MISREAD: HandTakedown = { ...base1659, feePublishedId: 2 };
const LIST = [BUSINESS, MISREAD];

describe.skipIf(!connection)("Hand takedown lessons in isolated PostgreSQL (#1677)", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Hand takedown tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigint PRIMARY KEY, lineage_ref bigint,
      institution_id bigint, canonical_fee_key text, fee_name text, amount numeric, rolled_back_at timestamptz,
      rolled_back_reason text, rolled_back_by_batch_id text)`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigint PRIMARY KEY, institution_id bigint,
      review_status text, outlier_flags jsonb)`;
    await db`CREATE TEMP TABLE pipeline_feedback (id bigserial PRIMARY KEY, about_stage text, about_strategy text,
      about_version integer, about_attempt_id bigint, signal text, kind text, reported_by text, check_name text,
      institution_id bigint, source_document_id bigint, source_url text, fee_raw_id bigint, fee_verified_id bigint,
      fee_published_id bigint, canonical_fee_key text, amount numeric, weight numeric, evidence jsonb,
      agent_run_id bigint, dedupe_key text UNIQUE, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW())`;
    await db`CREATE TEMP TABLE agent_run_events (agent_run_id bigint, step_id bigint, event_type text, status text,
      message text, detail jsonb)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE published_fee_records, verified_fee_observations, pipeline_feedback, agent_run_events`;
    for (const [index, entry] of LIST.entries()) {
      await db`INSERT INTO verified_fee_observations VALUES (${100 + index}, ${entry.institutionId}, 'verified', '[]')`;
      await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id, canonical_fee_key, fee_name, amount)
        VALUES (${entry.feePublishedId}, ${100 + index}, ${entry.institutionId}, ${entry.canonicalFeeKey}, ${entry.feeName}, ${entry.amount})`;
    }
  });

  const run = (runId: number) => applyHandTakedowns(db as unknown as Db, { runId, batchId: `run-${runId}`, dryRun: false, list: LIST, waiting: [], returnsLive: false });
  const lessons = () => db<Array<{ fee_published_id: number; about_stage: string; kind: string; weight: number; dedupe_key: string }>>`
    SELECT fee_published_id::int, about_stage, kind, weight, dedupe_key FROM pipeline_feedback ORDER BY fee_published_id`;

  it("charges a wrong page to discover and a misread to extract, once per fee", async () => {
    const first = await run(1);
    expect(first.error).toBeNull();
    expect(first.takenDown.map((item) => item.feePublishedId)).toEqual([1, 2]);
    expect(await lessons()).toEqual([
      { fee_published_id: 1, about_stage: "discover", kind: "wrong_document", weight: 1, dedupe_key: "hamilton.hand_takedown:pub:1" },
      { fee_published_id: 2, about_stage: "extract", kind: "wrong_category", weight: 1, dedupe_key: "hamilton.hand_takedown:pub:2" },
    ]);

    // A later run finds both down and writes nothing.
    const again = await run(2);
    expect(again.takenDown).toEqual([]);
    expect(await lessons()).toHaveLength(2);

    // Brought back and taken down again: the same row is upserted, never a second lesson.
    await db`UPDATE published_fee_records SET rolled_back_at = NULL`;
    await db`UPDATE verified_fee_observations SET review_status = 'verified'`;
    expect((await run(3)).takenDown).toHaveLength(2);
    expect(await lessons()).toHaveLength(2);
  });

  it("leaves a lesson recorded before #1677 as it is once its fee is down", async () => {
    // As on prod for #1671: the fee is down and its row says extract / wrong_category.
    await db`UPDATE published_fee_records SET rolled_back_at = NOW(), rolled_back_reason = ${BUSINESS.reason} WHERE fee_published_id = 1`;
    await db`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, fee_published_id, weight, evidence, dedupe_key)
      VALUES ('extract', 'wrong', 'wrong_category', 'gutenberg', 'hamilton.hand_takedown', 1, 1, '{}', 'hamilton.hand_takedown:pub:1')`;
    const result = await run(4);
    expect(result.takenDown.map((item) => item.feePublishedId)).toEqual([2]);
    expect(result.skipped).toEqual([{ feePublishedId: 1, reason: "not live" }]);
    expect((await lessons()).map((row) => [row.fee_published_id, row.about_stage, row.kind])).toEqual([
      [1, "extract", "wrong_category"],
      [2, "extract", "wrong_category"],
    ]);

    // Brought back and taken down again: the old row moves to the stage charged now, kind and stage together.
    await db`UPDATE published_fee_records SET rolled_back_at = NULL, rolled_back_reason = NULL WHERE fee_published_id = 1`;
    expect((await run(5)).takenDown.map((item) => item.feePublishedId)).toEqual([1]);
    expect((await lessons()).map((row) => [row.fee_published_id, row.about_stage, row.kind])).toEqual([
      [1, "discover", "wrong_document"],
      [2, "extract", "wrong_category"],
    ]);
  });
});
