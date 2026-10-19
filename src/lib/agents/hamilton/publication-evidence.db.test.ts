// @vitest-environment node
/** Real savepoint errors and pending selection; full current schema, owned loopback only. */
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/fee-source-fetch", async (original) => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Publication SQL fixtures forbid source/provider requests"); },
}));

const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
type Fixture = { institutionId: number; runId: number; documentId: number; feeVerifiedId: number };

describe.skipIf(!connection)("Required publication evidence in actual PostgreSQL (#1069)", () => {
  let db: postgres.Sql;
  let appSql: Db;
  let publish: typeof import("./publish");
  let nextRunId = -106_900_000 - process.pid * 100;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Publication tests require a disposable loopback database; production is forbidden");
    }
    vi.stubEnv("DATABASE_URL", connection);
    const module = await import("@/lib/data-store/connection");
    appSql = module.sql;
    db = postgres(connection, { max: 1, ssl: "require", types: {
      numeric: module.NUMERIC_AS_NUMBER, json: module.JSON_TEXT_PASSTHROUGH, text: module.TEXT_WITHOUT_NUL,
    } }) as unknown as postgres.Sql;
    publish = await import("./publish");
  });
  afterAll(async () => { if (db) await db.end(); if (appSql) await appSql.end(); vi.unstubAllEnvs(); });

  async function rollback(test: (tx: Db) => Promise<void>) {
    const stop = new Error("rollback owned publication fixture");
    await db.begin(async (scope) => { await test(scope as unknown as Db); throw stop; })
      .catch((error) => { if (error !== stop) throw error; });
  }

  async function seed(tx: Db): Promise<Fixture> {
    const [{ id }] = await tx`INSERT INTO institution_sources
      (institution_name, website_url, fee_schedule_url, charter_type, state, state_code, asset_size, source, status)
      VALUES ('Fixture Community Bank','https://fixture.example/','https://fixture.example/fees.pdf',
        'bank','Texas','TX',1000000,'e2e','active') RETURNING id`;
    const [{ id: runId }] = await tx`INSERT INTO agent_runs (id,agent_name,run_kind,title,status)
      VALUES (${nextRunId--},'hamilton','manual_repair','Owned publication evidence fixture','running') RETURNING id`;
    const document = await addLine(tx, Number(id), Number(runId), 35, "2026-10-19");
    return { institutionId: Number(id), runId: Number(runId), ...document };
  }

  async function addLine(tx: Db, institutionId: number, runId: number, amount: number, date: string) {
    const text = `Fixture Community Bank\nConsumer Fee Schedule\nOverdraft Fee $${amount}.00 per item\nStop Payment Fee $30.00 per item`;
    const hash = createHash("sha256").update(text + randomUUID()).digest("hex");
    const url = "https://fixture.example/fees.pdf";
    const [{ id: documentId }] = await tx`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type,crawled_at)
      VALUES (${institutionId},'success',${url},${hash},'application/pdf',${date}::timestamptz) RETURNING id`;
    await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,document_type,content_type,status,normalized_text,text_hash,char_count)
      VALUES (${runId},${documentId},${institutionId},${url},'text_pdf','application/pdf','completed',${text},${hash},${text.length})`;
    const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
      (institution_id,source_document_id,source_url,extraction_confidence,agent_event_id,fee_name,amount,frequency,source,fee_audience,audience_evidence)
      VALUES (${institutionId},${documentId},${url},0.92,${randomUUID()},'Overdraft fee',${amount},'per_item','knox','consumer','Fixture Consumer Fee Schedule heading') RETURNING fee_raw_id`;
    const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations
      (fee_raw_id,institution_id,source_url,extraction_confidence,canonical_fee_key,outlier_flags,
       verified_by_agent_event_id,fee_name,amount,frequency,fee_audience)
      VALUES (${rawId},${institutionId},${url},0.92,'overdraft','["agentic_darwin_verified"]'::jsonb,
        ${randomUUID()},'Overdraft fee',${amount},'per_item','consumer') RETURNING fee_verified_id`;
    return { documentId: Number(documentId), feeVerifiedId: Number(verifiedId) };
  }

  /** Fail native SQL INSIDE the supplied transaction's real savepoint, not a rejected JS mock. */
  function failRead(tx: Db, marker: string, witness: { calls: number; sqlstate?: string }): Db {
    const fail = async () => {
      witness.calls += 1;
      try { return await tx.unsafe("SELECT 1 / 0 AS controlled_publication_read_failure"); }
      catch (error) {
        witness.sqlstate = (error as { code?: string }).code;
        throw error;
      }
    };
    return new Proxy(tx, {
      apply(target, _receiver, args: unknown[]) {
        const query = Array.isArray(args[0]) ? (args[0] as string[]).join(" ") : String(args[0]);
        return query.includes(marker) ? fail() : Reflect.apply(target, target, args);
      },
      get(target, key) {
        if (key === "savepoint") return (work: (scope: Db) => Promise<unknown>) =>
          (target as unknown as { savepoint: (work: (scope: Db) => Promise<unknown>) => Promise<unknown> }).savepoint(
            (scope) => work(failRead(scope, marker, witness)),
          );
        if (key === "unsafe") return (query: string, ...args: unknown[]) => query.includes(marker)
          ? fail() : Reflect.apply(target.unsafe, target, [query, ...args]);
        return Reflect.get(target, key);
      },
    }) as Db;
  }

  const run = (tx: Db, f: Fixture) => publish.runHamiltonPublish({
    db: tx, runId: f.runId, institutionId: f.institutionId, minInstitutionFees: 1, limit: 20,
  });

  it.each([
    ["business_schedule", "consumer_fee_id"],
    ["other_bank_document", "COALESCE(o.id, 0)"],
    ["unconfirmed_document_host", "own_label"],
    ["document_owner", "named_other_id"],
    ["exact_duplicate", "lower(btrim(fp.fee_name))"],
    ["live_prior", "ORDER BY fp.published_at DESC"],
  ])("defers real %s failure, remains selectable, then publishes once on a healthy retry", async (check, marker) => {
    await rollback(async (tx) => {
      const fixture = await seed(tx);
      const witness = { calls: 0, sqlstate: undefined as string | undefined };
      const unavailable = await run(failRead(tx, marker, witness), fixture);
      expect(witness).toMatchObject({ calls: 1, sqlstate: "22012" });
      expect(unavailable).toMatchObject({ learning: true, selectedVerifiedFees: 1, publishedFees: 0, supersededFees: 0, evidenceDeferredFees: 1 });
      expect(unavailable.results[0]).toMatchObject({ evidenceDeferred: true, unavailableEvidence: [check] });
      expect(unavailable.outcomes, "unavailable evidence is not a rejected-fee outcome").toEqual({});
      expect(await tx`SELECT 42 AS after_savepoint`).toEqual([{ after_savepoint: 42 }]);
      expect(await tx`SELECT 1 FROM published_fee_records WHERE institution_id = ${fixture.institutionId}`).toHaveLength(0);
      expect(await tx`SELECT 1 FROM pipeline_attempts WHERE institution_id = ${fixture.institutionId}`).toHaveLength(0);
      expect(await tx`SELECT 1 FROM pipeline_feedback WHERE institution_id = ${fixture.institutionId}`).toHaveLength(0);

      const healthy = await run(tx, fixture);
      expect(healthy).toMatchObject({ selectedVerifiedFees: 1, publishedFees: 1, evidenceDeferredFees: 0 });
      expect(await tx`SELECT input_fingerprint,outcome FROM pipeline_attempts WHERE institution_id = ${fixture.institutionId}`)
        .toContainEqual({ input_fingerprint: `verified:${fixture.feeVerifiedId}`, outcome: "ok" });
      expect(await run(tx, fixture)).toMatchObject({ selectedVerifiedFees: 0, publishedFees: 0 });
      expect(await tx`SELECT 1 FROM published_fee_records WHERE institution_id = ${fixture.institutionId} AND rolled_back_at IS NULL`).toHaveLength(1);
    });
  });

  it("does not insert or close the prior price after a real listed-line read failure", async () => {
    await rollback(async (tx) => {
      const fixture = await seed(tx);
      const prior = await addLine(tx, fixture.institutionId, fixture.runId, 30, "2026-01-01");
      // Seed an existing live prior; its already-published lineage is not pending.
      await tx`INSERT INTO published_fee_records
        (lineage_ref,institution_id,canonical_fee_key,fee_name,amount,frequency,fee_audience,
         published_by_adversarial_event_id,verified_by_agent_event_id,source_url,published_at)
        SELECT fee_verified_id,institution_id,canonical_fee_key,fee_name,amount,frequency,fee_audience,
          verified_by_agent_event_id,verified_by_agent_event_id,source_url,'2026-01-01'::timestamptz
          FROM verified_fee_observations WHERE fee_verified_id = ${prior.feeVerifiedId}`;
      await tx.unsafe(
        "INSERT INTO pipeline_attempts (institution_id,stage,strategy,strategy_version,input_fingerprint,outcome,yield_count,cost_microusd,agent_run_id) VALUES ($1,'publish','publish.rules',3,$2,'ok',1,0,$3)",
        [fixture.institutionId, "verified:" + prior.feeVerifiedId, fixture.runId],
      );
      const before = await tx`SELECT to_jsonb(p)::text AS state FROM published_fee_records p WHERE institution_id = ${fixture.institutionId}`;
      const witness = { calls: 0, sqlstate: undefined as string | undefined };
      const result = await run(failRead(tx, "SELECT source_document_id, fee_name, amount", witness), fixture);
      expect(witness).toMatchObject({ calls: 1, sqlstate: "22012" });
      expect(result).toMatchObject({ publishedFees: 0, supersededFees: 0, evidenceDeferredFees: 1 });
      expect(result.results[0]).toMatchObject({ unavailableEvidence: ["listed_fee_lines"] });
      expect(await tx`SELECT to_jsonb(p)::text AS state FROM published_fee_records p WHERE institution_id = ${fixture.institutionId}`).toEqual(before);
      expect(await tx`SELECT 1 FROM pipeline_attempts WHERE institution_id = ${fixture.institutionId} AND input_fingerprint = ${"verified:" + fixture.feeVerifiedId}`).toHaveLength(0);
      expect(await run(tx, fixture)).toMatchObject({ selectedVerifiedFees: 1, publishedFees: 1, supersededFees: 1 });
      expect(await run(tx, fixture)).toMatchObject({ selectedVerifiedFees: 0, publishedFees: 0 });
    });
  });
});
