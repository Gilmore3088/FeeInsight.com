// @vitest-environment node
/** Independent committed loopback transactions; fixtures are owned and removed in finally. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withInternationalPublicationWrite } from "./international-publication";
type Db = typeof import("@/lib/data-store/connection").sql;
const connection = process.env.E2E_DATABASE_URL;
const OWNER = "Synthetic international publication race fixture";
const URL = "https://example.invalid/family-publication-race";

describe.skipIf(!connection)("International publication source/identity races (#2278)", () => {
  let observer: postgres.Sql, worker: postgres.Sql, holder: postgres.Sql;
  let nextRunId = -227_850_000 - process.pid * 10;
  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new globalThis.URL(connection).hostname))
      throw new Error("International publication races require owned loopback PostgreSQL; production forbidden");
    const m = await import("@/lib/data-store/connection");
    const config = { max: 1, ssl: "require" as const, types: {
      numeric: m.NUMERIC_AS_NUMBER, json: m.JSON_TEXT_PASSTHROUGH, text: m.TEXT_WITHOUT_NUL,
    } };
    observer = postgres(connection, config) as unknown as postgres.Sql;
    worker = postgres(connection, config) as unknown as postgres.Sql;
    holder = postgres(connection, config) as unknown as postgres.Sql;
  });
  afterAll(async () => { if (observer) await observer.end(); if (worker) await worker.end(); if (holder) await holder.end(); });

  async function seed() {
    return observer.begin(async scope => {
      const tx = scope as unknown as Db;
      const [{ id: institutionId }] = await tx`INSERT INTO institution_sources
        (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
        VALUES (${OWNER},${URL},${URL},'credit_union','Alabama','AL',1000000,'e2e','active') RETURNING id`;
      const runId = nextRunId--;
      await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
        VALUES (${runId},'hamilton','state_agent',${OWNER},'running')`;
      const candidate = await addLine(tx, Number(institutionId), runId, "International Wire Outgoing", 45, false);
      return { institutionId: Number(institutionId), runId, candidate };
    });
  }
  async function addLine(tx: Db, institutionId: number, runId: number, name: string, amount: number, published: boolean) {
    const text = `${name} | $${amount}`;
    const hash = createHash("sha256").update(text).digest("hex");
    const [{ id: documentId }] = await tx`INSERT INTO source_documents(institution_id,status,document_url,content_hash,content_type)
      VALUES (${institutionId},'success',${URL},${hash},'text/plain') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,status,source_hash,normalized_text,text_hash,char_count)
      VALUES (${runId},${documentId},${institutionId},${URL},'completed',${hash},${text},${hash},${text.length}) RETURNING id`;
    const note = `Knox deterministic extraction from Rosetta artifact #${textId}. canonical_hint=wire_intl_outgoing; text_hash=${hash}; excerpt="${text}"`;
    const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
      (institution_id,source_document_id,source_url,source,agent_event_id,fee_name,amount,frequency,extraction_confidence,
       extraction_note,outlier_flags,fee_audience,fee_treatment)
      VALUES (${institutionId},${documentId},${URL},'knox',gen_random_uuid(),${name},${amount},'per_item',.95,
      ${note},'["canonical_hint:wire_intl_outgoing"]'::jsonb,'unknown','charged') RETURNING fee_raw_id`;
    const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations
      (fee_raw_id,institution_id,source_url,verified_by_agent_event_id,canonical_fee_key,fee_name,amount,frequency,
       extraction_confidence,review_status,outlier_flags,fee_audience,fee_treatment)
      VALUES (${rawId},${institutionId},${URL},gen_random_uuid(),'wire_intl_outgoing',${name},${amount},'per_item',.95,
      'verified','["agentic_darwin_verified"]'::jsonb,'unknown','charged') RETURNING fee_verified_id`;
    const publishedId = published ? Number((await tx`INSERT INTO published_fee_records
      (lineage_ref,institution_id,source_url,published_by_adversarial_event_id,canonical_fee_key,fee_name,amount,frequency,
       amount_kind,fee_audience,fee_treatment,published_at)
      VALUES (${verifiedId},${institutionId},${URL},gen_random_uuid(),'wire_intl_outgoing',${name},${amount},'per_item',
      'flat','unknown','charged',NOW()-interval '1 day') RETURNING fee_published_id`)[0].fee_published_id) : null;
    return { documentId: Number(documentId), textId: Number(textId), rawId: Number(rawId), verifiedId: Number(verifiedId), publishedId };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;
  async function cleanup(f: Fixture) {
    await observer.begin(async scope => {
      const tx = scope as unknown as Db;
      expect(await tx`SELECT id FROM institution_sources WHERE id=${f.institutionId} AND institution_name=${OWNER} AND website_url=${URL}`).toHaveLength(1);
      await tx`DELETE FROM published_fee_records WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM verified_fee_observations WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM agent_source_texts WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM source_documents WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM agent_runs WHERE id=${f.runId} AND title=${OWNER}`;
      await tx`DELETE FROM institution_sources WHERE id=${f.institutionId} AND institution_name=${OWNER}`;
      expect(await tx`SELECT id FROM institution_sources WHERE id=${f.institutionId}`).toHaveLength(0);
    });
  }
  /** Observe exact query boundaries; no sleeps or guessed timing establishes these races. */
  function observing(tx: Db, around: (text: string, run: () => Promise<unknown>) => Promise<unknown>): Db {
    const tag = ((strings: TemplateStringsArray, ...values: unknown[]) => around(strings.join("?"), () => tx(strings, ...values as never[]))) as unknown as Db;
    tag.unsafe = tx.unsafe.bind(tx) as typeof tag.unsafe;
    Object.assign(tag, { savepoint: (work: (scope: Db) => Promise<unknown>) =>
      (tx as unknown as { savepoint: (work: (scope: Db) => Promise<unknown>) => Promise<unknown> })
        .savepoint(scope => work(observing(scope, around))) });
    return tag;
  }

  it("defers an independently committed peer arriving before final membership reload", async () => {
    const f = await seed();
    let peers = 0, arrived: Awaited<ReturnType<typeof addLine>> | null = null;
    try {
      await worker.begin(async scope => {
        const tx = observing(scope as unknown as Db, async (text, run) => {
          if (text.includes("FROM published_fee_records fp") && ++peers === 2) {
            arrived = await observer.begin(s => addLine(s as unknown as Db, f.institutionId, f.runId, "International Wire Transfer Fee", 35, true));
          }
          return run();
        });
        const write = vi.fn(async () => true);
        expect(await withInternationalPublicationWrite(tx, { feeVerifiedId: f.candidate.verifiedId }, write))
          .toMatchObject({ kind: "deferred", detail: { reason: "peer_membership_changed" } });
        expect(write).not.toHaveBeenCalled();
        expect(peers).toBe(2);
      });
      expect(arrived).not.toBeNull();
      expect(await observer`SELECT fee_published_id FROM published_fee_records WHERE institution_id=${f.institutionId}`).toHaveLength(1);
    } finally { await cleanup(f); }
  });

  it("rolls back the source prefix when an existing peer publication suffix is busy", async () => {
    const f = await seed();
    try {
      const peer = await observer.begin(s => addLine(s as unknown as Db, f.institutionId, f.runId, "International Wire Transfer Fee", 35, true));
      await holder.begin(async first => {
        const holding = first as unknown as Db;
        await holding`SELECT fee_published_id FROM published_fee_records WHERE fee_published_id=${peer.publishedId!} FOR UPDATE`;
        await worker.begin(async second => {
          const write = vi.fn(async () => true);
          expect(await withInternationalPublicationWrite(second as unknown as Db, { feeVerifiedId: f.candidate.verifiedId }, write))
            .toMatchObject({ kind: "deferred", detail: { reason: "identity_busy_or_changed" } });
          expect(write).not.toHaveBeenCalled();
          // Worker outer transaction is STILL open: NOWAIT success proves its abandoned
          // inner prefix locks were released, rather than merely its connection ending.
          await observer.begin(async third => {
            const checking = third as unknown as Db;
            expect(await checking`SELECT id FROM source_documents WHERE id=${f.candidate.documentId} FOR UPDATE NOWAIT`).toHaveLength(1);
            expect(await checking`SELECT id FROM agent_source_texts WHERE id=${f.candidate.textId} FOR UPDATE NOWAIT`).toHaveLength(1);
          });
        });
      });
    } finally { await cleanup(f); }
  });

  it("defers a raw document move before the suffix without locking the newly discovered document", async () => {
    const f = await seed();
    let moved = false;
    try {
      const other = await observer.begin(s => addLine(s as unknown as Db, f.institutionId, f.runId, "International Wire Outgoing", 50, false));
      await worker.begin(async scope => {
        const tx = observing(scope as unknown as Db, async (text, run) => {
          if (!moved && text.includes("FROM raw_fee_observations WHERE fee_raw_id=ANY")) {
            moved = true;
            await observer`UPDATE raw_fee_observations SET source_document_id=${other.documentId} WHERE fee_raw_id=${f.candidate.rawId}`;
          }
          return run();
        });
        expect(await withInternationalPublicationWrite(tx, { feeVerifiedId: f.candidate.verifiedId }, async () => true))
          .toMatchObject({ kind: "deferred", detail: { reason: "candidate_changed" } });
        expect(moved).toBe(true);
        await observer.begin(async check => {
          const checking = check as unknown as Db;
          expect(await checking`SELECT id FROM source_documents WHERE id=${other.documentId} FOR UPDATE NOWAIT`).toHaveLength(1);
        });
      });
    } finally { await cleanup(f); }
  });

  it.each(["direct", "normal"] as const)("keeps the full verified CAS at the %s ordinary→international transition", async mode => {
    const f = await seed();
    let transitioned = false;
    try {
      await observer`UPDATE verified_fee_observations SET canonical_fee_key='wire_domestic_outgoing',fee_name='Wire Transfer Fee'
        WHERE fee_verified_id=${f.candidate.verifiedId}`;
      const [stale] = await observer`SELECT fv.*,fr.agent_event_id AS raw_agent_event_id,fr.source_document_id,fr.product_name
        FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
        WHERE fv.fee_verified_id=${f.candidate.verifiedId}`;
      await worker.begin(async scope => {
        const tx = observing(scope as unknown as Db, async (text, run) => {
          if (!transitioned && mode === "normal" && text.includes("FOR UPDATE OF fv")) {
            transitioned = true;
            await observer`UPDATE verified_fee_observations SET canonical_fee_key='wire_intl_outgoing'
              WHERE fee_verified_id=${f.candidate.verifiedId}`;
          }
          const result = await run();
          if (!transitioned && mode === "direct" && text.includes("AS verified_state")) {
            transitioned = true;
            await observer`UPDATE verified_fee_observations SET canonical_fee_key='wire_intl_outgoing'
              WHERE fee_verified_id=${f.candidate.verifiedId}`;
          }
          return result;
        });
        const publication = await import("./publish");
        if (mode === "direct") {
          const deferred = vi.fn();
          expect(await publication.insertPublishedFee(tx, { runId: f.runId, batchId: `agentic-run-${f.runId}`,
            row: stale as unknown as import("./publish").VerifiedFeeRow, onInternationalDeferred: deferred })).toBeNull();
          expect(deferred).toHaveBeenCalledWith(expect.objectContaining({ reason: "selected_changed" }));
        } else {
          const result = await publication.runHamiltonPublish({ db: tx, runId: f.runId, institutionId: f.institutionId,
            minInstitutionFees: 1, limit: 100 });
          expect(result.publishedFees).toBe(0);
          expect(result.results.find(row => row.feeVerifiedId === f.candidate.verifiedId)?.identityDeferred).toBe(true);
        }
        expect(transitioned).toBe(true);
      });
      expect(await observer`SELECT fee_published_id FROM published_fee_records WHERE institution_id=${f.institutionId}`).toHaveLength(0);
      expect(await observer`SELECT id FROM pipeline_attempts WHERE stage='publish' AND strategy='publish.rules'
        AND input_fingerprint=${`verified:${f.candidate.verifiedId}`}`).toHaveLength(0);
    } finally { await cleanup(f); }
  });
});
