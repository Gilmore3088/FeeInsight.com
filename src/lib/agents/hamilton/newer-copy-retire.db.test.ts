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
    // These generic source fixtures have unassigned product scope. Explicit product controls below
    // supply a complete primary-document witness rather than relying on metadata alone.
    await db`INSERT INTO raw_fee_observations VALUES
      (1, 42, 500, 'Overdraft Fee', 32, 'consumer', 'per_item', 'flat', NULL, NULL),
      (2, 42, 500, 'Stop Payment', 30, 'consumer', 'per_item', 'flat', NULL, NULL),
      (4, 42, 500, 'Coin Counting', 5, 'consumer', 'per_item', 'flat', NULL, NULL),
      (901, 42, 900, 'Paper Statement', 5, 'consumer', 'per_item', 'flat', NULL, NULL)`;
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
    return Object.assign(async (strings: TemplateStringsArray, ...values: postgres.ParameterOrJSON<never>[]) => {
      const result = await db(strings, ...values);
      if (strings.join(" ").includes("ORDER BY source_document_id, id DESC")) await change();
      return result;
    }, { unsafe: db.unsafe.bind(db) }) as unknown as Db;
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

  async function repricedCard(newerLive: boolean) {
    await db`UPDATE agent_source_texts SET normalized_text=${`${olderText}\nReplacement Card | $40.00`} WHERE id=1`;
    await db`UPDATE agent_source_texts SET normalized_text=${`${newerText}\nReplacement Card | $10.00`} WHERE id=2`;
    await db`INSERT INTO raw_fee_observations VALUES (5, 42, 500, 'Replacement Card', 40, 'consumer', 'per_item', 'flat', NULL, NULL),
      (905, 42, 900, 'Replacement Card', 10, 'consumer', 'per_item', 'flat', NULL, NULL)`;
    await db`INSERT INTO verified_fee_observations VALUES (1005, 5, 'verified', '[]'), (1905, 905, 'verified', '[]')`;
    await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id,
      canonical_fee_key, fee_name, amount, fee_audience, frequency, amount_kind, rolled_back_at)
      VALUES (5, 1005, 42, 'card_replacement', 'Replacement Card', 40, 'consumer', 'per_item', 'flat', NULL),
      (905, 1905, 42, 'card_replacement', 'Replacement Card', 10, 'consumer', 'per_item', 'flat',
        ${newerLive ? null : "2026-10-01T00:00:00Z"})`;
  }

  it("retires a fee the newer copy re-prices once the newer copy's price is live", async () => {
    await repricedCard(true);
    const result = await run();
    expect(result.retired.map((fee) => Number(fee.fee_published_id))).toEqual([4, 5]);
    expect(result.repriced).toBe(1);
    expect((await row(5)).rolled_back_reason).toBe("newer_copy_drops_fee:#900");
    expect((await row(905)).rolled_back_at).toBeNull();
  });

  it("keeps the old price live while the newer copy's price is not", async () => {
    await repricedCard(false);
    const result = await run();
    expect(result.retired.map((fee) => Number(fee.fee_published_id))).toEqual([4]);
    expect((await row(5)).rolled_back_at).toBeNull();
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
    const observingDb = Object.assign(async (strings: TemplateStringsArray, ...values: postgres.ParameterOrJSON<never>[]) => {
      const result = await db(strings, ...values);
      if (strings.join(" ").includes("WITH newer_rows AS MATERIALIZED")) {
        witnessed = result.find((fee) => Number(fee.fee_published_id) === 4)?.newer_row_match;
      }
      return result;
    }, { unsafe: db.unsafe.bind(db) }) as unknown as Db;
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
    const suppliedDb = Object.assign(async (strings: TemplateStringsArray, ...values: postgres.ParameterOrJSON<never>[]) => {
      const result = await db(strings, ...values);
      if (strings.join(" ").includes("WITH older AS")) {
        await db`UPDATE published_fee_records SET quarantined_at = NOW() WHERE fee_published_id = 4`;
      }
      return result;
    }, { unsafe: db.unsafe.bind(db) }) as unknown as Db;
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
    await db`UPDATE published_fee_records SET rolled_back_at = '2026-10-01T00:00:00.123456Z', rolled_back_reason = 'newer_copy_drops_fee:#800' WHERE fee_published_id = 4`;
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

  it.each(["reason", "timestamp"])("does not clear a newer closure with a changed %s after selecting a restore", async (changed) => {
    await db`UPDATE published_fee_records SET rolled_back_at = '2026-10-01', rolled_back_reason = 'newer_copy_drops_fee:#800' WHERE fee_published_id = 4`;
    await db`UPDATE verified_fee_observations SET review_status = 'rejected', outlier_flags = '["newer_copy_drops_fee"]' WHERE fee_verified_id = 1004`;
    await db`UPDATE agent_source_texts SET normalized_text = ${olderText} WHERE id = 2`;
    const changingDb = changeAfterSelection(async () => {
      if (changed === "reason") await db`UPDATE published_fee_records SET rolled_back_reason = 'newer_copy_drops_fee:#950' WHERE fee_published_id = 4`;
      else await db`UPDATE published_fee_records SET rolled_back_at = '2026-10-03' WHERE fee_published_id = 4`;
    });
    expect(await run(false, changingDb)).toMatchObject({ retired: [], restored: 0 });
    expect((await row()).rolled_back_at).not.toBeNull();
    expect((await verified()).review_status).toBe("rejected");
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
    expect((await attempt()).detail).toMatchObject({ planned_restored: equivalent ? 0 : 1, restored: equivalent ? 0 : 1 });
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

  it("keeps an already-decided v2 pair closed", async () => {
    expect(newerCopyFingerprint(500, 900)).toBe("v2:500:900");
    await db`INSERT INTO pipeline_attempts (source_document_id, stage, strategy, input_fingerprint)
      VALUES (500, 'publish', 'hamilton.newer_copy_check', 'v2:500:900')`;
    expect(await run()).toMatchObject({ documentsChecked: 0, retired: [], restored: 0 });
    expect((await row()).rolled_back_at).toBeNull();
  });

  it("judges a pair decided under v1 again under v2", async () => {
    await db`INSERT INTO pipeline_attempts (source_document_id, stage, strategy, input_fingerprint)
      VALUES (500, 'publish', 'hamilton.newer_copy_check', 'v1:500:900')`;
    expect((await run()).documentsChecked).toBe(1);
  });

  async function restorableMonthlyFee() {
    const text = "Overdraft Fee | $32.00\nStop Payment | $30.00\nStatement Savings monthly fee | $10.00";
    await db`UPDATE raw_fee_observations SET fee_name='Statement Savings monthly fee', amount=10,
      frequency='monthly' WHERE fee_raw_id=4`;
    await db`UPDATE published_fee_records SET fee_name='Statement Savings monthly fee', amount=10,
      canonical_fee_key='monthly_maintenance', frequency='monthly', rolled_back_at='2026-10-01T00:00:00.123456Z',
      rolled_back_reason='newer_copy_drops_fee:#800' WHERE fee_published_id=4`;
    await db`UPDATE verified_fee_observations SET review_status='rejected', outlier_flags='["newer_copy_drops_fee"]' WHERE fee_verified_id=1004`;
    await db`UPDATE agent_source_texts SET normalized_text=${text} WHERE id=1`;
    await db`UPDATE agent_source_texts SET normalized_text=${'Current fees\n'+text} WHERE id=2`;
  }
  async function monthlyTwin(reason: string | null) {
    await db`INSERT INTO raw_fee_observations SELECT 14,institution_id,900,fee_name,amount,fee_audience,
      frequency,amount_kind,rate_basis,product_name FROM raw_fee_observations WHERE fee_raw_id=4`;
    await db`INSERT INTO verified_fee_observations VALUES (1014,14,'verified','[]')`;
    await db`INSERT INTO published_fee_records (fee_published_id,lineage_ref,institution_id,canonical_fee_key,
      fee_name,amount,fee_audience,frequency,amount_kind,rate_basis,rate_percent,rate_min_amount,rate_max_amount,
      variant_type,rolled_back_at,rolled_back_reason)
      SELECT 14,1014,institution_id,canonical_fee_key,fee_name,amount,fee_audience,frequency,amount_kind,
        rate_basis,rate_percent,rate_min_amount,rate_max_amount,variant_type,
        CASE WHEN ${reason}::text IS NULL THEN NULL ELSE NOW() END,${reason}
      FROM published_fee_records WHERE fee_published_id=4`;
  }
  it.each([false,true])("counts an exact account-type-held twin in the plan and final guard (dry run %s)", async (dryRun) => {
    await restorableMonthlyFee();
    await monthlyTwin("account_type_hold: savings (#1100)");
    const before = await states();
    expect(await run(dryRun)).toMatchObject({ restored:0, proposedRestores:0, blockedRestores:1,
      restoreBlockReasons:{account_type_hold_twin:1} });
    expect(await states()).toEqual(before);
    if (!dryRun) expect((await attempt()).detail).toMatchObject({ planned_restored:0, restored:0,
      blocked_restores:1, restore_block_reasons:{account_type_hold_twin:1} });
  });
  it("reports a live exact twin as blocked instead of a successful dry-run restoration", async () => {
    await restorableMonthlyFee();
    await monthlyTwin(null);
    expect(await run(true)).toMatchObject({ restored:0, proposedRestores:0, blockedRestores:1,
      restoreBlockReasons:{existing_twin:1} });
  });
  it("blocks a held twin committed after selection without counting or re-verifying an update", async () => {
    await restorableMonthlyFee();
    const supplied = changeAfterSelection(() => monthlyTwin("account_type_hold: savings (#1100)"));
    expect(await run(false,supplied)).toMatchObject({ restored:0, proposedRestores:1, blockedRestores:0,
      notUpdatedRestores:1 });
    expect((await row()).rolled_back_reason).toBe("newer_copy_drops_fee:#800");
    expect((await row(14)).rolled_back_reason).toBe("account_type_hold: savings (#1100)");
    expect((await verified()).review_status).toBe("rejected");
    expect((await attempt()).detail).toMatchObject({ planned_restored:1, restored:0, not_updated_restores:1 });
    expect(await db`SELECT 1 FROM pipeline_attempts WHERE input_fingerprint='restored:4:9'`).toHaveLength(0);
  });
  it("reports eligible dry-run and shadow proposals separately from actual restorations", async () => {
    await restorableMonthlyFee();
    const before = await states();
    expect(await run(true)).toMatchObject({ restored:0, proposedRestores:1, blockedRestores:0, notUpdatedRestores:0 });
    expect(await states()).toEqual(before);
    expect(await retireFeesDroppedFromNewerCopy(db as unknown as Db,{runId:9,batchId:'shadow',dryRun:false,live:false}))
      .toMatchObject({ restored:0, proposedRestores:1, blockedRestores:0, notUpdatedRestores:0 });
    expect(await states()).toEqual(before);
    expect((await attempt()).detail).toMatchObject({ live:false, proposed_restores:1, restored:0 });
    const [event] = await db`SELECT message,detail FROM agent_run_events`;
    expect(event.message).toContain('1 would be restored');
    expect(event.detail).toMatchObject({ proposed_restores:1, restored:0 });
  });
  it.each(['other_closure','audience','missing_audience','both_audience','amount','frequency','missing_frequency','variant','kind'])(
    "does not let a %s sibling block a distinct valid restoration", async (difference) => {
      await restorableMonthlyFee();
      await monthlyTwin(difference==='other_closure'?'operator_closed':'account_type_hold: savings (#1100)');
      if(difference==='audience') await db`UPDATE published_fee_records SET fee_audience='business' WHERE fee_published_id=14`;
      if(difference==='missing_audience') await db`UPDATE published_fee_records SET fee_audience=NULL WHERE fee_published_id=14`;
      if(difference==='both_audience') await db`UPDATE published_fee_records SET fee_audience='both' WHERE fee_published_id=14`;
      if(difference==='amount') await db`UPDATE published_fee_records SET amount=15 WHERE fee_published_id=14`;
      if(difference==='frequency') await db`UPDATE published_fee_records SET frequency='per_item' WHERE fee_published_id=14`;
      if(difference==='missing_frequency') await db`UPDATE published_fee_records SET frequency=NULL WHERE fee_published_id=14`;
      if(difference==='variant') await db`UPDATE published_fee_records SET variant_type='premium' WHERE fee_published_id=14`;
      if(difference==='kind') await db`UPDATE published_fee_records SET amount_kind='percent',amount=NULL,rate_percent=5,rate_basis='transaction' WHERE fee_published_id=14`;
      expect(await run()).toMatchObject({ restored:1, proposedRestores:1, blockedRestores:0, notUpdatedRestores:0 });
      expect((await row()).rolled_back_at).toBeNull();
      expect((await row(14)).rolled_back_at).not.toBeNull();
      expect((await verified()).review_status).toBe('verified');
      expect((await attempt()).detail).toMatchObject({ proposed_restores:1, restored:1, blocked_restores:0 });
    },
  );
  it("normalizes missing applicability only to equivalent unstated values", async () => {
    await restorableMonthlyFee();
    await monthlyTwin('account_type_hold: savings (#1100)');
    await db`UPDATE published_fee_records SET fee_audience=NULL,frequency=NULL,amount_kind=NULL WHERE fee_published_id=4`;
    await db`UPDATE published_fee_records SET fee_audience='unknown',frequency=NULL,amount_kind='flat' WHERE fee_published_id=14`;
    expect(await run()).toMatchObject({ restored:0, proposedRestores:0, blockedRestores:1,
      restoreBlockReasons:{account_type_hold_twin:1} });
  });
  it.each(['basis','rate','minimum','maximum'])("keeps the represented %s in the shared blocker identity without restoring a rate", async (difference) => {
    await restorableMonthlyFee();
    await monthlyTwin('account_type_hold: savings (#1100)');
    await db`UPDATE published_fee_records SET amount_kind='percent',amount=NULL,rate_percent=3,rate_basis='transaction',
      rate_min_amount=1,rate_max_amount=99 WHERE fee_published_id IN (4,14)`;
    if(difference==='basis') await db`UPDATE published_fee_records SET rate_basis='balance' WHERE fee_published_id=14`;
    if(difference==='rate') await db`UPDATE published_fee_records SET rate_percent=5 WHERE fee_published_id=14`;
    if(difference==='minimum') await db`UPDATE published_fee_records SET rate_min_amount=2 WHERE fee_published_id=14`;
    if(difference==='maximum') await db`UPDATE published_fee_records SET rate_max_amount=100 WHERE fee_published_id=14`;
    let blocker: unknown;
    const observing = Object.assign(async(strings:TemplateStringsArray,...values:postgres.ParameterOrJSON<never>[])=>{
      const result=await db(strings,...values);
      if(strings.join(' ').includes('WITH newer_rows AS MATERIALIZED')) blocker=result.find(f=>Number(f.fee_published_id)===4)?.restore_block_reason;
      return result;
    },{unsafe:db.unsafe.bind(db)}) as unknown as Db;
    expect(await run(true,observing)).toMatchObject({ restored:0, proposedRestores:0, blockedRestores:0 });
    expect(blocker).toBeNull();
    await db`UPDATE published_fee_records SET rate_percent=3,rate_basis='transaction',rate_min_amount=1,rate_max_amount=99 WHERE fee_published_id=14`;
    expect(await run(true,observing)).toMatchObject({ restored:0, proposedRestores:0 });
    expect(blocker).toBe('account_type_hold_twin');
  });
  it("restores and re-verifies only actual rows in a mixed held and eligible batch", async () => {
    await restorableMonthlyFee();
    await monthlyTwin('account_type_hold: savings (#1100)');
    await db`INSERT INTO raw_fee_observations VALUES (5,42,500,'Coin Counting',5,'consumer','per_item','flat',NULL,NULL)`;
    await db`INSERT INTO verified_fee_observations VALUES (1005,5,'rejected','["newer_copy_drops_fee"]')`;
    await db`INSERT INTO published_fee_records(fee_published_id,lineage_ref,institution_id,canonical_fee_key,fee_name,amount,
      fee_audience,frequency,amount_kind,rolled_back_at,rolled_back_reason)
      VALUES (5,1005,42,'coin_counting','Coin Counting',5,'consumer','per_item','flat',NOW(),'newer_copy_drops_fee:#800')`;
    await db`UPDATE agent_source_texts SET normalized_text=normalized_text||E'\nCoin Counting | $5.00' WHERE id IN(1,2)`;
    expect(await run()).toMatchObject({ restored:1, proposedRestores:1, blockedRestores:1, notUpdatedRestores:0 });
    expect((await verified()).review_status).toBe('rejected');
    expect((await verified(1005)).review_status).toBe('verified');
    expect((await row()).rolled_back_at).not.toBeNull();
    expect((await row(5)).rolled_back_at).toBeNull();
    expect((await attempt()).detail).toMatchObject({ restored:1, proposed_restores:1, blocked_restores:1 });
    expect((await db`SELECT input_fingerprint FROM pipeline_attempts WHERE strategy='hamilton.source_check'`)).toHaveLength(1);
  });
  it("rolls back a failed restore write, reports failure, and leaves the pair pending for normal retry", async () => {
    await restorableMonthlyFee();
    type TransactionScope = typeof db & { savepoint: (work:(inner:TransactionScope)=>Promise<unknown>)=>Promise<unknown> };
    await db.begin(async(transaction)=>{
      const tx=transaction as unknown as TransactionScope;
      function failReverification(scope: TransactionScope): Db {
        const wrapped=async(strings:TemplateStringsArray,...values:postgres.ParameterOrJSON<never>[])=>{
          if(strings.join(' ').includes("outlier_flags = outlier_flags -")) await scope`SELECT 1/0`;
          return scope(strings,...values);
        };
        return Object.assign(wrapped,{unsafe:scope.unsafe.bind(scope),
          savepoint:(work:(inner:Db)=>Promise<unknown>)=>scope.savepoint(inner=>work(failReverification(inner))),
        }) as unknown as Db;
      }
      expect(await run(false,failReverification(tx))).toMatchObject({ restored:0, proposedRestores:1,
        blockedRestores:0, notUpdatedRestores:0, writeFailed:true, failedRestores:1 });
      const [target]=await tx`SELECT rolled_back_reason FROM published_fee_records WHERE fee_published_id=4`;
      expect(target.rolled_back_reason).toBe('newer_copy_drops_fee:#800');
      expect((await tx`SELECT review_status FROM verified_fee_observations WHERE fee_verified_id=1004`)[0].review_status).toBe('rejected');
      expect(await tx`SELECT 1 FROM pipeline_attempts WHERE input_fingerprint IN ('restored:4:9','v2:500:900')`).toHaveLength(0);
      expect(await tx`SELECT 1 FROM agent_run_events`).toHaveLength(0);
      expect(await run(false,tx as unknown as Db)).toMatchObject({ restored:1, writeFailed:false, failedRestores:0 });
      expect(await tx`SELECT 1 FROM pipeline_attempts WHERE input_fingerprint='v2:500:900'`).toHaveLength(1);
    });
  });
});
