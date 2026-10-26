/**
 * The account type hold's old release rows relabelled as restore records (#1680), and Darwin's
 * release review leaving a release out of its lessons by kind, in real PostgreSQL, loopback only,
 * against the production schema. Each case runs in a transaction that is rolled back.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { loadReviewLessons } from "@/lib/agents/darwin/release-review";
import { feedbackRow, type PlannedHold } from "@/lib/agents/hamilton/account-type-hold";
import { ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_CHECK, repairAccountTypeHoldFeedback } from "./account-type-hold-feedback";
import { recordFeedback } from "./feedback";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20168001;
const DOC = 20168002;
const EVENT = "00000000-0000-4000-8000-000016800001";
type Db = Parameters<typeof repairAccountTypeHoldFeedback>[0];
type Raw = postgres.Sql<{ numeric: number; json: unknown; text: string }>;
// postgres.js omits the tag call signature from TransactionSql, so a transaction is typed as the pool.
type Tx = Raw;

class Rollback extends Error {}

const hold = (feeVerifiedId: number, feePublishedId: number | null = null): PlannedHold => ({
  feePublishedId,
  feeVerifiedId,
  institutionId: INST,
  accountType: "business",
  feeName: "Business Checking Monthly Fee",
  productName: "Business Checking",
  amount: 20,
});

describe.skipIf(!connection)("account type hold release relabel in isolated PostgreSQL (#1680)", () => {
  let raw: Raw;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Account type hold feedback DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
  });

  afterAll(async () => {
    if (raw) await raw.end();
  });

  async function rolledBack(work: (tx: Tx) => Promise<void>) {
    await raw.begin(async (tx) => {
      await work(tx as unknown as Tx);
      throw new Rollback();
    }).catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
  }

  async function run(tx: Tx): Promise<number> {
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO agent_runs (agent_name, run_kind, status) VALUES ('gutenberg', 'manual_repair', 'running') RETURNING id`;
    return Number(row.id);
  }

  /** A release row as the hold wrote it before #2594: its takedown's label. */
  async function oldRelease(tx: Tx, feeVerifiedId: number, runId: number) {
    const row = feedbackRow(hold(feeVerifiedId), "restored", runId);
    await recordFeedback(tx as unknown as Db, [{ ...row, signal: "wrong", kind: "wrong_category" }]);
  }

  const label = async (tx: Tx, dedupeKey: string) => {
    const [row] = await tx<{ signal: string; kind: string; weight: number; evidence: string | Record<string, unknown> }[]>`
      SELECT signal, kind, weight, evidence FROM pipeline_feedback WHERE dedupe_key = ${dedupeKey}`;
    const evidence = typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence;
    return { signal: row.signal, kind: row.kind, weight: Number(row.weight), evidence: evidence as Record<string, unknown> };
  };

  it("relabels only the hold's old release rows, keeps the old label and is idempotent", async () => {
    await rolledBack(async (tx) => {
      const runId = await run(tx);
      await oldRelease(tx, 20168011, runId);
      await oldRelease(tx, 20168012, runId);
      // A live takedown keeps its wrong-category label, and a release written today is already right.
      await recordFeedback(tx as unknown as Db, [feedbackRow(hold(20168013, 20168113), "live", runId), feedbackRow(hold(20168014), "restored", runId)]);
      // Another check's row whose key sorts just past the hold's release range.
      await recordFeedback(tx as unknown as Db, [{
        ...feedbackRow(hold(20168015), "restored", runId),
        signal: "wrong", kind: "wrong_category", checkName: "hamilton.account_type_hold_other",
        dedupeKey: "hamilton.account_type_hold:restoredx:20168015",
      }]);
      const prior = await tx<{ due: number }[]>`
        SELECT COUNT(*)::int AS due FROM pipeline_feedback
         WHERE dedupe_key LIKE 'hamilton.account_type_hold:restored:%' AND signal = 'wrong' AND kind = 'wrong_category'
           AND institution_id IS DISTINCT FROM ${INST}`;
      const others = Number(prior[0].due);

      const dry = await repairAccountTypeHoldFeedback(tx as unknown as Db, { runId, dryRun: true });
      expect(dry.release).toEqual({ on: false, due: 2 + others, relabeled: 0 });
      expect((await label(tx, "hamilton.account_type_hold:restored:20168011")).signal).toBe("wrong");

      const off = await repairAccountTypeHoldFeedback(tx as unknown as Db, { runId, dryRun: false });
      expect(off.release).toEqual({ on: false, due: null, relabeled: 0 });

      const live = await repairAccountTypeHoldFeedback(tx as unknown as Db, { runId, dryRun: false, relabelOn: true });
      expect(live).toMatchObject({ error: null, release: { on: true, due: 2 + others, relabeled: 2 + others } });
      for (const id of [20168011, 20168012]) {
        const row = await label(tx, `hamilton.account_type_hold:restored:${id}`);
        expect(row).toMatchObject({ signal: "restored", kind: "account_type_hold_released", weight: 0 });
        expect(row.evidence).toMatchObject({
          relabeled_from: { signal: "wrong", kind: "wrong_category" },
          relabeled_by_run: runId,
          relabel_issue: 1680,
          part: "restored",
          issue: 1100,
        });
      }
      expect(await label(tx, "hamilton.account_type_hold:live:20168013")).toMatchObject({ signal: "wrong", kind: "wrong_category" });
      expect((await label(tx, "hamilton.account_type_hold:restored:20168014")).evidence).not.toHaveProperty("relabeled_from");
      expect(await label(tx, "hamilton.account_type_hold:restoredx:20168015")).toMatchObject({ signal: "wrong", kind: "wrong_category" });
      const [event] = await tx<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_CHECK}`;
      expect(Number(event.n)).toBe(1);

      const again = await repairAccountTypeHoldFeedback(tx as unknown as Db, { runId, dryRun: false, relabelOn: true });
      expect(again.release).toEqual({ on: true, due: 0, relabeled: 0 });
    });
  });

  it("Darwin's release review reads no lesson from a release, even one with a live published fee", async () => {
    await rolledBack(async (tx) => {
      const runId = await run(tx);
      const key = "monthly_maintenance";
      await tx`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
               VALUES (20168021, ${INST}, ${DOC}, ${EVENT}, 'Business Checking Monthly Fee', 20, 'monthly', 'knox')`;
      const [verified] = await tx<{ fee_verified_id: number }[]>`
        INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
        VALUES (20168021, ${INST}, ${key}, ${EVENT}, 'Business Checking Monthly Fee', 20, 'monthly', 'verified') RETURNING fee_verified_id`;
      const [published] = await tx<{ fee_published_id: number }[]>`
        INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
        VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, 'Business Checking Monthly Fee', 20, 'monthly', 'test-1680', 'https://bank1680.test/fees')
        RETURNING fee_published_id`;
      const before = (await loadReviewLessons(tx as unknown as Db, [key])).filter((lesson) => lesson.feeName === "Business Checking Monthly Fee");
      expect(before).toEqual([]);
      await recordFeedback(tx as unknown as Db, [
        feedbackRow(hold(Number(verified.fee_verified_id), Number(published.fee_published_id)), "restored", runId),
      ]);
      const after = (await loadReviewLessons(tx as unknown as Db, [key])).filter((lesson) => lesson.feeName === "Business Checking Monthly Fee");
      expect(after).toEqual([]);
      // Control: an ordinary restore of the same fee is a lesson, so the read itself works.
      await recordFeedback(tx as unknown as Db, [{
        aboutStage: "extract", signal: "restored", kind: "restored_after_takedown", reportedBy: "gutenberg", checkName: "hamilton.restore",
        institutionId: INST, feeVerifiedId: Number(verified.fee_verified_id), feePublishedId: Number(published.fee_published_id),
        canonicalFeeKey: key, amount: 20, runId, dedupeKey: `test1680:restore:${published.fee_published_id}`,
      }]);
      const control = (await loadReviewLessons(tx as unknown as Db, [key])).filter((lesson) => lesson.feeName === "Business Checking Monthly Fee");
      expect(control).toHaveLength(1);
    });
  });
});
