/** Current-copy audience identity against real PostgreSQL, using loopback-only temporary tables. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import type { FeeAudience } from "@/lib/fee-audience";
import { refreshCopyFingerprint, refreshFeesFromCurrentCopy } from "./refresh-copy";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof refreshFeesFromCurrentCopy>[0];
const audiences: FeeAudience[] = ["consumer", "business", "unknown", "both"];

describe.skipIf(!connection)("Current-copy refresh in isolated PostgreSQL (#2109)", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Refresh tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, state_code text)`;
    await db`CREATE TEMP TABLE source_documents (id bigint PRIMARY KEY, superseded_by_id bigint, document_url text)`;
    await db`CREATE TEMP TABLE raw_fee_observations (fee_raw_id bigint PRIMARY KEY, source_document_id bigint,
      agent_event_id uuid, extraction_note text, conditions text)`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigint PRIMARY KEY, fee_raw_id bigint,
      institution_id bigint, source_url text, document_r2_key text, extraction_confidence numeric,
      canonical_fee_key text, variant_type text, outlier_flags jsonb, verified_by_agent_event_id uuid,
      fee_name text, amount numeric, frequency text, amount_kind text, rate_percent numeric,
      rate_min_amount numeric, rate_max_amount numeric, rate_basis text, review_status text, fee_audience text)`;
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigint PRIMARY KEY, lineage_ref bigint,
      institution_id bigint, canonical_fee_key text, variant_type text, frequency text, amount numeric,
      amount_kind text, rate_percent numeric, fee_name text, fee_audience text, rolled_back_at timestamptz,
      quarantined_at timestamptz, source_url text, document_r2_key text, extraction_confidence numeric,
      coverage_tier text, agent_event_id uuid, verified_by_agent_event_id uuid, published_by_adversarial_event_id uuid)`;
    await db`CREATE TEMP TABLE pipeline_attempts (institution_id bigint, source_document_id bigint, stage text,
      strategy text, strategy_version int, input_fingerprint text, outcome text, yield_count int,
      cost_microusd bigint, duration_ms int, agent_run_id bigint, agent_run_step_id bigint, detail jsonb)`;
    await db`CREATE TEMP TABLE agent_run_events (agent_run_id bigint, event_type text, status text, message text, detail jsonb)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE institution_sources, source_documents, raw_fee_observations, verified_fee_observations,
      published_fee_records, pipeline_attempts, agent_run_events`;
  });

  async function seed(prior: FeeAudience | null, current: FeeAudience | null) {
    await db`INSERT INTO institution_sources VALUES (42, 'TX')`;
    await db`INSERT INTO source_documents VALUES (500, 900, 'https://testbank.example/fees'), (900, NULL, 'https://testbank.example/fees')`;
    await db`INSERT INTO raw_fee_observations (fee_raw_id, source_document_id, agent_event_id)
      VALUES (501, 500, '00000000-0000-4000-8000-000000000501'), (9701, 900, '00000000-0000-4000-8000-000000009701')`;
    await db`INSERT INTO verified_fee_observations (fee_verified_id, fee_raw_id) VALUES (601, 501)`;
    await db`INSERT INTO verified_fee_observations (
      fee_verified_id, fee_raw_id, institution_id, source_url, extraction_confidence,
      canonical_fee_key, outlier_flags, verified_by_agent_event_id, fee_name, amount, frequency,
      amount_kind, review_status, fee_audience)
      VALUES (9801, 9701, 42, 'https://testbank.example/fees', 0.92, 'overdraft',
        '["agentic_darwin_verified"]'::jsonb, '00000000-0000-4000-8000-000000009801',
        'Overdraft Fee', 35, 'per_item', 'flat', 'verified', ${current})`;
    await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id,
      canonical_fee_key, frequency, amount, amount_kind, fee_name, fee_audience)
      VALUES (501, 601, 42, 'overdraft', 'per_item', 35, 'flat', 'Overdraft Fee', ${prior})`;
  }

  const run = (dryRun = false) => refreshFeesFromCurrentCopy(db as unknown as Db, { runId: 9, batchId: "test-run-9", dryRun });

  it.each(audiences)("refreshes only the same %s audience, and dry run writes nothing", async (audience) => {
    await seed(audience, audience);
    expect(await run(true)).toMatchObject({ checked: 1, refreshed: 1 });
    expect((await db`SELECT lineage_ref FROM published_fee_records`)[0].lineage_ref).toBe("601");
    expect(await db`SELECT 1 FROM pipeline_attempts`).toHaveLength(0);
    expect(await db`SELECT 1 FROM agent_run_events`).toHaveLength(0);

    expect(await run()).toMatchObject({ checked: 1, refreshed: 1 });
    expect((await db`SELECT lineage_ref, fee_audience FROM published_fee_records`)[0])
      .toEqual({ lineage_ref: "9801", fee_audience: audience });
  });

  it.each(audiences.flatMap((prior) => audiences.filter((current) => current !== prior).map((current) => [prior, current] as const)))(
    "does not select %s fees for %s lineage", async (prior, current) => {
      await seed(prior, current);
      expect(await run()).toMatchObject({ checked: 0, refreshed: 0 });
      expect((await db`SELECT lineage_ref, fee_audience FROM published_fee_records`)[0])
        .toEqual({ lineage_ref: "601", fee_audience: prior });
      expect(await db`SELECT 1 FROM pipeline_attempts`).toHaveLength(0);
    },
  );

  it("matches a null legacy audience only to unknown", async () => {
    await seed(null, "unknown");
    expect(await run(true)).toMatchObject({ checked: 1, refreshed: 1 });
    await db`UPDATE verified_fee_observations SET fee_audience = 'consumer' WHERE fee_verified_id = 9801`;
    expect(await run(true)).toMatchObject({ checked: 0, refreshed: 0 });
  });

  it("does not reopen a pair already decided under the existing v2 strategy", async () => {
    await seed("consumer", "consumer");
    expect(refreshCopyFingerprint(501, 9801)).toBe("v2:501:9801");
    await db`INSERT INTO pipeline_attempts (stage, strategy, strategy_version, input_fingerprint)
      VALUES ('publish', 'hamilton.refresh_copy', 2, 'v2:501:9801')`;
    expect(await run()).toMatchObject({ checked: 0, refreshed: 0 });
    expect((await db`SELECT lineage_ref FROM published_fee_records`)[0].lineage_ref).toBe("601");
  });

  it.each(["published", "verified"])("refuses an audience change on the %s row after selecting the pair", async (changed) => {
    await seed("consumer", "consumer");
    const racingDb = async (strings: TemplateStringsArray, ...values: postgres.ParameterOrJSON<never>[]) => {
      const result = await db(strings, ...values);
      if (strings.join(" ").includes("WITH stale AS MATERIALIZED")) {
        if (changed === "published") await db`UPDATE published_fee_records SET fee_audience = 'business'`;
        else await db`UPDATE verified_fee_observations SET fee_audience = 'business' WHERE fee_verified_id = 9801`;
      }
      return result;
    };
    expect(await refreshFeesFromCurrentCopy(racingDb as unknown as Db, { runId: 9, batchId: "test-run-9", dryRun: false }))
      .toMatchObject({ checked: 1, refreshed: 0 });
    expect((await db`SELECT lineage_ref FROM published_fee_records`)[0].lineage_ref).toBe("601");
  });
});
