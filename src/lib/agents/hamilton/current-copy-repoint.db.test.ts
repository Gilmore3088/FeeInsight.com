/** #1200: the current-copy re-point against real PostgreSQL, using loopback-only temporary tables. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { repointLiveFeesToCurrentCopy, selectCurrentCopyRepointCandidates } from "./current-copy-repoint";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof repointLiveFeesToCurrentCopy>[0];

describe.skipIf(!connection)("Current-copy re-point in isolated PostgreSQL (#1200)", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Re-point tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, state_code text)`;
    await db`CREATE TEMP TABLE source_documents (id bigint PRIMARY KEY, superseded_by_id bigint, document_url text,
      crawled_at timestamptz, status text DEFAULT 'success', companion_source_id bigint, institution_id bigint)`;
    await db`CREATE TEMP TABLE raw_fee_observations (fee_raw_id bigint PRIMARY KEY, source_document_id bigint,
      agent_event_id uuid, extraction_note text, conditions text, product_name text)`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigint PRIMARY KEY, fee_raw_id bigint,
      institution_id bigint, source_url text, document_r2_key text, extraction_confidence numeric,
      canonical_fee_key text, variant_type text, outlier_flags jsonb, verified_by_agent_event_id uuid,
      fee_name text, amount numeric, frequency text, amount_kind text, rate_percent numeric,
      rate_min_amount numeric, rate_max_amount numeric, rate_basis text, review_status text, fee_audience text)`;
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigint PRIMARY KEY, lineage_ref bigint,
      institution_id bigint, canonical_fee_key text, variant_type text, frequency text, amount numeric,
      amount_kind text, rate_percent numeric, fee_name text, fee_audience text, rolled_back_at timestamptz,
      rolled_back_reason text, quarantined_at timestamptz, source_url text, document_r2_key text,
      extraction_confidence numeric, coverage_tier text, agent_event_id uuid, verified_by_agent_event_id uuid,
      published_by_adversarial_event_id uuid, published_at timestamptz DEFAULT '2026-02-17T00:00:00Z')`;
    await db`CREATE TEMP TABLE published_fee_corrections (fee_published_id bigint, status text)`;
    await db`CREATE TEMP TABLE pipeline_attempts (id bigserial PRIMARY KEY, institution_id bigint, source_document_id bigint, stage text,
      strategy text, strategy_version int, input_fingerprint text, outcome text, yield_count int,
      cost_microusd bigint, duration_ms int, agent_run_id bigint, agent_run_step_id bigint, detail jsonb,
      created_at timestamptz DEFAULT now())`;
    await db`CREATE TEMP TABLE agent_source_texts (id bigserial PRIMARY KEY, source_document_id bigint, status text, normalized_text text)`;
    await db`CREATE TEMP TABLE agent_run_events (agent_run_id bigint, step_id bigint, event_type text, status text, message text, detail jsonb)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE institution_sources, source_documents, raw_fee_observations, verified_fee_observations,
      published_fee_records, published_fee_corrections, pipeline_attempts, agent_source_texts, agent_run_events`;
  });

  /**
   * First Example Bank (42): its live $25 "Overdraft Fee" (501) was read from the February copy
   * (500), superseded by 700 and then by the current copy 900, whose row 9801 reads the same line
   * as "Overdraft charge". `rowDocument` puts the row on another copy; `skipped` records publish's
   * identical skip of it.
   */
  async function seed(options: { rowDocument?: number; rowAudience?: string; skipped?: boolean } = {}) {
    await db`INSERT INTO institution_sources VALUES (42, 'IA')`;
    await db`INSERT INTO source_documents (id, superseded_by_id, document_url, institution_id) VALUES
      (500, 700, 'https://firstexample.example/fees', 42), (700, 900, 'https://firstexample.example/fees', 42),
      (900, NULL, 'https://firstexample.example/fees', 42)`;
    await db`INSERT INTO raw_fee_observations (fee_raw_id, source_document_id, agent_event_id)
      VALUES (501, 500, '00000000-0000-4000-8000-000000000501'),
             (9701, ${options.rowDocument ?? 900}, '00000000-0000-4000-8000-000000009701')`;
    await db`INSERT INTO verified_fee_observations (fee_verified_id, fee_raw_id, institution_id, canonical_fee_key,
      fee_name, amount, frequency, amount_kind, review_status, fee_audience, outlier_flags)
      VALUES (601, 501, 42, 'overdraft', 'Overdraft Fee', 25, 'per_item', 'flat', 'verified', 'consumer', '["agentic_darwin_verified"]'::jsonb)`;
    await db`INSERT INTO verified_fee_observations (fee_verified_id, fee_raw_id, institution_id, source_url, extraction_confidence,
      canonical_fee_key, outlier_flags, verified_by_agent_event_id, fee_name, amount, frequency, amount_kind,
      review_status, fee_audience)
      VALUES (9801, 9701, 42, 'https://firstexample.example/fees', 0.92, 'overdraft', '["agentic_darwin_verified"]'::jsonb,
        '00000000-0000-4000-8000-000000009801', 'Overdraft charge', 25, 'per_item', 'flat', 'verified', ${options.rowAudience ?? "consumer"})`;
    await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id, canonical_fee_key,
      frequency, amount, amount_kind, fee_name, fee_audience, source_url)
      VALUES (501, 601, 42, 'overdraft', 'per_item', 25, 'flat', 'Overdraft Fee', 'consumer', 'https://firstexample.example/fees')`;
    await db`INSERT INTO agent_source_texts (source_document_id, status, normalized_text)
      VALUES (900, 'completed', 'First Example Bank fee schedule. An overdraft charge of $25.00 per presentment.')`;
    if (options.skipped ?? true) {
      await db`INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, input_fingerprint, outcome, detail)
        VALUES (42, 'publish', 'publish.rules', 3, 'verified:9801', 'unchanged',
          '{"fee_verified_id": 9801, "reason": "Identical fee already published", "previous_fee_published_id": 501}'::jsonb)`;
    }
  }

  const run = (live: boolean, dryRun = false) =>
    repointLiveFeesToCurrentCopy(db as unknown as Db, { runId: 9, stepId: 90, batchId: "agentic-run-9", dryRun, live });
  const liveFee = async () => (await db`SELECT lineage_ref, fee_name, amount, canonical_fee_key, fee_audience, published_at
    FROM published_fee_records WHERE fee_published_id = 501`)[0];

  it("shadow counts and logs, dry run writes nothing, live moves the fee in place once", async () => {
    await seed();
    expect(await run(true, true)).toMatchObject({ checked: 1, eligible: 1, repointed: 0 });
    expect(await db`SELECT 1 FROM agent_run_events`).toHaveLength(0);

    expect(await run(false)).toMatchObject({ live: false, checked: 1, eligible: 1, repointed: 0 });
    expect((await liveFee()).lineage_ref).toBe("601");
    expect(await db`SELECT 1 FROM pipeline_attempts WHERE strategy = 'hamilton.current_copy_repoint'`).toHaveLength(0);
    const [shadow] = await db`SELECT step_id, detail FROM agent_run_events WHERE event_type = 'hamilton.current_copy_repoint'`;
    expect(shadow.step_id).toBe("90");
    expect(typeof shadow.detail === "string" ? JSON.parse(shadow.detail) : shadow.detail).toMatchObject({ live: false, would_repoint: 1 });

    const before = await liveFee();
    expect(await run(true)).toMatchObject({ live: true, eligible: 1, repointed: 1 });
    expect(await liveFee()).toEqual({ ...before, lineage_ref: "9801" });
    expect(await db`SELECT input_fingerprint, outcome FROM pipeline_attempts WHERE strategy = 'hamilton.current_copy_repoint'`)
      .toEqual([{ input_fingerprint: "v1:501:9801", outcome: "ok" }]);
    // Now on the current copy, and the pair is settled: nothing to do on the next step.
    expect(await run(true)).toMatchObject({ checked: 0, repointed: 0 });
  });

  it("takes only publish's own identical skip as the pairing", async () => {
    await seed({ skipped: false });
    expect(await run(true)).toMatchObject({ checked: 0, repointed: 0 });
    expect((await liveFee()).lineage_ref).toBe("601");
  });

  it("follows publish's latest decision on the row at today's rule version only", async () => {
    await seed();
    await db`INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, input_fingerprint, outcome, detail, created_at)
      VALUES (42, 'publish', 'publish.rules', 3, 'verified:9801', 'rejected',
        '{"fee_verified_id": 9801, "reason": "Below publish confidence threshold"}'::jsonb, now() + interval '1 minute')`;
    expect(await run(true)).toMatchObject({ checked: 0, repointed: 0 });
    await db`DELETE FROM pipeline_attempts`;
    await db`INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, input_fingerprint, outcome, detail)
      VALUES (42, 'publish', 'publish.rules', 2, 'verified:9801', 'unchanged',
        '{"fee_verified_id": 9801, "reason": "Identical fee already published", "previous_fee_published_id": 501}'::jsonb)`;
    expect(await run(true)).toMatchObject({ checked: 0, repointed: 0 });
  });

  it("reads the current copy's opening for the publish rules", async () => {
    await seed();
    const [pair] = await selectCurrentCopyRepointCandidates(db as unknown as Db, { live: true });
    expect(pair.document_opening).toMatch(/^First Example Bank fee schedule/);
    expect(pair.prior_name_on_current_copy).toBe(false);
  });

  it("moves only to the current copy at the end of the chain, not to an intermediate copy", async () => {
    await seed({ rowDocument: 700 });
    expect(await run(true)).toMatchObject({ checked: 0, repointed: 0 });
  });

  it("never moves a fee onto a row of another audience", async () => {
    await seed({ rowAudience: "unknown" });
    expect(await run(true)).toMatchObject({ checked: 0, repointed: 0 });
    expect(await liveFee()).toMatchObject({ lineage_ref: "601", fee_audience: "consumer" });
  });

  it("never moves an admin-corrected or held fee", async () => {
    await seed();
    await db`INSERT INTO published_fee_corrections VALUES (501, 'current')`;
    expect(await run(true)).toMatchObject({ checked: 0 });
    await db`TRUNCATE published_fee_corrections`;
    await db`UPDATE published_fee_records SET quarantined_at = now()`;
    expect(await run(true)).toMatchObject({ checked: 0 });
  });

  it.each([
    ["category_guard:schedule_contradicts", 0],
    ["refreshed by #1234", 1],
    ["duplicate of #1234", 1],
    ["duplicate of #501", 1],
    ["duplicate of #888", 0],
    [null, 0],
  ] as Array<[string | null, number]>)("a row once published and closed as %s re-points %i fee(s)", async (reason, expected) => {
    await seed();
    // 888: another live fee that a duplicate collapse kept over the row.
    await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id) VALUES (888, 1, 42)`;
    await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id, rolled_back_at, rolled_back_reason)
      VALUES (777, 9801, 42, now(), ${reason})`;
    expect(await run(true)).toMatchObject({ repointed: expected });
  });
});
