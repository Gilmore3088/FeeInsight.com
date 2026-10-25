/**
 * The feedback sync writes one takedown lesson per takedown cycle (#1648), in real PostgreSQL,
 * loopback only, against the production schema. Each case runs in a transaction that is rolled
 * back, so nothing it writes (including rows the sync writes for other suites' leftovers) stays.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { syncPipelineFeedback } from "./feedback-sync";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20164801;
const DOC = 20164802;
const EVENT = "00000000-0000-4000-8000-000016480001";
type Db = Parameters<typeof syncPipelineFeedback>[0];
type Raw = postgres.Sql<{ numeric: number; json: unknown; text: string }>;
type Tx = postgres.TransactionSql<{ numeric: number; json: unknown; text: string }>;

class Rollback extends Error {}

describe.skipIf(!connection)("feedback sync takedown cycles in isolated PostgreSQL (#1648)", () => {
  let raw: Raw;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Feedback sync DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
  });

  afterAll(async () => {
    if (raw) await raw.end();
  });

  /** Runs `work` in a transaction and always rolls it back. */
  async function rolledBack(work: (tx: Tx) => Promise<void>) {
    await raw.begin(async (tx) => {
      await work(tx);
      throw new Rollback();
    }).catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
  }

  async function fee(tx: Tx, rawId: number): Promise<number> {
    await tx`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
             VALUES (${rawId}, ${INST}, ${DOC}, ${EVENT}, 'Stop Payment', 30, 'per_item', 'knox')`;
    const [verified] = await tx`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
             VALUES (${rawId}, ${INST}, 'stop_payment', ${EVENT}, 'Stop Payment', 30, 'per_item', 'verified') RETURNING fee_verified_id`;
    const [published] = await tx`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
             VALUES (${verified.fee_verified_id}, ${INST}, 'stop_payment', ${EVENT}, 'Stop Payment', 30, 'per_item', 'test-1648', 'https://bank1648.test/fees')
             RETURNING fee_published_id`;
    return Number(published.fee_published_id);
  }

  const takeDown = (tx: Tx, id: number, at: string, reason: string) =>
    tx`UPDATE published_fee_records SET rolled_back_at = ${at}::timestamptz, rolled_back_reason = ${reason} WHERE fee_published_id = ${id}`;
  const restore = (tx: Tx, id: number) =>
    tx`UPDATE published_fee_records SET rolled_back_at = NULL, rolled_back_reason = NULL WHERE fee_published_id = ${id}`;
  // The transaction's NOW() never moves, so each cycle's rows are dated back to keep their order.
  const age = (tx: Tx, id: number, hours: number) =>
    tx`UPDATE pipeline_feedback SET created_at = NOW() - make_interval(hours => ${hours}::int)
        WHERE fee_published_id = ${id} AND created_at = NOW()`;
  const sync = (tx: Tx, runId: number) => syncPipelineFeedback(tx as unknown as Db, { runId, limit: 5000 });
  const keys = async (tx: Tx, id: number) =>
    (await tx<{ dedupe_key: string }[]>`SELECT dedupe_key FROM pipeline_feedback WHERE fee_published_id = ${id} ORDER BY dedupe_key`)
      .map((row) => row.dedupe_key);
  const ms = (at: string) => new Date(at).getTime();

  it("takedown, restore, takedown writes two takedown lessons, and a re-run writes none", async () => {
    await rolledBack(async (tx) => {
      const id = await fee(tx, 20164810);
      const first = "2026-10-01T00:00:00Z";
      const second = "2026-10-10T12:30:00.123Z";

      await takeDown(tx, id, first, "category_guard:stop_payment");
      await sync(tx, 164801);
      expect(await keys(tx, id)).toEqual([`hamilton.takedown:pub:${id}:extract`, `hamilton.takedown:pub:${id}:verify`]);
      await age(tx, id, 5);

      await restore(tx, id);
      await sync(tx, 164802);
      expect(await keys(tx, id)).toContain(`hamilton.restore:pub:${id}`);
      await age(tx, id, 4);

      await takeDown(tx, id, second, "source_check_untraceable:amount_not_the_fee");
      await sync(tx, 164803);
      const cycle = `hamilton.takedown:pub:${id}:at:${ms(second)}`;
      expect(await keys(tx, id)).toEqual([
        `hamilton.restore:pub:${id}`,
        `${cycle}:extract`,
        `${cycle}:verify`,
        `hamilton.takedown:pub:${id}:extract`,
        `hamilton.takedown:pub:${id}:verify`,
      ]);
      const [lesson] = await tx<{ kind: string; reason: string }[]>`
        SELECT kind, evidence->>'reason' AS reason FROM pipeline_feedback WHERE dedupe_key = ${`${cycle}:extract`}`;
      expect(lesson).toEqual({ kind: "wrong_amount", reason: "source_check_untraceable:amount_not_the_fee" });

      // A re-run, and a re-run by another step, add nothing for the same takedown.
      const before = await keys(tx, id);
      await sync(tx, 164804);
      await age(tx, id, 3);
      await sync(tx, 164805);
      expect(await keys(tx, id)).toEqual(before);

      // The second cycle's restore is logged too, as its own row.
      await restore(tx, id);
      await sync(tx, 164806);
      expect(await keys(tx, id)).toContain(`hamilton.restore:pub:${id}:run:164806`);
      const [restored] = await tx<{ taken_down_for: string }[]>`
        SELECT evidence->>'taken_down_for' AS taken_down_for FROM pipeline_feedback WHERE dedupe_key = ${`hamilton.restore:pub:${id}:run:164806`}`;
      expect(restored.taken_down_for).toBe("source_check_untraceable:amount_not_the_fee");
      const settled = await keys(tx, id);
      await sync(tx, 164807);
      expect(await keys(tx, id)).toEqual(settled);
    });
  });

  it("a real takedown after an account type hold's row still teaches", async () => {
    await rolledBack(async (tx) => {
      const id = await fee(tx, 20164820);
      // The sync's row from the first hold step (#1100), at weight 0 after #1637's repair.
      await tx`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, fee_published_id, weight, dedupe_key, created_at)
               VALUES ('extract', 'wrong', 'account_type_hold', 'gutenberg', 'hamilton.account_type_hold', ${INST}, ${id}, 0,
                       ${`hamilton.takedown:pub:${id}:extract`}, NOW() - interval '9 days')`;
      const at = "2026-10-20T08:00:00Z";
      await takeDown(tx, id, at, "category_guard:stop_payment");
      await sync(tx, 164811);
      const cycle = `hamilton.takedown:pub:${id}:at:${ms(at)}`;
      expect(await keys(tx, id)).toEqual([`${cycle}:extract`, `${cycle}:verify`, `hamilton.takedown:pub:${id}:extract`]);
      const [hold] = await tx<{ kind: string; weight: number }[]>`
        SELECT kind, weight FROM pipeline_feedback WHERE dedupe_key = ${`hamilton.takedown:pub:${id}:extract`}`;
      expect(hold).toEqual({ kind: "account_type_hold", weight: 0 });
    });
  });
});
