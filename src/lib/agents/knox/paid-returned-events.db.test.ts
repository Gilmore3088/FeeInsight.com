// @vitest-environment node
/** Current-schema/FK tests. Only owned loopback fixtures are written; ordinary cases roll back. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { paidReturnedUnits, PAID_RETURNED_EVENT_FLAG, PAID_RETURNED_ELIGIBILITY_FLAG } from "@/lib/custom-report/paid-returned-events";

vi.mock("@/lib/agents/fee-source-fetch", async original => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Paid/returned native fixtures forbid source/provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
const SOURCE_URL = "https://paired-events.example.invalid/fees";
const OWN = "NSF Paid/Returned | $29.00 per presentment";
const CONSUMER = `Account Fee Schedule\nConsumer Checking Fees\n${OWN}\nStop Payment Fee | $25.00 per item`;
const CASCADE = readFileSync(new URL("./fixtures/cascade-paid-returned-13277.txt", import.meta.url), "utf8");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Interstatement state change, not a claim of independent-session contention. */
function intercept(tx: Db, before: (sql: string) => Promise<void>): Db {
  return new Proxy(tx, {
    apply: async (target, _receiver, args) => {
      await before((args[0] as TemplateStringsArray).join(" "));
      return Reflect.apply(target, target, args);
    },
    get: (target, property) => {
      const value = Reflect.get(target, property);
      if ((property === "savepoint" || property === "begin") && typeof value === "function") {
        return (work: (scope: Db) => Promise<unknown>) =>
          (value as (work: (scope: Db) => Promise<unknown>) => Promise<unknown>)
            .call(target, scope => work(intercept(scope, before)));
      }
      return value;
    },
  });
}

