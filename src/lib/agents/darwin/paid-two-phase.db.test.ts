// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { trainCategoryModel } from "./category-model";

const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
const app = (tx: unknown) => tx as Db;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const ordinary = "Fee Schedule\nStop Payment | $30.00 per item";
interface Fixture { institutionId: number; runId: number; documentId: number; artifactId: number; rawIds: number[] }

describe.skipIf(!connection)("generic paid collection before current-input settlement", () => {
  let db: postgres.Sql;
  let application: Db;
  let reviews: typeof import("./release-review");
  let release: typeof import("./release-held");
  let category: typeof import("./category-model");
  let paid: typeof import("../paid-pass");
  const owned: Fixture[] = [];
  const inTx = <T>(work: (tx: Db) => Promise<T>) => db.begin(tx => work(app(tx))) as Promise<T>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Owned loopback database required");
    vi.stubEnv("DATABASE_URL", connection);
    const connectionModule = await import("@/lib/data-store/connection");
    application = connectionModule.sql;
    db = postgres(connection, {
      max: 4, ssl: "require", types: {
        numeric: connectionModule.NUMERIC_AS_NUMBER, json: connectionModule.JSON_TEXT_PASSTHROUGH, text: connectionModule.TEXT_WITHOUT_NUL,
      }
    });
    reviews = await import("./release-review");
    release = await import("./release-held");
    category = await import("./category-model");
    paid = await import("../paid-pass");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const f of owned.splice(0)) await inTx(async tx => {
      await tx`DELETE FROM pipeline_attempts WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM pipeline_feedback WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM published_fee_records WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM verified_fee_observations WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM agent_source_texts WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM source_documents WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM institution_sources WHERE id=${f.institutionId}`;
      await tx`DELETE FROM agent_runs WHERE id=${f.runId}`;
    });
  });
  afterAll(async () => { await db?.end(); if (typeof application?.end === "function") await application.end(); vi.unstubAllEnvs(); });

  async function seed(count = 1, originalHeader = true): Promise<Fixture> {
    const bytesHash = hash(randomUUID());
    const f = await inTx(async tx => {
      const [inst] = await tx`INSERT INTO institution_sources(institution_name,source,status,website_url,state_code,charter_type)
        VALUES ('Paid two-phase fixture','e2e','active','https://paid.example.test','ZZ','bank') RETURNING id`;
      const [run] = await tx`INSERT INTO agent_runs(agent_name,run_kind,status) VALUES ('darwin','state_agent','running') RETURNING id`;
      const [doc] = await tx`INSERT INTO source_documents(institution_id,status,document_url,content_hash,content_type)
        VALUES (${inst.id},'success','https://paid.example.test/fees.pdf',${bytesHash},'application/pdf') RETURNING id`;
      const [artifact] = await tx`INSERT INTO agent_source_texts(source_document_id,institution_id,source_url,source_hash,status,normalized_text,text_hash,char_count)
        VALUES (${doc.id},${inst.id},'https://paid.example.test/fees.pdf',${bytesHash},'completed',${ordinary},${hash(ordinary)},${ordinary.length}) RETURNING id`;
      const rawIds: number[] = [];
      for (let n = 0; n < count; n += 1) {
        const note = originalHeader
          ? `Knox deterministic extraction from Rosetta artifact #${artifact.id}. canonical_hint=stop_payment; text_hash=${hash(ordinary)}; excerpt="Stop Payment | $30.00 per item"`
          : "Legacy retained Stop Payment quote without a generated original header";
        const [raw] = await tx`INSERT INTO raw_fee_observations(institution_id,source_document_id,source,agent_event_id,fee_name,amount,frequency,
          source_url,extraction_note,conditions,outlier_flags,fee_audience,audience_evidence)
          VALUES (${inst.id},${doc.id},${count === 1 ? "knox" : "manual_import"},gen_random_uuid(),'Stop Payment',30,'per_item',
          'https://paid.example.test/fees.pdf',${note},'Stop Payment | $30.00 per item',
          '["needs_darwin_verification","canonical_hint:stop_payment"]'::jsonb,'both','Explicit fixture audience') RETURNING fee_raw_id`;
        rawIds.push(Number(raw.fee_raw_id));
      }
      return { institutionId: Number(inst.id), runId: Number(run.id), documentId: Number(doc.id), artifactId: Number(artifact.id), rawIds };
    });
    owned.push(f);
    return f;
  }
  const rawState = async (f: Fixture) => (await db`SELECT jsonb_agg(to_jsonb(fr) ORDER BY fee_raw_id)::text AS state
    FROM raw_fee_observations fr WHERE institution_id=${f.institutionId}`)[0].state;
  async function prior(f: Fixture, shadow = false) {
    const { recordAttempt } = await import("../learning/attempts");
    const strategy = shadow ? category.DARWIN_CATEGORY_MODEL_STRATEGY : release.DARWIN_RELEASE_STRATEGY;
    await inTx(async tx => {
      for (const id of f.rawIds) await recordAttempt(tx, {
        institutionId: f.institutionId, sourceDocumentId: f.documentId, stage: "verify", strategy: strategy.strategy, version: strategy.version,
        fingerprint: `raw:${id}`, outcome: shadow ? "evidence_mismatch" : "ok", yieldCount: 0, costMicrousd: 0, runId: f.runId,
        foldIntoPlaybook: false, detail: shadow
          ? { fee_raw_id: id, canonical_fee_key: "stop_payment", suggested_key: "account_research", suggested_probability: .99, decision: "verified" }
          : { verdict: "review", held_reason: "peer_outlier", canonical_fee_key: "stop_payment", source_line: "Stop Payment | $30.00 per item" },
      });
    });
  }
  function model() { vi.spyOn(category, "loadCategoryModel").mockResolvedValue(trainCategoryModel([{ name: "Stop Payment", categoryKey: "stop_payment", count: 20 }])); }
  const response = (ids: number[], positive = true, cost = 1_250) => ({
    costMicrousd: cost, message: {
      content: [{
        type: "text", text: JSON.stringify({
          verdicts: ids.map(id => ({
            id, is_fee: positive, category_fits: true, amount_is_price: true, category: "stop_payment", reason: "Synthetic source-grounded verdict",
          }))
        })
      }]
    }
  }) as never;
  async function lockAll(f: Fixture, other: Db) {
    await other`SELECT id FROM source_documents WHERE id=${f.documentId} FOR UPDATE NOWAIT`;
    await other`SELECT id FROM agent_source_texts WHERE id=${f.artifactId} FOR UPDATE NOWAIT`;
    await other`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=${f.rawIds[0]} FOR UPDATE NOWAIT`;
  }
  async function changeBody(f: Fixture) {
    const changed = ordinary + "\nAnother Valid Service | $7.00";
    await inTx(async other => {
      await lockAll(f, other);
      await other`UPDATE agent_source_texts SET normalized_text=${changed},text_hash=${hash(changed)},char_count=${changed.length} WHERE id=${f.artifactId}`;
    });
  }
  async function noSettlement(f: Fixture, priorCount = 1) {
    expect(await db`SELECT fee_verified_id FROM verified_fee_observations WHERE institution_id=${f.institutionId}`).toHaveLength(0);
    expect(await db`SELECT id FROM pipeline_feedback WHERE institution_id=${f.institutionId}`).toHaveLength(0);
    expect(await db`SELECT id FROM pipeline_attempts WHERE institution_id=${f.institutionId}`).toHaveLength(priorCount);
  }

  it("takes no source/artifact/raw locks across review batches and retains exact per-call duration/cost shares", async () => {
    const f = await seed(50); await prior(f); model();
    let calls = 0, clock = Date.now();
    let secondCallLockResult: string | null = null;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.spyOn(paid, "paidModelCall").mockImplementation(async () => {
      calls += 1;
      if (calls === 2) {
        try { await inTx(other => lockAll(f, other)); secondCallLockResult = "acquired"; }
        catch (error) { secondCallLockResult = (error as { code?: string }).code ?? "unexpected failure"; throw error; }
      }
      clock += calls === 1 ? 100 : 900;
      return response(f.rawIds, false);
    });
    const result = await inTx(tx => reviews.runDarwinReleaseReview({ db: tx, runId: f.runId, calls: 2, acts: false, stateCode: "ZZ" }));
    expect(secondCallLockResult).toBe("acquired");
    expect(result).toMatchObject({ calls: 2, processed: 50, succeeded: 50, failed: 0, costMicrousd: 2_500 });
    const attempts = await db`SELECT duration_ms,cost_microusd::int AS cost_microusd FROM pipeline_attempts WHERE institution_id=${f.institutionId}
      AND strategy=${reviews.DARWIN_RELEASE_REVIEW_STRATEGY.strategy} ORDER BY id`;
    expect(attempts).toHaveLength(50);
    expect(attempts.slice(0, 25)).toEqual(Array.from({ length: 25 }, () => ({ duration_ms: 100, cost_microusd: 50 })));
    expect(attempts.slice(25)).toEqual(Array.from({ length: 25 }, () => ({ duration_ms: 900, cost_microusd: 50 })));
  });

  it.each(["overlap", "disjoint_race", "adjudicate_stop", "positive_release"] as const)("collects adjudication before review admission (%s)", async mode => {
    const reviewed = await seed(), adjudicated = mode === "overlap" || mode === "positive_release" ? reviewed : await seed();
    if (mode === "positive_release") await db`UPDATE raw_fee_observations SET frequency=NULL WHERE fee_raw_id=${reviewed.rawIds[0]}`;
    await prior(reviewed); await prior(adjudicated, true); model();
    const before = await rawState(reviewed), operations: string[] = [];
    vi.spyOn(paid, "paidModelCall").mockImplementation(async options => {
      operations.push(options.operation);
      if (options.operation === "adjudicate") {
        await inTx(other => lockAll(reviewed, other));
        if (mode === "disjoint_race") await changeBody(reviewed);
        if (mode === "adjudicate_stop") { const stop = new Error("Synthetic budget stop"); stop.name = "ProviderBudgetBlockedError"; throw stop; }
      }
      return response([...reviewed.rawIds, ...adjudicated.rawIds]);
    });
    const { runDarwinAdjudicate, DARWIN_ADJUDICATE_STRATEGY } = await import("./adjudicate");
    const result = await inTx(tx => runDarwinAdjudicate({ db: tx, runId: reviewed.runId, limit: 2, measure: true, releaseActs: mode === "positive_release", stateCode: "ZZ" }));
    expect(operations).toEqual(["release_review", "adjudicate"]);
    expect(result.costMicrousd).toBe(mode === "adjudicate_stop" ? 1_250 : 2_500);
    expect(result.budgetStopped).toBe(mode === "adjudicate_stop");
    expect(await db`SELECT id FROM pipeline_attempts WHERE institution_id=${reviewed.institutionId} AND strategy=${reviews.DARWIN_RELEASE_REVIEW_STRATEGY.strategy}`)
      .toHaveLength(mode === "disjoint_race" ? 0 : 1);
    expect(await db`SELECT id FROM pipeline_attempts WHERE institution_id=${adjudicated.institutionId} AND strategy=${DARWIN_ADJUDICATE_STRATEGY.strategy}`)
      .toHaveLength(mode === "adjudicate_stop" ? 0 : 1);
    const verified = await db`SELECT frequency FROM verified_fee_observations WHERE institution_id=ANY(${[reviewed.institutionId, adjudicated.institutionId]}::bigint[])`;
    expect(verified).toHaveLength(mode === "positive_release" ? 1 : 0);
    if (mode === "positive_release") expect(verified[0].frequency).toBe("per_item");
    expect(await rawState(reviewed)).toBe(before);
  });

  it.each(["negative", "positive", "failure", "shadow"] as const)("rejects an ordinary→ordinary used-body change for %s without locks or settlement leaking", async mode => {
    const f = await seed(); await prior(f, mode === "shadow"); model();
    const before = await rawState(f);
    vi.spyOn(paid, "paidModelCall").mockImplementation(async () => {
      await changeBody(f);
      if (mode === "failure") throw new Error("Synthetic transport failure after ordinary source race");
      return response(f.rawIds, mode !== "negative");
    });
    await inTx(async tx => {
      const result = mode === "shadow"
        ? await (await import("./adjudicate")).runDarwinAdjudicate({ db: tx, runId: f.runId, limit: 1, measure: true, stateCode: "ZZ" })
        : await reviews.runDarwinReleaseReview({ db: tx, runId: f.runId, calls: 1, acts: mode === "positive", stateCode: "ZZ" });
      // Release review's established processed counter counts a selected row before
      // admission; shadow counts only an admitted row. Neither means settlement.
      expect(result).toMatchObject({ processed: mode === "shadow" ? 0 : 1, failed: 0, succeeded: 0, costMicrousd: mode === "failure" ? 0 : 1_250 });
      if (mode !== "shadow") expect(result).toMatchObject({ deferred: 1, released: 0 });
      // The outer transaction is still open: the rejected row savepoint released its
      // entire source→artifact→raw prefix rather than parking protocol/row locks.
      await inTx(other => lockAll(f, other));
    });
    expect(await rawState(f)).toBe(before);
    await noSettlement(f);
  });

  it.each(["raw", "attempt", "source_unavailable"] as const)("checks the full selected %s input after a returned paid verdict", async changed => {
    const f = await seed(); await prior(f); model();
    vi.spyOn(paid, "paidModelCall").mockImplementation(async () => {
      await inTx(async other => {
        if (changed === "raw") await other`UPDATE raw_fee_observations SET product_name='Changed ordinary product' WHERE fee_raw_id=${f.rawIds[0]}`;
        else if (changed === "attempt") await other`UPDATE pipeline_attempts SET detail=detail||'{"changed":true}'::jsonb WHERE institution_id=${f.institutionId}`;
        else await other`UPDATE agent_source_texts SET status='failed' WHERE id=${f.artifactId}`;
      });
      return response(f.rawIds);
    });
    const result = await inTx(tx => reviews.runDarwinReleaseReview({ db: tx, runId: f.runId, calls: 1, acts: true, stateCode: "ZZ" }));
    expect(result).toMatchObject({ calls: 1, deferred: 1, processed: 1, failed: 0, succeeded: 0, released: 0, costMicrousd: 1_250 });
    await noSettlement(f);
  });

  it("settles a healthy ordinary legacy raw without imposing an original generated-header requirement", async () => {
    const f = await seed(1, false); await prior(f); model();
    vi.spyOn(paid, "paidModelCall").mockResolvedValue(response(f.rawIds, false));
    const before = await rawState(f);
    const staged = await inTx(async tx => {
      const work = await reviews.stageDarwinReleaseReview({ db: tx, runId: f.runId, calls: 1, acts: false });
      expect(await tx`SELECT id FROM pipeline_attempts WHERE institution_id=${f.institutionId}`).toHaveLength(1);
      expect(await work.settle()).toMatchObject({ processed: 1, succeeded: 1, costMicrousd: 1_250 });
      expect(work.result.deferred ?? 0).toBe(0);
      await expect(work.settle()).rejects.toThrow("already consumed");
      return work.result;
    });
    expect(staged.calls).toBe(1);
    expect(await rawState(f)).toBe(before);
    expect(await db`SELECT id FROM pipeline_attempts WHERE institution_id=${f.institutionId}`).toHaveLength(2);
  });
});
