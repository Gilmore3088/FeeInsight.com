/** Retirement identity and hold boundaries against real SQL in loopback-only temporary tables. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { newerCopyFingerprint, retireFeesDroppedFromNewerCopy } from "./newer-copy-retire";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof retireFeesDroppedFromNewerCopy>[0];
const olderText = "Overdraft Fee | $32.00\nStop Payment | $30.00\nCoin Counting | $5.00";
const newerText = "Overdraft Fee | $32.00\nStop Payment | $30.00\nPaper Statement | $5.00";

describe.skipIf(!connection)("Newer-copy retirement in isolated PostgreSQL (#2117/#2118/#2121)", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Retirement tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, state_code text)`;
    await db`CREATE TEMP TABLE source_documents (id bigint PRIMARY KEY, institution_id bigint, document_url text,
      crawled_at timestamptz, status text, content_hash text)`;
    await db`CREATE TEMP TABLE agent_source_texts (id bigint PRIMARY KEY, source_document_id bigint,
      status text, normalized_text text, text_hash text)`;
    await db`CREATE TEMP TABLE raw_fee_observations (fee_raw_id bigint PRIMARY KEY, institution_id bigint,
      source_document_id bigint, fee_name text, amount numeric, fee_audience text, frequency text,
      amount_kind text, rate_basis text, product_name text)`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigint PRIMARY KEY, fee_raw_id bigint,
      review_status text, outlier_flags jsonb)`;
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigint PRIMARY KEY, lineage_ref bigint,
      institution_id bigint, canonical_fee_key text, fee_name text, amount numeric, fee_audience text,
      frequency text, amount_kind text, rate_basis text, rate_percent numeric, rate_min_amount numeric,
      rate_max_amount numeric, variant_type text, quarantined_at timestamptz, rolled_back_at timestamptz,
      rolled_back_reason text, rolled_back_by_batch_id text)`;
    await db`CREATE TEMP TABLE pipeline_attempts (institution_id bigint, source_document_id bigint, stage text,
      strategy text, strategy_version int, input_fingerprint text, outcome text, yield_count int,
      cost_microusd bigint, duration_ms int, agent_run_id bigint, agent_run_step_id bigint, detail jsonb)`;
    await db`CREATE TEMP TABLE agent_run_events (agent_run_id bigint, event_type text, status text, message text, detail jsonb)`;
    await db`CREATE TEMP TABLE institution_source_profiles (institution_id bigint, format text,
      best_strategy jsonb, strategy_stats jsonb, do_not_retry jsonb, expected_fee_count int,
      cost_to_date_microusd bigint, last_learned_at timestamptz)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE institution_sources, source_documents, agent_source_texts, raw_fee_observations,
      verified_fee_observations, published_fee_records, pipeline_attempts, agent_run_events, institution_source_profiles`;
    await db`INSERT INTO institution_sources VALUES (42, 'TX')`;
    await db`INSERT INTO source_documents VALUES
      (500, 42, 'https://testbank.example/fees', '2026-10-01', 'success', 'old-bytes'),
      (900, 42, 'https://testbank.example/fees', '2026-10-02', 'success', 'new-bytes')`;
    await db`INSERT INTO agent_source_texts VALUES
      (1, 500, 'completed', ${olderText}, 'old-text'), (2, 900, 'completed', ${newerText}, 'new-text')`;
    await db`INSERT INTO raw_fee_observations VALUES
      (1, 42, 500, 'Overdraft Fee', 32, 'consumer', 'per_item', 'flat', NULL, NULL),
      (2, 42, 500, 'Stop Payment', 30, 'consumer', 'per_item', 'flat', NULL, NULL),
      (4, 42, 500, 'Coin Counting', 5, 'consumer', 'per_item', 'flat', NULL, 'Basic Checking'),
      (901, 42, 900, 'Paper Statement', 5, 'consumer', 'per_item', 'flat', NULL, 'Basic Checking')`;
    await db`INSERT INTO verified_fee_observations VALUES
      (1001, 1, 'verified', '[]'), (1002, 2, 'approved', '[]'), (1004, 4, 'verified', '[]')`;
    await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id,
      canonical_fee_key, fee_name, amount, fee_audience, frequency, amount_kind)
      VALUES (1, 1001, 42, 'overdraft', 'Overdraft Fee', 32, 'consumer', 'per_item', 'flat'),
      (2, 1002, 42, 'stop_payment', 'Stop Payment', 30, 'consumer', 'per_item', 'flat'),
      (4, 1004, 42, 'coin_counting', 'Coin Counting', 5, 'consumer', 'per_item', 'flat')`;
  });

  const run = (dryRun = false, suppliedDb: Db = db as unknown as Db) => retireFeesDroppedFromNewerCopy(suppliedDb,
    { runId: 9, batchId: "test-run-9", dryRun, live: true });
  async function states() {
    return {
      published: await db`SELECT * FROM published_fee_records ORDER BY fee_published_id`,
      verified: await db`SELECT * FROM verified_fee_observations ORDER BY fee_verified_id`,
    };
  }
  // Commit an interstatement change after candidates and texts were read, before the guarded write.
  function changeAfterSelection(change: () => Promise<unknown>): Db {
    return (async (strings: TemplateStringsArray, ...values: postgres.ParameterOrJSON<never>[]) => {
      const result = await db(strings, ...values);
      if (strings.join(" ").includes("ORDER BY source_document_id, id DESC")) await change();
      return result;
    }) as unknown as Db;
  }
  const row = async (id = 4) => (await db`SELECT * FROM published_fee_records WHERE fee_published_id = ${id}`)[0];
  const verified = async (id = 1004) => (await db`SELECT review_status, outlier_flags FROM verified_fee_observations WHERE fee_verified_id = ${id}`)[0];
  const attempt = async () => (await db`SELECT outcome, detail FROM pipeline_attempts WHERE strategy = 'hamilton.newer_copy_check'`)[0];

  it("retires a disappeared fee beside an unrelated equal-priced current fee, and dry run writes nothing", async () => {
    const before = await states();
    expect((await run(true)).retired.map((fee) => Number(fee.fee_published_id))).toEqual([4]);
    expect(await states()).toEqual(before);
    expect(await db`SELECT 1 FROM pipeline_attempts`).toHaveLength(0);
    expect(await db`SELECT 1 FROM agent_run_events`).toHaveLength(0);
    expect((await run()).retired.map((fee) => Number(fee.fee_published_id))).toEqual([4]);
    expect((await row()).rolled_back_reason).toBe("newer_copy_drops_fee:#900");
    expect(await verified()).toEqual({ review_status: "rejected", outlier_flags: ["newer_copy_drops_fee"] });
    expect(await attempt()).toMatchObject({ outcome: "ok_partial", detail: { planned_retired: 1, retired: 1 } });
  });

  it("accepts a positive normalized same-identity witness independently of its amount", async () => {
    await db`UPDATE raw_fee_observations SET fee_name = 'Coin-counting!', amount = 99 WHERE fee_raw_id = 901`;
    expect(await run()).toMatchObject({ documentsChecked: 1, stillNamed: 1, retired: [] });
    expect((await row()).rolled_back_at).toBeNull();
    expect((await verified()).review_status).toBe("verified");
  });

  it.each(["audience", "frequency", "amount_kind", "product", "institution"])(
    "does not borrow a same-name witness with a different %s", async (difference) => {
      await db`UPDATE raw_fee_observations SET fee_name = 'Coin Counting' WHERE fee_raw_id = 901`;
      if (difference === "audience") await db`UPDATE raw_fee_observations SET fee_audience = 'business' WHERE fee_raw_id = 901`;
      if (difference === "frequency") await db`UPDATE raw_fee_observations SET frequency = 'monthly' WHERE fee_raw_id = 901`;
      if (difference === "amount_kind") await db`UPDATE raw_fee_observations SET amount_kind = 'percent', amount = NULL WHERE fee_raw_id = 901`;
      if (difference === "product") await db`UPDATE raw_fee_observations SET product_name = 'Premium Checking' WHERE fee_raw_id = 901`;
      if (difference === "institution") await db`UPDATE raw_fee_observations SET institution_id = 43 WHERE fee_raw_id = 901`;
      expect((await run()).retired.map((fee) => Number(fee.fee_published_id))).toEqual([4]);
    },
  );

  it("compares represented percentage bases without planning rate retirements", async () => {
    await db`UPDATE published_fee_records SET amount = NULL, amount_kind = 'percent', rate_percent = 5,
      rate_basis = 'balance' WHERE fee_published_id = 4`;
    await db`UPDATE raw_fee_observations SET fee_name = 'Coin Counting', amount = NULL,
      amount_kind = 'percent', rate_basis = 'transaction' WHERE fee_raw_id IN (4, 901)`;
    let witnessed: boolean | undefined;
    const observingDb = (async (strings: TemplateStringsArray, ...values: postgres.ParameterOrJSON<never>[]) => {
      const result = await db(strings, ...values);
      if (strings.join(" ").includes("WITH newer_rows AS MATERIALIZED")) {
        witnessed = result.find((fee) => Number(fee.fee_published_id) === 4)?.newer_row_match;
      }
      return result;
    }) as unknown as Db;
    expect(await run(true, observingDb)).toMatchObject({ retired: [], restored: 0 });
    expect(witnessed).toBe(false);
    await db`UPDATE raw_fee_observations SET rate_basis = 'balance' WHERE fee_raw_id = 901`;
    expect(await run(true, observingDb)).toMatchObject({ retired: [], restored: 0 });
    expect(witnessed).toBe(true);
  });

  it("does not treat unspecified audience or charging basis as a wildcard", async () => {
    await db`UPDATE raw_fee_observations SET fee_name = 'Coin Counting', fee_audience = NULL,
      frequency = NULL, product_name = NULL WHERE fee_raw_id = 901`;
    expect((await run(true)).retired.map((fee) => Number(fee.fee_published_id))).toEqual([4]);
    await db`UPDATE published_fee_records SET fee_audience = 'unknown', frequency = NULL WHERE fee_published_id = 4`;
    await db`UPDATE raw_fee_observations SET product_name = NULL WHERE fee_raw_id = 4`;
    expect(await run(true)).toMatchObject({ stillNamed: 1, retired: [] });
  });

  it.each(["different_url", "identical_bytes", "identical_text", "unread_new_text", "unrecognized", "unproven_old_line"])(
    "preserves the existing %s source safeguard", async (condition) => {
      if (condition === "different_url") await db`UPDATE source_documents SET document_url = 'https://testbank.example/other' WHERE id = 900`;
      if (condition === "identical_bytes") await db`UPDATE source_documents SET content_hash = 'old-bytes' WHERE id = 900`;
      if (condition === "identical_text") await db`UPDATE agent_source_texts SET text_hash = 'old-text' WHERE id = 2`;
      if (condition === "unread_new_text") await db`DELETE FROM raw_fee_observations WHERE fee_raw_id = 901`;
      if (condition === "unrecognized") await db`UPDATE agent_source_texts SET normalized_text = 'HOME\nContact us' WHERE id = 2`;
      if (condition === "unproven_old_line") await db`UPDATE agent_source_texts SET normalized_text = 'Overdraft Fee | $32.00\nStop Payment | $30.00' WHERE id = 1`;
      expect((await run()).retired).toEqual([]);
      expect((await row()).rolled_back_at).toBeNull();
      expect((await verified()).review_status).toBe("verified");
    },
  );

  it("never selects held-only documents", async () => {
    await db`UPDATE published_fee_records SET quarantined_at = NOW()`;
    expect(await run()).toMatchObject({ documentsChecked: 0, retired: [], restored: 0 });
    expect(await db`SELECT 1 FROM pipeline_attempts`).toHaveLength(0);
  });

  it("excludes held rows from a selected document and never rejects their lineage", async () => {
    await db`UPDATE published_fee_records SET quarantined_at = NOW() WHERE fee_published_id = 4`;
    const before = await states();
    expect(await run()).toMatchObject({ documentsChecked: 1, retired: [], restored: 0 });
    expect(await states()).toEqual(before);
  });

  it("re-checks holds while loading fees after selecting a document pair", async () => {
    const suppliedDb = (async (strings: TemplateStringsArray, ...values: postgres.ParameterOrJSON<never>[]) => {
      const result = await db(strings, ...values);
      if (strings.join(" ").includes("WITH older AS")) {
        await db`UPDATE published_fee_records SET quarantined_at = NOW() WHERE fee_published_id = 4`;
      }
      return result;
    }) as unknown as Db;
    expect(await run(false, suppliedDb)).toMatchObject({ documentsChecked: 1, retired: [] });
    expect((await attempt()).detail).toMatchObject({ planned_retired: 0, retired: 0 });
    expect((await verified()).review_status).toBe("verified");
  });

  it.each(["hold", "closed", "lineage"])("reports no retirement or rejection after a %s change commits after selection", async (change) => {
    const changingDb = changeAfterSelection(async () => {
      if (change === "hold") await db`UPDATE published_fee_records SET quarantined_at = NOW() WHERE fee_published_id = 4`;
      if (change === "closed") await db`UPDATE published_fee_records SET rolled_back_at = NOW(), rolled_back_reason = 'operator_closed' WHERE fee_published_id = 4`;
      if (change === "lineage") await db`UPDATE published_fee_records SET lineage_ref = 2004 WHERE fee_published_id = 4`;
    });
    expect(await run(false, changingDb)).toMatchObject({ retired: [], restored: 0 });
    expect((await verified()).review_status).toBe("verified");
    const changed = await row();
    if (change === "hold") expect(changed.quarantined_at).not.toBeNull();
    if (change === "closed") expect(changed.rolled_back_reason).toBe("operator_closed");
    if (change === "lineage") expect(changed.lineage_ref).toBe("2004");
    expect(await attempt()).toMatchObject({ outcome: "ok", detail: { planned_retired: 1, retired: 0 } });
    expect((await db`SELECT detail FROM agent_run_events`)[0].detail).toMatchObject({ retired: 0, samples: [] });
  });

  it.each(["hold", "closed"])("rejects only actually updated lineage in a mixed batch after a %s", async (change) => {
    await db`INSERT INTO raw_fee_observations VALUES (5, 42, 500, 'Notary Service', 10, 'consumer', 'per_item', 'flat', NULL, NULL)`;
    await db`INSERT INTO verified_fee_observations VALUES (1005, 5, 'verified', '[]')`;
    await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id,
      canonical_fee_key, fee_name, amount, fee_audience, frequency, amount_kind)
      VALUES (5, 1005, 42, 'notary', 'Notary Service', 10, 'consumer', 'per_item', 'flat')`;
    await db`UPDATE agent_source_texts SET normalized_text = ${`${olderText}\nNotary Service | $10.00`} WHERE id = 1`;
    const changingDb = changeAfterSelection(async () => {
      if (change === "hold") await db`UPDATE published_fee_records SET quarantined_at = NOW() WHERE fee_published_id = 4`;
      else await db`UPDATE published_fee_records SET rolled_back_at = NOW(), rolled_back_reason = 'operator_closed' WHERE fee_published_id = 4`;
    });
    expect((await run(false, changingDb)).retired.map((fee) => Number(fee.fee_published_id))).toEqual([5]);
    expect((await verified()).review_status).toBe("verified");
    expect((await verified(1005)).review_status).toBe("rejected");
    expect((await row(5)).rolled_back_reason).toBe("newer_copy_drops_fee:#900");
    expect(await attempt()).toMatchObject({ detail: { planned_retired: 2, retired: 1 } });
    expect((await db`SELECT detail FROM agent_run_events`)[0].detail).toMatchObject({ retired: 1, samples: [{ fee_published_id: 5 }] });
  });

  it.each([false, true])("preserves an operator hold on a restorable row (hold after selection: %s)", async (afterSelection) => {
    await db`UPDATE published_fee_records SET rolled_back_at = NOW(), rolled_back_reason = 'newer_copy_drops_fee:#800' WHERE fee_published_id = 4`;
    await db`UPDATE verified_fee_observations SET review_status = 'rejected', outlier_flags = '["newer_copy_drops_fee"]' WHERE fee_verified_id = 1004`;
    await db`UPDATE agent_source_texts SET normalized_text = ${olderText} WHERE id = 2`;
    const hold = () => db`UPDATE published_fee_records SET quarantined_at = NOW() WHERE fee_published_id = 4`;
    if (!afterSelection) await hold();
    const suppliedDb = afterSelection ? changeAfterSelection(hold) : db as unknown as Db;
    expect(await run(false, suppliedDb)).toMatchObject({ retired: [], restored: 0 });
    expect((await row()).rolled_back_reason).toBe("newer_copy_drops_fee:#800");
    expect((await verified()).review_status).toBe("rejected");
    expect((await attempt()).detail).toMatchObject({ planned_restored: afterSelection ? 1 : 0, restored: 0 });
  });

  it("still restores its own unheld retirement and records the actual restore", async () => {
    await db`UPDATE published_fee_records SET rolled_back_at = NOW(), rolled_back_reason = 'newer_copy_drops_fee:#800' WHERE fee_published_id = 4`;
    await db`UPDATE verified_fee_observations SET review_status = 'rejected', outlier_flags = '["newer_copy_drops_fee"]' WHERE fee_verified_id = 1004`;
    await db`UPDATE agent_source_texts SET normalized_text = ${olderText} WHERE id = 2`;
    expect(await run()).toMatchObject({ retired: [], restored: 1 });
    expect((await row()).rolled_back_at).toBeNull();
    expect(await verified()).toEqual({ review_status: "verified", outlier_flags: [] });
    expect((await attempt()).detail).toMatchObject({ planned_restored: 1, restored: 1 });
    expect(await db`SELECT 1 FROM pipeline_attempts WHERE input_fingerprint = 'restored:4:9'`).toHaveLength(1);
  });

  it("does not restore changed lineage or alter either verified row after selection", async () => {
    await db`UPDATE published_fee_records SET rolled_back_at = NOW(), rolled_back_reason = 'newer_copy_drops_fee:#800' WHERE fee_published_id = 4`;
    await db`UPDATE verified_fee_observations SET review_status = 'rejected', outlier_flags = '["newer_copy_drops_fee"]' WHERE fee_verified_id = 1004`;
    await db`INSERT INTO verified_fee_observations VALUES (2004, 4, 'approved', '[]')`;
    await db`UPDATE agent_source_texts SET normalized_text = ${olderText} WHERE id = 2`;
    const changingDb = changeAfterSelection(() => db`UPDATE published_fee_records SET lineage_ref = 2004 WHERE fee_published_id = 4`);
    expect(await run(false, changingDb)).toMatchObject({ retired: [], restored: 0 });
    expect((await row()).rolled_back_reason).toBe("newer_copy_drops_fee:#800");
    expect((await row()).lineage_ref).toBe("2004");
    expect((await verified()).review_status).toBe("rejected");
    expect((await verified(2004)).review_status).toBe("approved");
    expect((await attempt()).detail).toMatchObject({ planned_restored: 1, restored: 0 });
    expect(await db`SELECT 1 FROM pipeline_attempts WHERE input_fingerprint = 'restored:4:9'`).toHaveLength(0);
  });

  it.each(["audience", "frequency", "variant", "missing_audience", "missing_frequency", "equivalent", "legacy_equivalent"])(
    "distinguishes a %s sibling from a true live equivalent on restore", async (difference) => {
    await db`UPDATE published_fee_records SET rolled_back_at = NOW(), rolled_back_reason = 'newer_copy_drops_fee:#800',
      fee_audience = 'business' WHERE fee_published_id = 4`;
    await db`UPDATE verified_fee_observations SET review_status = 'rejected', outlier_flags = '["newer_copy_drops_fee"]' WHERE fee_verified_id = 1004`;
    await db`UPDATE agent_source_texts SET normalized_text = ${olderText} WHERE id = 2`;
    await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id, canonical_fee_key,
      fee_name, amount, fee_audience, frequency, amount_kind)
      VALUES (14, 1014, 42, 'coin_counting', 'Coin Counting', 5, 'consumer', 'per_item', 'flat')`;
    if (difference !== "audience") await db`UPDATE published_fee_records SET fee_audience = 'consumer' WHERE fee_published_id = 4`;
    if (difference === "frequency") await db`UPDATE published_fee_records SET frequency = 'monthly' WHERE fee_published_id = 14`;
    if (difference === "variant") await db`UPDATE published_fee_records SET variant_type = 'premium' WHERE fee_published_id = 14`;
    if (difference === "missing_audience") await db`UPDATE published_fee_records SET fee_audience = NULL WHERE fee_published_id = 4`;
    if (difference === "missing_frequency") await db`UPDATE published_fee_records SET frequency = NULL WHERE fee_published_id = 4`;
    if (difference === "legacy_equivalent") {
      await db`UPDATE published_fee_records SET fee_audience = NULL, frequency = NULL, amount_kind = NULL WHERE fee_published_id = 4`;
      await db`UPDATE published_fee_records SET fee_audience = 'unknown', frequency = NULL WHERE fee_published_id = 14`;
    }
    const equivalent = difference === "equivalent" || difference === "legacy_equivalent";
    expect(await run()).toMatchObject({ retired: [], restored: equivalent ? 0 : 1 });
    expect((await row()).rolled_back_at == null).toBe(!equivalent);
    expect((await row(14)).rolled_back_at).toBeNull();
    expect((await attempt()).detail).toMatchObject({ planned_restored: 1, restored: equivalent ? 0 : 1 });
  });

  it.each(["transaction", "balance"])("a live percent rate on %s does not block a flat-dollar restore", async (basis) => {
    await db`UPDATE published_fee_records SET rolled_back_at = NOW(), rolled_back_reason = 'newer_copy_drops_fee:#800' WHERE fee_published_id = 4`;
    await db`UPDATE verified_fee_observations SET review_status = 'rejected', outlier_flags = '["newer_copy_drops_fee"]' WHERE fee_verified_id = 1004`;
    await db`UPDATE agent_source_texts SET normalized_text = ${olderText} WHERE id = 2`;
    await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id, canonical_fee_key,
      fee_name, amount, fee_audience, frequency, amount_kind, rate_percent, rate_basis)
      VALUES (14, 1014, 42, 'coin_counting', 'Coin Counting', NULL, 'consumer', 'per_item', 'percent', 5, ${basis})`;
    expect(await run()).toMatchObject({ retired: [], restored: 1 });
    expect((await row(14)).amount_kind).toBe("percent");
  });

  it("keeps an already-decided v1 pair closed", async () => {
    expect(newerCopyFingerprint(500, 900)).toBe("v1:500:900");
    await db`INSERT INTO pipeline_attempts (source_document_id, stage, strategy, input_fingerprint)
      VALUES (500, 'publish', 'hamilton.newer_copy_check', 'v1:500:900')`;
    expect(await run()).toMatchObject({ documentsChecked: 0, retired: [], restored: 0 });
    expect((await row()).rolled_back_at).toBeNull();
  });
});