describe.skipIf(!connection)("Prospective owned paid/returned events in actual PostgreSQL (#1918)", () => {
  let db: postgres.Sql, competitor: postgres.Sql, observer: postgres.Sql, appSql: Db;
  let extract: typeof import("./extract");
  let darwin: typeof import("../darwin/verify");
  let publish: typeof import("../hamilton/publish");
  let emptyLessons: typeof import("./takedown-lessons").emptyTakedownLessons;
  let nextRunId = -191_850_000 - process.pid * 10;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new globalThis.URL(connection).hostname))
      throw new Error("Paid/returned tests require an owned disposable loopback database");
    vi.stubEnv("DATABASE_URL", connection);
    const m = await import("@/lib/data-store/connection");
    appSql = m.sql;
    const options = { max: 1, ssl: "require" as const, types: {
      numeric: m.NUMERIC_AS_NUMBER, json: m.JSON_TEXT_PASSTHROUGH, text: m.TEXT_WITHOUT_NUL,
    } };
    db = postgres(connection, options);
    competitor = postgres(connection, options);
    observer = postgres(connection, options);
    extract = await import("./extract");
    darwin = await import("../darwin/verify");
    publish = await import("../hamilton/publish");
    ({ emptyTakedownLessons: emptyLessons } = await import("./takedown-lessons"));
  }, 30_000);
  afterAll(async () => {
    for (const client of [db, competitor, observer, appSql]) if (client) await client.end();
    vi.unstubAllEnvs();
  });

  async function rollback(work: (tx: Db) => Promise<void>) {
    const stop = new Error("rollback paid/returned fixture");
    await db.begin(async scope => { await work(scope as unknown as Db); throw stop; })
      .catch(error => { if (error !== stop) throw error; });
  }
  async function seed(tx: Db, text = CONSUMER) {
    const [{ id: institutionId }] = await tx`INSERT INTO institution_sources
      (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
      VALUES ('Synthetic paired-event fixture','https://paired-events.example.invalid/',${SOURCE_URL},
        'bank','Wisconsin','WI',500000,'e2e','active') RETURNING id`;
    const [{ id: runId }] = await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
      VALUES (${nextRunId--},'knox','state_agent','Paired-event native fixture','running') RETURNING id`;
    const hash = digest(text);
    const [{ id: documentId }] = await tx`INSERT INTO source_documents(institution_id,status,document_url,content_hash,content_type)
      VALUES (${institutionId},'success',${SOURCE_URL},${hash},'text/plain') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,status,source_hash,normalized_text,text_hash,char_count)
      VALUES (${runId},${documentId},${institutionId},${SOURCE_URL},'completed',${hash},${text},${hash},${text.length}) RETURNING id`;
    const [{ id: stepId }] = await tx`INSERT INTO agent_run_steps(agent_run_id,step_key,agent_name,title,status)
      VALUES (${runId},'verify','darwin','Paired-event native fixture','running') RETURNING id`;
    return { institutionId: Number(institutionId), runId: Number(runId), documentId: Number(documentId),
      textId: Number(textId), stepId: Number(stepId), hash, text };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;
  const rowOf = (f: Fixture) => ({ document_text_id: f.textId, source_document_id: f.documentId,
    institution_id: f.institutionId, source_url: SOURCE_URL, text_hash: f.hash, normalized_text: f.text });
  function candidate(f: Fixture, action: "paid" | "returned" = "paid") {
    const unit = paidReturnedUnits(f.text)[0], event = unit.events.find(item => item.action === action)!;
    return { feeName: event.name, amount: unit.amount, canonicalHint: event.canonicalKey, frequency: unit.frequency,
      lineShare: event.lineShare, confidence: .95, excerpt: "untrusted caller quote", waivable: false };
  }
  const insert = (tx: Db, f: Fixture, action: "paid" | "returned" = "paid") =>
    extract.insertCandidate(tx, { runId: f.runId, row: rowOf(f), candidate: candidate(f, action) });
  async function pair(tx: Db, f: Fixture) {
    return [await insert(tx, f), await insert(tx, f, "returned")];
  }
  const raw = (tx: Db, f: Fixture) => tx`SELECT * FROM raw_fee_observations
    WHERE institution_id=${f.institutionId} ORDER BY fee_raw_id`;
  async function beforeAndAfter(tx: Db, f: Fixture, work: () => Promise<unknown>) {
    const before = await tx`SELECT to_jsonb(fr)::text AS state FROM raw_fee_observations fr WHERE institution_id=${f.institutionId} ORDER BY fee_raw_id`;
    await work();
    expect(await tx`SELECT to_jsonb(fr)::text AS state FROM raw_fee_observations fr WHERE institution_id=${f.institutionId} ORDER BY fee_raw_id`).toEqual(before);
  }
  async function oldRaw(tx: Db, f: Fixture, producer = "knox", flags = ["canonical_hint:nsf", "needs_darwin_verification"]) {
    const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
      (institution_id,source_document_id,source_url,source,agent_event_id,fee_name,amount,frequency,conditions,extraction_note,outlier_flags,fee_audience)
      VALUES (${f.institutionId},${f.documentId},${SOURCE_URL},${producer},gen_random_uuid(),'NSF Paid/Returned',29,'per_item',
        ${OWN},${`Knox deterministic extraction from Rosetta artifact #${f.textId}. canonical_hint=nsf; text_hash=${f.hash}; excerpt="${OWN}"`},
        ${JSON.stringify(flags)}::jsonb,'consumer') RETURNING fee_raw_id`;
    return Number(rawId);
  }

  it("actual source free extraction preserves two eligibility-held Cascade observations", async () => {
    await rollback(async tx => {
      const f = await seed(tx, CASCADE);
      expect(f.hash).toBe("6f72e9caaeebf46e62aad1ff66f50b582e78b8c8af2a07a38f50d76f8c95b396");
      const result = await extract.runKnoxExtract({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 10 });
      const rows = (await raw(tx, f)).filter(item => item.outlier_flags.includes(PAID_RETURNED_EVENT_FLAG));
      expect(rows.map(item => [item.fee_name, item.amount, item.frequency])).toEqual([["NSF - Paid", 29, "per_item"], ["NSF - Returned", 29, "per_item"]]);
      expect(rows.every(item => item.outlier_flags.includes(PAID_RETURNED_ELIGIBILITY_FLAG)
        && !item.outlier_flags.includes("needs_darwin_verification"))).toBe(true);
      expect(rows.every(item => item.conditions.includes("Pathfinder & Business Checking Fees") && item.conditions.includes(OWN))).toBe(true);
      expect(result.results.reduce((count, item) => count + item.inserted + item.heldInserted, 0)).toBeGreaterThanOrEqual(2);
      for (const item of rows) {
        await expect(darwin.insertVerifiedFee(tx, { runId: f.runId, row: { ...item, conditions: item.extraction_note ?? item.conditions } as unknown as import("../darwin/verify").RawFeeRow,
          canonicalFeeKey: item.fee_name.endsWith("Paid") ? "overdraft" : "nsf" })).rejects.toMatchObject({ reason: "paid_returned_eligibility" });
      }
      expect(await tx`SELECT 1 FROM verified_fee_observations WHERE fee_raw_id=ANY(${rows.map(item => Number(item.fee_raw_id))}::bigint[])`).toHaveLength(0);
    });
  });

  it("runs fresh consumer raw→ordinary Darwin→Hamilton and shared source/rules owners without a guard exception", async () => {
    await rollback(async tx => {
      const f = await seed(tx);
      const extraction = await extract.runKnoxExtract({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 10 });
      expect(extraction.insertedFees).toBe(3);
      const verification = await darwin.runDarwinVerify({ db: tx, runId: f.runId, stepId: f.stepId, institutionId: f.institutionId, limit: 100 });
      expect(verification.verifiedFees).toBe(3);
      const publication = await publish.runHamiltonPublish({ db: tx, runId: f.runId, stepId: f.stepId, institutionId: f.institutionId, minInstitutionFees: 1, limit: 100 });
      expect(publication.publishedFees).toBe(3);
      const rows = await tx`SELECT c.fee_name,c.canonical_fee_key,c.amount,c.frequency,c.fee_audience,c.conditions,c.source_document_id,
          fr.line_share,fr.extraction_note FROM published_fee_catalog c JOIN raw_fee_observations fr ON fr.fee_raw_id=c.fee_raw_id
        WHERE c.institution_id=${f.institutionId} AND c.amount=29 ORDER BY c.canonical_fee_key`;
      expect(rows.map(item => [item.fee_name, item.canonical_fee_key, item.amount, item.frequency, item.fee_audience]))
        .toEqual([["NSF - Returned", "nsf", 29, "per_item", "consumer"], ["NSF - Paid", "overdraft", 29, "per_item", "consumer"]]);
      expect(rows.every(item => item.conditions.includes(OWN) && item.conditions.includes("Consumer Checking Fees")
        && Number(item.source_document_id) === f.documentId && item.extraction_note.includes(`text_hash=${f.hash};`))).toBe(true);
      const rules = await (await import("../hamilton/rules-recheck")).rollBackUnreproducedFees(tx,
        { runId: f.runId, stepId: f.stepId, institutionId: f.institutionId, batchId: "paired-rules", dryRun: false });
      const source = await (await import("../hamilton/source-check")).takeDownUntraceableFees(tx,
        { runId: f.runId, stepId: f.stepId, institutionId: f.institutionId, batchId: "paired-source", dryRun: false });
      expect(rules.liveFeesChecked).toBeGreaterThanOrEqual(2);
      expect(rules.rollbacks).toEqual([]);
      expect(source.liveFeesChecked).toBeGreaterThanOrEqual(2);
      expect(source.traced).toBeGreaterThanOrEqual(2);
      expect(source.takedowns).toEqual([]);
      expect(await tx`SELECT 1 FROM published_fee_catalog WHERE institution_id=${f.institutionId} AND amount=29`).toHaveLength(2);
      expect(await pair(tx, f)).toEqual([false, false]);
      expect((await raw(tx, f)).filter(item => item.amount === 29)).toHaveLength(2);
    });
  }, 30_000);

  it("recomputes source facts in learning and held entry points instead of trusting caller fields", async () => {
    await rollback(async tx => {
      const f = await seed(tx, CONSUMER.replace("Consumer Checking Fees", "Consumer Checking with Direct Deposit Fees"));
      const receipt = await extract.insertCandidateWithLearning(tx, { runId: f.runId, row: rowOf(f),
        candidate: { ...candidate(f), frequency: "monthly", linkedConditions: "fabricated general applicability" },
        extraFlags: ["needs_darwin_verification", "knox_lesson:invented"] }, emptyLessons());
      expect(receipt.inserted).toBe(true); expect(receipt.takenDownBy).toBeNull();
      const returned = candidate(f, "returned");
      expect(await extract.insertHeldCandidate(tx, { runId: f.runId, row: rowOf(f), held: {
        ...returned, shape: "eligibility", amountMax: null, percent: null,
      } })).toBe(true);
      const rows = await raw(tx, f);
      expect(rows).toHaveLength(2);
      expect(rows.every(item => item.frequency === "per_item" && item.outlier_flags.includes(PAID_RETURNED_ELIGIBILITY_FLAG)
        && !item.outlier_flags.includes("needs_darwin_verification") && !item.conditions.includes("fabricated"))).toBe(true);
    });
  });

  it.each(["For accounts enrolled in direct deposit", "Subject to account qualifications", "3 items maximum per day"])
    ("retains following %s as unresolved context, never an unconditional price or daily frequency", async qualifier => {
      await rollback(async tx => {
        const f = await seed(tx, CONSUMER.replace(OWN, `${OWN}\n${qualifier}`));
        expect(await pair(tx, f)).toEqual([true, true]);
        const rows = await raw(tx, f);
        expect(rows).toHaveLength(2);
        expect(rows.every(item => item.conditions.includes(OWN) && item.conditions.includes(qualifier)
          && item.frequency === "per_item" && item.outlier_flags.includes(PAID_RETURNED_ELIGIBILITY_FLAG)
          && !item.outlier_flags.includes("needs_darwin_verification"))).toBe(true);
      });
    });

  it.each(["knox", "manual_import", "migration_v10"])("keeps legacy same-unit %s history byte-equivalent", async producer => {
    await rollback(async tx => {
      const f = await seed(tx); await oldRaw(tx, f, producer);
      await beforeAndAfter(tx, f, async () => expect(await pair(tx, f)).toEqual([false, false]));
    });
  });
  it.each(["held", "other_flag", "other_producer", "attempted", "verified", "published", "closed", "quarantined", "corrected"])("does not use derived names to escape %s lineage", async state => {
    await rollback(async tx => {
      const f = await seed(tx); expect(await insert(tx, f)).toBe(true);
      const [item] = await raw(tx, f);
      if (state === "held") await tx`UPDATE raw_fee_observations SET outlier_flags='["knox_review:untraced"]'::jsonb WHERE fee_raw_id=${item.fee_raw_id}`;
      if (state === "other_flag") await tx`UPDATE raw_fee_observations SET outlier_flags=outlier_flags||'["rejected"]'::jsonb WHERE fee_raw_id=${item.fee_raw_id}`;
      if (state === "other_producer") await tx`UPDATE raw_fee_observations SET source='manual_import' WHERE fee_raw_id=${item.fee_raw_id}`;
      if (state === "attempted") await tx`INSERT INTO pipeline_attempts(institution_id,source_document_id,stage,strategy,strategy_version,input_fingerprint,outcome,yield_count,cost_microusd,agent_run_id)
        VALUES (${f.institutionId},${f.documentId},'verify','verify.rules',3,${`raw:${item.fee_raw_id}`},'rejected',0,0,${f.runId})`;
      if (["verified", "published", "closed", "quarantined", "corrected"].includes(state)) {
        const verifiedId = await darwin.insertVerifiedFee(tx, { runId: f.runId, row: { ...item, conditions: item.extraction_note ?? item.conditions } as unknown as import("../darwin/verify").RawFeeRow, canonicalFeeKey: "overdraft" });
        expect(verifiedId).not.toBeNull();
        if (state !== "verified") {
          const [verified] = await tx`SELECT fv.*,to_jsonb(fv)::text AS selected_verified_state,fr.product_name,fr.source_document_id
            FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id WHERE fv.fee_verified_id=${verifiedId!}`;
          const id = await publish.insertPublishedFee(tx, { runId: f.runId, batchId: "paired-history", row: verified as unknown as import("../hamilton/publish").VerifiedFeeRow });
          expect(id).not.toBeNull();
          if (state === "closed") await tx`UPDATE published_fee_records SET rolled_back_at=now(),rolled_back_reason='fixture historical closure' WHERE fee_published_id=${id!}`;
          if (state === "quarantined") await tx`UPDATE published_fee_records SET quarantined_at=now(),quarantine_reason='admin_hold:fixture' WHERE fee_published_id=${id!}`;
          if (state === "corrected") await tx`INSERT INTO published_fee_corrections
            (fee_chain_id,version,action,institution_id,fee_audience,previous_fee_published_id,fee_published_id,
              before_canonical_fee_key,before_fee_name,before_amount,canonical_fee_key,fee_name,amount,frequency,
              source_document_id,source_excerpt,source_location,reason,actor_user_id,actor_name,idempotency_key,agent_run_id)
            VALUES (${id!},1,'correct',${f.institutionId},'consumer',${id!},${id!},'overdraft','NSF - Paid',29,
              'overdraft','NSF - Paid',29,'per_item',${f.documentId},${OWN},'line 3','Synthetic owned correction',
              1,'Fixture actor',${`paired-correction-${id}`},${f.runId})`;
        }
      }
      await beforeAndAfter(tx, f, async () => expect(await insert(tx, f, "returned")).toBe(false));
      expect(await raw(tx, f)).toHaveLength(1);
    });
  });

  it.each(["failed_document", "superseded_document", "duplicate_document", "failed_text", "hash", "owner", "missing_artifact"])
    ("cannot initially admit known unavailable source: %s", async state => {
      await rollback(async tx => {
        const f = await seed(tx), options = { runId: f.runId, row: rowOf(f), candidate: candidate(f) };
        if (state === "failed_document") await tx`UPDATE source_documents SET status='failed' WHERE id=${f.documentId}`;
        if (state === "superseded_document" || state === "duplicate_document") {
          const [{ id }] = await tx`INSERT INTO source_documents(institution_id,status,document_url,content_hash)
            VALUES (${f.institutionId},'success','https://paired-events.example.invalid/new',${f.hash}) RETURNING id`;
          if (state === "superseded_document") await tx`UPDATE source_documents SET superseded_by_id=${id} WHERE id=${f.documentId}`;
          else await tx`UPDATE source_documents SET duplicate_of_id=${id} WHERE id=${f.documentId}`;
        }
        if (state === "failed_text") await tx`UPDATE agent_source_texts SET status='failed' WHERE id=${f.textId}`;
        if (state === "hash") options.row.text_hash = "0".repeat(64);
        if (state === "owner") options.row.institution_id += 999999;
        if (state === "missing_artifact") options.row.document_text_id += 999999;
        expect(await extract.insertCandidate(tx, options)).toBe(false);
        expect(await raw(tx, f)).toHaveLength(0);
      });
    });

  it.each(["document_status", "source_text", "legacy_product", "legacy_lineage"])("defers a changed %s between selection and source/raw locks", async change => {
    await rollback(async tx => {
      const f = await seed(tx); let changed = false;
      const wrapped = intercept(tx, async sql => {
        if (changed || !sql.includes("SELECT id FROM source_documents")) return;
        changed = true;
        if (change === "document_status") await tx`UPDATE source_documents SET status='failed' WHERE id=${f.documentId}`;
        if (change === "source_text") await tx`UPDATE agent_source_texts SET normalized_text=${f.text.replace("$29", "$37")},text_hash=${digest(f.text.replace("$29", "$37"))} WHERE id=${f.textId}`;
        if (change.startsWith("legacy")) {
          const id = await oldRaw(tx, f, "manual_import");
          if (change === "legacy_product") await tx`UPDATE raw_fee_observations SET product_name='Other Checking' WHERE fee_raw_id=${id}`;
          else await tx`UPDATE raw_fee_observations SET outlier_flags='["knox_review:eligibility"]'::jsonb WHERE fee_raw_id=${id}`;
        }
      });
      expect(await insert(wrapped, f)).toBe(false); expect(changed).toBe(true);
      expect((await raw(tx, f)).filter(item => item.outlier_flags.includes(PAID_RETURNED_EVENT_FLAG))).toHaveLength(0);
    });
  });

  it("rolls back the new insert on a later writer error and retries without phantom inserted counts", async () => {
    await rollback(async tx => {
      const f = await seed(tx); const stop = new Error("controlled failure after RETURNING");
      await expect(tx.savepoint(async scope => {
        expect(await insert(scope as unknown as Db, f)).toBe(true); throw stop;
      })).rejects.toBe(stop);
      expect(await raw(tx, f)).toHaveLength(0);
      expect(await pair(tx, f)).toEqual([true, true]);
    });
  });

  it.each(["product", "frequency", "unit_key", "eligibility", "verified_status", "verified_amount"])
    ("publication leaves changed %s undecided with no movement or negative teaching", async change => {
      await rollback(async tx => {
        const f = await seed(tx); expect(await insert(tx, f)).toBe(true);
        const [item] = await raw(tx, f);
        expect(await darwin.insertVerifiedFee(tx, { runId: f.runId,
          row: { ...item, conditions: item.extraction_note } as unknown as import("../darwin/verify").RawFeeRow,
          canonicalFeeKey: "overdraft" })).not.toBeNull();
        const before = await tx`SELECT id FROM pipeline_attempts WHERE institution_id=${f.institutionId} AND stage='publish'`;
        const feedback = await tx`SELECT id FROM pipeline_feedback WHERE institution_id=${f.institutionId}`;
        let changed = false;
        const wrapped = intercept(tx, async sql => {
          if (changed || !sql.includes("SELECT fp.lineage_ref FROM published_fee_records fp")) return;
          changed = true;
          if (change === "product") await tx`UPDATE raw_fee_observations SET product_name='Different Checking' WHERE fee_raw_id=${item.fee_raw_id}`;
          if (change === "frequency") await tx`UPDATE raw_fee_observations SET frequency=NULL WHERE fee_raw_id=${item.fee_raw_id}`;
          if (change === "unit_key") await tx`UPDATE raw_fee_observations SET line_share='changed-source-unit' WHERE fee_raw_id=${item.fee_raw_id}`;
          if (change === "eligibility") await tx`UPDATE raw_fee_observations SET outlier_flags=outlier_flags||${JSON.stringify([PAID_RETURNED_ELIGIBILITY_FLAG])}::jsonb WHERE fee_raw_id=${item.fee_raw_id}`;
          if (change === "verified_status") await tx`UPDATE verified_fee_observations SET review_status='rejected' WHERE fee_raw_id=${item.fee_raw_id}`;
          if (change === "verified_amount") await tx`UPDATE verified_fee_observations SET amount=37 WHERE fee_raw_id=${item.fee_raw_id}`;
        });
        const result = await publish.runHamiltonPublish({ db: wrapped, runId: f.runId, stepId: f.stepId,
          institutionId: f.institutionId, limit: 100, minInstitutionFees: 1 });
        expect(changed).toBe(true); expect(result.publishedFees).toBe(0); expect(result.identityDeferredFees).toBe(1);
        expect(await tx`SELECT id FROM pipeline_attempts WHERE institution_id=${f.institutionId} AND stage='publish'`).toEqual(before);
        expect(await tx`SELECT id FROM pipeline_feedback WHERE institution_id=${f.institutionId}`).toEqual(feedback);
        expect(await tx`SELECT 1 FROM published_fee_records WHERE institution_id=${f.institutionId}`).toHaveLength(0);
        expect(await tx`SELECT 1 FROM fee_change_records WHERE institution_id=${f.institutionId}`).toHaveLength(0);
      });
    });

  it("an unchanged source-bound direct publisher succeeds, while changed source remains unknown", async () => {
    await rollback(async tx => {
      const f = await seed(tx); expect(await insert(tx, f)).toBe(true);
      const [item] = await raw(tx, f);
      const verifiedId = await darwin.insertVerifiedFee(tx, { runId: f.runId,
        row: { ...item, conditions: item.extraction_note } as unknown as import("../darwin/verify").RawFeeRow,
        canonicalFeeKey: "overdraft" });
      const [verified] = await tx`SELECT fv.*,to_jsonb(fv)::text AS selected_verified_state,fr.product_name,fr.source_document_id
        FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id WHERE fv.fee_verified_id=${verifiedId!}`;
      const options = { runId: f.runId, batchId: "paired-direct", row: verified as unknown as import("../hamilton/publish").VerifiedFeeRow };
      const stop = new Error("rollback changed original source");
      await tx.savepoint(async scope => {
        const inner = scope as unknown as Db;
        const changed = f.text.replace("Consumer Checking Fees", "Premium Checking Fees");
        await inner`UPDATE agent_source_texts SET normalized_text=${changed},text_hash=${digest(changed)} WHERE id=${f.textId}`;
        expect(await publish.insertPublishedFee(inner, options)).toBeNull();
        throw stop;
      }).catch(error => { if (error !== stop) throw error; });
      expect(await publish.insertPublishedFee(tx, options)).not.toBeNull();
      expect(await tx`SELECT 1 FROM published_fee_records WHERE institution_id=${f.institutionId}`).toHaveLength(1);
    });
  });

  async function committedFixture() { return db.begin(scope => seed(scope as unknown as Db)); }
  async function cleanCommitted(f: Fixture) {
    await observer.begin(async scope => {
      const tx = scope as unknown as Db;
      const owner = await tx`SELECT id FROM institution_sources WHERE id=${f.institutionId}
        AND institution_name='Synthetic paired-event fixture' AND website_url='https://paired-events.example.invalid/'`;
      expect(owner).toHaveLength(1);
      await tx`DELETE FROM pipeline_attempts WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM pipeline_feedback WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM fee_change_records WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM published_fee_records WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM verified_fee_observations WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM agent_run_events WHERE agent_run_id=${f.runId}`;
      await tx`DELETE FROM agent_run_steps WHERE agent_run_id=${f.runId}`;
      await tx`DELETE FROM agent_source_texts WHERE id=${f.textId} AND institution_id=${f.institutionId}`;
      await tx`DELETE FROM source_documents WHERE id=${f.documentId} AND institution_id=${f.institutionId}`;
      await tx`DELETE FROM agent_runs WHERE id=${f.runId} AND title='Paired-event native fixture'`;
      await tx`DELETE FROM institution_sources WHERE id=${f.institutionId} AND institution_name='Synthetic paired-event fixture'`;
      expect(await tx`SELECT 1 FROM institution_sources WHERE id=${f.institutionId}`).toHaveLength(0);
    });
  }
  function signal<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
  }

  it.each(["document", "artifact", "raw"])("independent %s lock contention declines, preserves current state, and retries", async locked => {
    const f = await committedFixture();
    const ready = signal<void>(), release = signal<void>(); let task: Promise<unknown> | undefined;
    try {
      if (locked === "raw") await db.begin(scope => oldRaw(scope as unknown as Db, f, "manual_import"));
      task = competitor.begin(async scope => {
        const tx = scope as unknown as Db;
        if (locked === "document") await tx`SELECT id FROM source_documents WHERE id=${f.documentId} FOR UPDATE`;
        if (locked === "artifact") await tx`SELECT id FROM agent_source_texts WHERE id=${f.textId} FOR UPDATE`;
        if (locked === "raw") await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE institution_id=${f.institutionId} FOR UPDATE`;
        ready.resolve(); await release.promise;
      });
      await ready.promise;
      expect(await db.begin(scope => insert(scope as unknown as Db, f))).toBe(false);
      expect((await raw(observer as unknown as Db, f)).filter(item => item.outlier_flags.includes(PAID_RETURNED_EVENT_FLAG))).toHaveLength(0);
      release.resolve(); await task;
      if (locked === "raw") expect(await db.begin(scope => insert(scope as unknown as Db, f))).toBe(false);
      else expect(await db.begin(scope => insert(scope as unknown as Db, f))).toBe(true);
    } finally { release.resolve(); if (task) await task; await cleanCommitted(f); }
  }, 10_000);

  it.each(["product", "unit", "lineage"])("publication compares selected %s after a real independent lock wait", async change => {
    const f = await committedFixture();
    const ready = signal<number>(), release = signal<void>(), waiting = signal<number>();
    let writer: Promise<unknown> | undefined, publication: Promise<unknown> | undefined;
    try {
      const selected = await db.begin(async scope => {
        const tx = scope as unknown as Db;
        expect(await insert(tx, f)).toBe(true);
        const [item] = await raw(tx, f);
        const verifiedId = await darwin.insertVerifiedFee(tx, { runId: f.runId,
          row: { ...item, conditions: item.extraction_note } as unknown as import("../darwin/verify").RawFeeRow,
          canonicalFeeKey: "overdraft" });
        expect(verifiedId).not.toBeNull();
        return { rawId: Number(item.fee_raw_id), verifiedId: verifiedId! };
      });
      writer = competitor.begin(async scope => {
        const tx = scope as unknown as Db;
        await tx`SET LOCAL lock_timeout='5s'`;
        const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
        if (change === "lineage") {
          await tx`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_verified_id=${selected.verifiedId} FOR UPDATE`;
          const [{ fee_raw_id }] = await tx`INSERT INTO raw_fee_observations
            (institution_id,source_document_id,source_url,source,agent_event_id,fee_name,amount,frequency,outlier_flags,fee_audience,line_share)
            VALUES (${f.institutionId},${f.documentId},${SOURCE_URL},'manual_import',gen_random_uuid(),
              'Different fee lineage',29,'per_item','[]'::jsonb,'consumer','fixture-replacement') RETURNING fee_raw_id`;
          await tx`UPDATE verified_fee_observations SET fee_raw_id=${fee_raw_id} WHERE fee_verified_id=${selected.verifiedId}`;
        } else {
          await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=${selected.rawId} FOR UPDATE`;
          if (change === "product") await tx`UPDATE raw_fee_observations SET product_name='Other Checking' WHERE fee_raw_id=${selected.rawId}`;
          else await tx`UPDATE raw_fee_observations SET line_share='changed-unit',frequency=NULL WHERE fee_raw_id=${selected.rawId}`;
        }
        ready.resolve(Number(pid)); await release.promise;
      });
      const blocker = await ready.promise;
      publication = db.begin(async scope => {
        const tx = scope as unknown as Db;
        await tx`SET LOCAL lock_timeout='5s'`;
        const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
        waiting.resolve(Number(pid));
        return publish.runHamiltonPublish({ db: tx, runId: f.runId, stepId: f.stepId,
          institutionId: f.institutionId, minInstitutionFees: 1, limit: 100 });
      });
      const pid = await waiting.promise;
      let observed = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        const [{ blockers }] = await observer<{ blockers: number[] }[]>`SELECT pg_blocking_pids(${pid}) AS blockers`;
        if (blockers.includes(blocker)) { observed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(observed).toBe(true);
      release.resolve(); await writer;
      const result = await publication as Awaited<ReturnType<typeof publish.runHamiltonPublish>>;
      expect(result.publishedFees).toBe(0); expect(result.identityDeferredFees).toBe(1);
      expect(await observer`SELECT 1 FROM published_fee_records WHERE institution_id=${f.institutionId}`).toHaveLength(0);
      expect(await observer`SELECT 1 FROM pipeline_attempts WHERE institution_id=${f.institutionId} AND stage='publish'`).toHaveLength(0);
      expect(await observer`SELECT 1 FROM pipeline_feedback WHERE institution_id=${f.institutionId}`).toHaveLength(0);
      expect(await observer`SELECT 1 FROM fee_change_records WHERE institution_id=${f.institutionId}`).toHaveLength(0);
    } finally {
      release.resolve();
      if (writer) await writer.catch(() => {});
      if (publication) await publication.catch(() => {});
      await cleanCommitted(f);
    }
  }, 10_000);
});
