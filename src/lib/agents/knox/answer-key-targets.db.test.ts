/**
 * Real PostgreSQL check of Knox's answer-key targets on the goal scorecard (#1098): the newest
 * score run at the current scorer version, its per-bank Knox counts summed over the banks whose
 * right document Rosetta read, and the specialist rows stored with it. Loopback-only temporary
 * tables; nothing outside this session is touched.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { ANSWER_KEY_SCORER_VERSION } from "@/lib/data-store/answer-key";
import { readKnoxAnswerKey } from "../goal-scorecard";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof readKnoxAnswerKey>[0];

const bank = (id: number, rosettaRight: boolean, knox: { expected: number; matched: number; predicted: number; correct: number }) => ({
  institution_id: id,
  document_type: "html",
  stages: { magellan: { right: rosettaRight }, rosetta: { right: rosettaRight }, knox: { right: false, ...knox } },
});

describe.skipIf(!connection)("Knox's answer-key targets on the scorecard, in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Answer-key target tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE answer_key_score_runs (id bigserial PRIMARY KEY, scorer_version int NOT NULL, by_stage jsonb NOT NULL DEFAULT '{}'::jsonb,
      by_bank jsonb NOT NULL DEFAULT '[]'::jsonb, scored_at timestamptz NOT NULL)`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("says there is no score when none is stored", async () => {
    expect(await readKnoxAnswerKey(db as unknown as Db)).toMatchObject({
      query: "goal.knox_answer_key_right_document", scoreRunId: null, recall: null, precision: null, bySpecialist: null,
      eligibleBanks: null, confirmedBanks: null,
    });
  });

  it("sums the newest run's right-document banks and keeps its specialist rows", async () => {
    const run = (version: number, at: string, byStage: unknown, byBank: unknown) =>
      db`INSERT INTO answer_key_score_runs (scorer_version, by_stage, by_bank, scored_at)
         VALUES (${version}, ${JSON.stringify(byStage)}::jsonb, ${JSON.stringify(byBank)}::jsonb, ${at}::timestamptz) RETURNING id`;
    // An older run and a newer run at another scorer version: neither is read.
    await run(ANSWER_KEY_SCORER_VERSION, "2026-10-24T06:00:00Z", {}, [bank(1, true, { expected: 10, matched: 1, predicted: 1, correct: 1 })]);
    await run(ANSWER_KEY_SCORER_VERSION + 1, "2026-10-26T07:00:00Z", {}, [bank(1, true, { expected: 10, matched: 10, predicted: 10, correct: 10 })]);
    const [newest] = await run(ANSWER_KEY_SCORER_VERSION, "2026-10-26T06:00:00Z", {
      _reference: { state: "measured", confirmedBanks: 62, eligibleBanks: 2, excludedBanks: 60,
        byReason: { key_line_not_in_reference: 15, reference_source_superseded: 14, consumer_scope_unproven: 12, legacy_not_current: 2 } },
      _knox_specialists: { banks: 2, expected: 30, bySpecialist: [
        { strategy: "extract.rules", banks: 2, found: 20, foundOnly: 18, reads: 24, right: 21, precision: 0.875, shareOfKey: 0.6667 },
        { strategy: "extract.family.overdraft_nsf", banks: 1, found: 3, foundOnly: 1, reads: 3, right: 3, precision: 1, shareOfKey: 0.1 },
      ] },
    }, [
      bank(1, true, { expected: 20, matched: 17, predicted: 19, correct: 17 }),
      bank(2, true, { expected: 10, matched: 6, predicted: 7, correct: 6 }),
      // Rosetta did not read the right document: Magellan's or Rosetta's miss, not counted.
      bank(3, false, { expected: 15, matched: 0, predicted: 4, correct: 0 }),
      // No key fees: nothing to find.
      bank(4, true, { expected: 0, matched: 0, predicted: 2, correct: 0 }),
    ]);
    const score = await readKnoxAnswerKey(db as unknown as Db);
    expect(score).toMatchObject({
      scoreRunId: Number(newest.id),
      scoredAt: "2026-10-26T06:00:00.000Z",
      scorerVersion: ANSWER_KEY_SCORER_VERSION,
      referenceState: "measured",
      confirmedBanks: 62,
      eligibleBanks: 2,
      topExclusions: [
        { reason: "key_line_not_in_reference", count: 15 },
        { reason: "reference_source_superseded", count: 14 },
        { reason: "consumer_scope_unproven", count: 12 },
      ],
      banks: 2,
      expected: 30,
      found: 23,
      reads: 26,
      right: 23,
      recall: 0.7667,
      precision: 0.8846,
    });
    expect(score.bySpecialist?.map((row) => [row.strategy, row.found, row.right, row.precision])).toEqual([
      ["extract.rules", 20, 21, 0.875],
      ["extract.family.overdraft_nsf", 3, 3, 1],
    ]);
  });
});
