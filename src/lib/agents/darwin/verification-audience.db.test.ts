// @vitest-environment node
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { trainCategoryModel } from "./category-model";
import {
  admittedRawMatches, completeAudienceAdmission, prepareVerificationAudience,
  } from "./verification-audience";
import type { RawFeeRow } from "./verify";

vi.mock("@/lib/agents/fee-source-fetch", async original => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Audience SQL fixtures forbid network/provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
type Fixture = { institutionId: number; documentId: number; artifactId: number; rawId: number; runId: number; text: string };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const own = "Check Images\n• $10.00 (Consumer Only) per statement";

describe.skipIf(!connection)("prospective own-price audience admission in real PostgreSQL (#2342)", () => {
  let db: postgres.Sql;
  let appSql: Db;
  let verify: typeof import("./verify");
  let release: typeof import("./release-held");
  let nextRun = -234_200_000 - process.pid * 100;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Audience fixtures require a disposable loopback database");
    }
    vi.stubEnv("DATABASE_URL", connection);
    const connectionModule = await import("@/lib/data-store/connection");
    appSql = connectionModule.sql;
    db = postgres(connection, { max: 2, ssl: "require", types: {
      numeric: connectionModule.NUMERIC_AS_NUMBER, json: connectionModule.JSON_TEXT_PASSTHROUGH, text: connectionModule.TEXT_WITHOUT_NUL,
    } });
    verify = await import("./verify");
    release = await import("./release-held");
  });
  afterAll(async () => {
    if (db) await db.end();
    if (typeof appSql?.end === "function") await appSql.end();
    vi.unstubAllEnvs();
  });
  async function rolledBack(work: (tx: Db) => Promise<void>) {
    const rollback = new Error("rollback owned audience fixture");
    await db.begin(async scope => {
      // The base CI schema installs migration40. Exercise the already-released Darwin
      // trigger47 transactionally; rollback restores the shared fixture's original DDL.
      await scope.unsafe(readFileSync(new URL("../../../../supabase/migrations/20270110000047_darwin_audience_decision.sql", import.meta.url), "utf8"));
      await work(scope as unknown as Db);
      throw rollback;
    })
      .catch(error => { if (error !== rollback) throw error; });
  }
  async function seed(tx: Db, text = own, audience = "unknown"): Promise<Fixture> {
    const [institution] = await tx`INSERT INTO institution_sources
      (institution_name,source,status,website_url,state_code,charter_type)
      VALUES ('Audience owned fixture','e2e','active','https://audience.example.test','WI','bank') RETURNING id`;
    const institutionId = Number(institution.id);
    const [run] = await tx`INSERT INTO agent_runs (id,agent_name,run_kind,title,status)
      VALUES (${nextRun--},'darwin','state_agent','Audience owned SQL fixture','running') RETURNING id`;
    const [document] = await tx`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type)
      VALUES (${institutionId},'success','https://audience.example.test/fees.pdf',${hash("source bytes")},'application/pdf') RETURNING id`;
    const [artifact] = await tx`INSERT INTO agent_source_texts
      (source_document_id,institution_id,source_url,source_hash,status,normalized_text,text_hash,char_count)
      VALUES (${document.id},${institutionId},'https://audience.example.test/fees.pdf',${hash("source bytes")},
      'completed',${text},${hash(text)},${text.length}) RETURNING id`;
    const note = `Knox deterministic extraction from Rosetta artifact #${artifact.id}. canonical_hint=check_image; text_hash=${hash(text)}; excerpt="${text}"`;
    const [raw] = await tx`INSERT INTO raw_fee_observations
      (institution_id,agent_event_id,source,fee_name,amount,frequency,source_url,source_document_id,
       conditions,extraction_note,fee_audience,audience_evidence,outlier_flags)
      VALUES (${institutionId},gen_random_uuid(),'knox','Check Images',10,'per_statement',
      'https://audience.example.test/fees.pdf',${document.id},${text},${note},${audience},${audience === "unknown" ? null : "Own fixture raw audience evidence"},
      jsonb_build_array('needs_darwin_verification','canonical_hint:check_image')) RETURNING fee_raw_id`;
    return { institutionId, documentId: Number(document.id), artifactId: Number(artifact.id), rawId: Number(raw.fee_raw_id), runId: Number(run.id), text };
  }
  async function selected(tx: Db, f: Fixture): Promise<RawFeeRow> {
    const [row] = await tx`SELECT fr.*,COALESCE(fr.extraction_note,fr.conditions) AS conditions
      FROM raw_fee_observations fr WHERE fee_raw_id=${f.rawId}`;
    return row as unknown as RawFeeRow;
  }
  const state = async (tx: Db, f: Fixture) => (await tx`SELECT to_jsonb(fr)::text AS value FROM raw_fee_observations fr WHERE fee_raw_id=${f.rawId}`)[0].value;
  const values = (tx: Db, f: Fixture) => tx`SELECT fee_audience,audience_evidence,frequency FROM verified_fee_observations WHERE fee_raw_id=${f.rawId}`;
  async function prior(tx: Db, f: Fixture, strategy: string, version: number, detail: Record<string, unknown>) {
    const { recordAttempt } = await import("../learning/attempts");
    await recordAttempt(tx, { institutionId: f.institutionId, stage: "verify", strategy, version,
      fingerprint: `raw:${f.rawId}`, outcome: "ok", yieldCount: 0, costMicrousd: 0,
      runId: f.runId, foldIntoPlaybook: false, detail });
  }
  /** Interleave an actual statement, never replace PostgreSQL execution/results. */
  function beforeRawRead(tx: Db, action: () => Promise<void>, fired = { value: false }): Db {
    const wrapped = async (strings: TemplateStringsArray, ...parameters: unknown[]) => {
      const text = strings.join("?");
      if (!fired.value && text.includes("SELECT fr.*") && text.includes("to_jsonb(fr)")) {
        fired.value = true;
        await action();
      }
      return tx(strings, ...parameters as postgres.ParameterOrFragment<never>[]);
    };
    Object.assign(wrapped, tx, { savepoint: (work: (scope: Db) => Promise<unknown>) =>
      (tx as unknown as { savepoint(work: (scope: Db) => Promise<unknown>): Promise<unknown> })
        .savepoint(scope => work(beforeRawRead(scope, action, fired))) });
    return wrapped as unknown as Db;
  }

  it("recomputes the own consumer decision instead of trusting a stale caller both decision", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const row = await selected(tx, f);
      const admission = await prepareVerificationAudience(tx, row);
      expect(admission.audience?.feeAudience).toBe("consumer");
      await verify.insertVerifiedFee(tx, { runId: f.runId, row: { ...row, fee_audience: "consumer" }, canonicalFeeKey: "check_image",
        audience: { feeAudience: "both", audienceEvidence: "darwin:stale caller" },
        audienceAdmission: completeAudienceAdmission(admission, "check_image") });
      expect(await values(tx, f)).toEqual([expect.objectContaining({ fee_audience: "consumer", frequency: "per_statement" })]);
    });
  });

  it("defers a direct own-clause call without completed admission and leaves raw/attempts unchanged", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const row = await selected(tx, f);
      const before = await state(tx, f);
      await expect(verify.insertVerifiedFee(tx, { runId: f.runId, row, canonicalFeeKey: "check_image" }))
        .rejects.toThrow("own_clause_requires_admission");
      expect(await values(tx, f)).toEqual([]);
      expect(await state(tx, f)).toBe(before);
      expect(await tx`SELECT id FROM pipeline_attempts WHERE institution_id=${f.institutionId}`).toEqual([]);
    });
  });

  it("preserves explicit ambiguous null through the actual audience trigger", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx, own + "\nCheck Images | $10.00 (Business Only) per statement");
      const row = await selected(tx, f);
      const admission = await prepareVerificationAudience(tx, row);
      expect(admission).toMatchObject({ ownClause: "ambiguous", audience: null });
      await verify.insertVerifiedFee(tx, { runId: f.runId, row, canonicalFeeKey: "check_image",
        audience: { feeAudience: "both", audienceEvidence: "darwin:forbidden fallback" },
        audienceAdmission: completeAudienceAdmission(admission, "check_image") });
      expect(await values(tx, f)).toEqual([expect.objectContaining({ fee_audience: "unknown", audience_evidence: null })]);
    });
  });

  it("preserves a known raw business label rather than relabeling it from a consumer clause", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx, own, "business");
      const row = await selected(tx, f);
      await verify.insertVerifiedFee(tx, { runId: f.runId, row, canonicalFeeKey: "check_image" });
      expect(await values(tx, f)).toEqual([expect.objectContaining({ fee_audience: "business" })]);
    });
  });

  it("keeps ordinary minimal direct calls usable without manufacturing an original header", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx, "Check Images | $10.00 per statement");
      await tx`UPDATE raw_fee_observations SET extraction_note='legacy unbound note' WHERE fee_raw_id=${f.rawId}`;
      const full = await selected(tx, f);
      const { fee_raw_id, institution_id, fee_name, amount } = full;
      const minimal = { fee_raw_id, institution_id, fee_name, amount } as RawFeeRow;
      expect(await verify.insertVerifiedFee(tx, { runId: f.runId, row: minimal, canonicalFeeKey: "check_image" })).toBeTypeOf("number");
    });
  });

  it("preserves the ordinary unavailable-source boundary without claiming proved qualifier absence", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx, "Check Images | $10.00 per statement");
      await tx`DELETE FROM agent_source_texts WHERE id=${f.artifactId}`;
      const row = await selected(tx, f);
      expect(await verify.insertVerifiedFee(tx, { runId: f.runId, row, canonicalFeeKey: "check_image" })).toBeTypeOf("number");
    });
  });

  it("defers unavailable own-source cues rather than replacing them with caller/title defaults", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      await tx`DELETE FROM agent_source_texts WHERE id=${f.artifactId}`;
      const before = await state(tx, f);
      const row = await selected(tx, f);
      await expect(prepareVerificationAudience(tx, row, "Consumer and Business Fee Schedule"))
        .rejects.toThrow("unavailable_missing_artifact");
      expect(await state(tx, f)).toBe(before);
      expect(await values(tx, f)).toEqual([]);
    });
  });

  it("keeps original-hash mismatch pending without normal attempts or feedback", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      await tx`UPDATE raw_fee_observations SET extraction_note='legacy note without original digest' WHERE fee_raw_id=${f.rawId}`;
      const before = await state(tx, f);
      const result = await verify.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId });
      expect(result).toMatchObject({ processedRawFees: 0, verifiedFees: 0, deferredRawFees: 1,
        deferrals: [{ feeRawId: f.rawId, reason: "no_original_hash" }] });
      expect(await state(tx, f)).toBe(before);
      expect(await tx`SELECT id FROM pipeline_attempts WHERE input_fingerprint=${`raw:${f.rawId}`}`).toEqual([]);
      expect(await tx`SELECT id FROM pipeline_feedback WHERE institution_id=${f.institutionId}`).toEqual([]);
    });
  });

  it("rechecks final current facts if a same-transaction source changes after outer admission", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx, "Check Images | $10.00 per statement");
      const row = await selected(tx, f);
      const admission = await prepareVerificationAudience(tx, row);
      expect(admission.ownClause).toBe("none");
      await tx`UPDATE agent_source_texts SET normalized_text=${own},text_hash=${hash(own)},char_count=${own.length} WHERE id=${f.artifactId}`;
      await expect(verify.insertVerifiedFee(tx, { runId: f.runId, row, canonicalFeeKey: "check_image",
        audienceAdmission: completeAudienceAdmission(admission, "check_image") }))
        .rejects.toThrow("original_binding_mismatch");
      expect(await values(tx, f)).toEqual([]);
    });
  });

  it("binds the admitted final category and refuses an altered derived write frequency", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const row = await selected(tx, f);
      const admission = await prepareVerificationAudience(tx, row);
      await expect(verify.insertVerifiedFee(tx, { runId: f.runId, row, canonicalFeeKey: "document_reproduction",
        audienceAdmission: completeAudienceAdmission(admission, "check_image") }))
        .rejects.toThrow("audience_admission_changed");
      await expect(verify.insertVerifiedFee(tx, { runId: f.runId, row: { ...row, frequency: "monthly" }, canonicalFeeKey: "check_image",
        audienceAdmission: completeAudienceAdmission(admission, "check_image") }))
        .rejects.toThrow("admitted_audience_changed");
      await expect(verify.insertVerifiedFee(tx, { runId: f.runId, row: { ...row, fee_audience: "consumer", frequency: "monthly" }, canonicalFeeKey: "check_image",
        audienceAdmission: completeAudienceAdmission(admission, "check_image") }))
        .rejects.toThrow("admitted_frequency_changed");
      expect(await values(tx, f)).toEqual([]);
    });
  });

  it("does not rejudge an already-verified historical audience or change its raw lineage", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      await tx`INSERT INTO verified_fee_observations
        (fee_raw_id,institution_id,verified_by_agent_event_id,fee_name,canonical_fee_key,amount,frequency,review_status,fee_audience,audience_evidence)
        VALUES (${f.rawId},${f.institutionId},gen_random_uuid(),'Check Images','check_image',10,'per_statement','verified','both','darwin:mixed_schedule_unqualified: historical context')`;
      const before = (await tx`SELECT to_jsonb(v)::text AS value FROM verified_fee_observations v WHERE fee_raw_id=${f.rawId}`)[0].value;
      const rawBefore = await state(tx, f);
      const result = await verify.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId });
      expect(result.selectedRawFees).toBe(0);
      expect((await tx`SELECT to_jsonb(v)::text AS value FROM verified_fee_observations v WHERE fee_raw_id=${f.rawId}`)[0].value).toBe(before);
      expect(await state(tx, f)).toBe(rawBefore);
    });
  });

  it("preserves actual ordinary conditional-zero resolution and defers an unbound own-clause zero", async () => {
    await rolledBack(async tx => {
      const { runDarwinConditionalZeroResolve } = await import("./conditional-zero-resolve");
      for (const text of ["Fee Schedule\nBill Pay: | Free", "Bill Pay | $0.00 (Consumer Only)"]) {
        const f = await seed(tx, text);
        const note = `Knox deterministic extraction from Rosetta artifact #${f.artifactId}. canonical_hint=bill_pay; text_hash=${hash(text)}; excerpt="${text}"`;
        await tx`UPDATE raw_fee_observations SET fee_name='Bill Pay',amount=0,frequency=NULL,conditions=${text},
          extraction_note=${text.includes("Consumer Only") ? "legacy unbound own clause" : note},
          outlier_flags='["needs_darwin_verification","canonical_hint:bill_pay"]'::jsonb WHERE fee_raw_id=${f.rawId}`;
        const { recordAttempt } = await import("../learning/attempts");
        await recordAttempt(tx, { institutionId: f.institutionId, stage: "verify", strategy: verify.DARWIN_VERIFY_STRATEGY.strategy,
          version: verify.DARWIN_VERIFY_STRATEGY.version, fingerprint: `raw:${f.rawId}`, outcome: "rejected", yieldCount: 0,
          costMicrousd: 0, runId: f.runId, foldIntoPlaybook: false,
          detail: { decision: "needs_review", reason_code: "conditional_zero", canonical_fee_key: "bill_pay" } });
        const before = await state(tx, f);
        const countBefore = (await tx`SELECT count(*)::int AS count FROM pipeline_attempts WHERE input_fingerprint=${`raw:${f.rawId}`}`)[0].count;
        const result = await runDarwinConditionalZeroResolve({ db: tx, runId: f.runId, institutionId: f.institutionId });
        if (text.includes("Consumer Only")) {
          expect(result).toMatchObject({ selected: 1, deferred: 1, verified: 0, verdicts: {} });
          expect(await state(tx, f)).toBe(before);
          expect((await tx`SELECT count(*)::int AS count FROM pipeline_attempts WHERE input_fingerprint=${`raw:${f.rawId}`}`)[0].count).toBe(countBefore);
        } else {
          expect(result).toMatchObject({ selected: 1, verified: 1, verdicts: { conditional_zero_free_on_schedule: 1 } });
        }
      }
    });
  });

  it.each(["held", "paid_review", "recorded"] as const)("defers an unbound own clause before %s negative/hold settlement", async path => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const line = "Check Images | $10.00 (Consumer Only) per statement";
      const detail = { held_reason: "peer_outlier", canonical_fee_key: "account_research", source_line: line,
        source_context: own, verdict: "review", passes: true, acted: false };
      const reviews = await import("./release-review");
      if (path === "held") {
        await prior(tx, f, verify.DARWIN_VERIFY_STRATEGY.strategy, verify.DARWIN_VERIFY_STRATEGY.version,
          { decision: "needs_review", reason_code: "peer_outlier", canonical_fee_key: "account_research" });
      } else if (path === "paid_review") {
        await prior(tx, f, release.DARWIN_RELEASE_STRATEGY.strategy, release.DARWIN_RELEASE_STRATEGY.version, detail);
      } else {
        await prior(tx, f, reviews.DARWIN_RELEASE_REVIEW_STRATEGY.strategy, reviews.DARWIN_RELEASE_REVIEW_STRATEGY.version, detail);
      }
      await tx`UPDATE raw_fee_observations SET extraction_note='legacy own clause without original digest' WHERE fee_raw_id=${f.rawId}`;
      const before = await state(tx, f);
      const attemptsBefore = (await tx`SELECT count(*)::int AS count FROM pipeline_attempts WHERE input_fingerprint=${`raw:${f.rawId}`}`)[0].count;
      const category = await import("./category-model");
      const modelSpy = vi.spyOn(category, "loadCategoryModel").mockResolvedValue(trainCategoryModel([
        { name: "Check Images", categoryKey: "check_image", count: 20 },
      ]));
      const paid = await import("../paid-pass");
      // Only the response transport is replaced. No provider request/control activation occurs;
      // source/raw/admission/attempt SQL and the actual negative reviewer path remain real.
      const paidSpy = vi.spyOn(paid, "paidModelCall").mockResolvedValue({ costMicrousd: 0,
        message: { content: [{ type: "text", text: JSON.stringify({ verdicts: [
          { id: f.rawId, is_fee: false, category_fits: false, amount_is_price: false, reason: "negative accepted-response fixture" },
        ] }) }] } } as never);
      try {
        const result = path === "held"
          ? await release.runDarwinReleaseHeld({ db: tx, runId: f.runId, institutionId: f.institutionId })
          : path === "paid_review"
            ? await reviews.runDarwinReleaseReview({ db: tx, runId: f.runId, calls: 1, acts: false })
            : await reviews.releaseRecordedPasses(tx, { runId: f.runId, acts: true });
        expect(result.deferred).toBe(1);
        expect(await state(tx, f)).toBe(before);
        expect((await tx`SELECT count(*)::int AS count FROM pipeline_attempts WHERE input_fingerprint=${`raw:${f.rawId}`}`)[0].count).toBe(attemptsBefore);
        expect(await tx`SELECT id FROM pipeline_feedback WHERE institution_id=${f.institutionId}`).toEqual([]);
        expect(await values(tx, f)).toEqual([]);
        expect(paidSpy).toHaveBeenCalledTimes(path === "paid_review" ? 1 : 0);
      } finally {
        paidSpy.mockRestore();
        modelSpy.mockRestore();
      }
    });
  });

  it("defers a changed selected raw before a free held reject/second-look attempt", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      await prior(tx, f, verify.DARWIN_VERIFY_STRATEGY.strategy, verify.DARWIN_VERIFY_STRATEGY.version,
        { decision: "needs_review", reason_code: "peer_outlier", canonical_fee_key: "check_image" });
      const interleaved = beforeRawRead(tx, async () => { await tx`UPDATE raw_fee_observations SET amount=20 WHERE fee_raw_id=${f.rawId}`; });
      const result = await release.runDarwinReleaseHeld({ db: interleaved, runId: f.runId, institutionId: f.institutionId });
      expect(result).toMatchObject({ deferred: 1, decisions: [], verdicts: {},
        deferrals: [{ feeRawId: f.rawId, reason: "admitted_raw_changed" }] });
      // The consumer's row savepoint also rolls back the interleaved own fixture UPDATE.
      expect((await tx`SELECT amount FROM raw_fee_observations WHERE fee_raw_id=${f.rawId}`)[0].amount).toBe(10);
      expect((await tx`SELECT count(*)::int AS count FROM pipeline_attempts WHERE input_fingerprint=${`raw:${f.rawId}`}`)[0].count).toBe(1);
    });
  });

  it.each(["normal", "held"] as const)("keeps busy %s inputs pending with no ordinary decision", async path => {
    // Committed, uniquely owned identities make the opposing connection real. No global cleanup.
    const f = await seed(db as unknown as Db, "Check Images | $10.00 per statement");
    try {
      if (path === "held") {
        await db`UPDATE raw_fee_observations SET amount=20 WHERE fee_raw_id=${f.rawId}`;
        await prior(db as unknown as Db, f, verify.DARWIN_VERIFY_STRATEGY.strategy, verify.DARWIN_VERIFY_STRATEGY.version,
          { decision: "needs_review", reason_code: "peer_outlier", canonical_fee_key: "check_image" });
      }
      const before = await state(db as unknown as Db, f);
      const attemptsBefore = (await db`SELECT count(*)::int AS count FROM pipeline_attempts WHERE input_fingerprint=${`raw:${f.rawId}`}`)[0].count;
      await db.begin(async holderScope => {
        const holder = holderScope as unknown as Db;
        await holder`SELECT id FROM source_documents WHERE id=${f.documentId} FOR UPDATE`;
        await db.begin(async scope => {
          const tx = scope as unknown as Db;
          const result = path === "normal"
            ? await verify.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId })
            : await release.runDarwinReleaseHeld({ db: tx, runId: f.runId, institutionId: f.institutionId });
          if (path === "normal") expect(result).toMatchObject({ deferredRawFees: 1, results: [], outcomes: {} });
          else expect(result).toMatchObject({ deferred: 1, decisions: [], verdicts: {} });
          expect(await state(tx, f)).toBe(before);
          expect((await tx`SELECT count(*)::int AS count FROM pipeline_attempts WHERE input_fingerprint=${`raw:${f.rawId}`}`)[0].count).toBe(attemptsBefore);
          expect(await tx`SELECT id FROM pipeline_feedback WHERE institution_id=${f.institutionId}`).toEqual([]);
        });
      });
    } finally {
      await db.begin(async cleanupScope => {
        const tx = cleanupScope as unknown as Db;
        await tx`DELETE FROM pipeline_attempts WHERE institution_id=${f.institutionId}`;
        await tx`DELETE FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
        await tx`DELETE FROM agent_source_texts WHERE institution_id=${f.institutionId}`;
        await tx`DELETE FROM source_documents WHERE institution_id=${f.institutionId}`;
        await tx`DELETE FROM institution_sources WHERE id=${f.institutionId}`;
        await tx`DELETE FROM agent_runs WHERE id=${f.runId}`;
      });
    }
  });

  it.each(["fee_name", "amount", "frequency", "conditions", "outlier_flags"] as const)("defers stale supplied raw %s before granting own authority", async field => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const row = await selected(tx, f);
      const stale = { ...row, [field]: field === "amount" ? 20 : field === "outlier_flags" ? [] : "stale raw value" };
      await expect(prepareVerificationAudience(tx, stale)).rejects.toThrow("admitted_raw_changed");
      expect(await values(tx, f)).toEqual([]);
    });
  });

  it("does not confuse selected extraction-note evidence with the separately stored customer condition", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const row = await selected(tx, f);
      expect(row.conditions).toContain("Knox deterministic");
      const admission = await prepareVerificationAudience(tx, row);
      expect(admittedRawMatches(row, admission.row)).toBe(true);
      expect((await tx`SELECT conditions FROM raw_fee_observations WHERE fee_raw_id=${f.rawId}`)[0].conditions).toBe(own);
    });
  });

  it("preserves ordinary held release and binds a source-derived own-qualifier release frequency", async () => {
    await rolledBack(async tx => {
      const { frequencyFromLine } = await import("./release-review");
      const model = trainCategoryModel([{ name: "Check Images", categoryKey: "check_image", count: 20 }]);
      for (const text of ["Check Images | $10.00 per item", "Check Images\n• $10.00 (Consumer Only) per item"]) {
        const f = await seed(tx, text);
        await tx`UPDATE raw_fee_observations SET frequency=NULL WHERE fee_raw_id=${f.rawId}`;
        const original = { ...await selected(tx, f), held_reason: "peer_outlier" as const, held_canonical_fee_key: "check_image" };
        const line = "Check Images | $10.00 (Consumer Only) per item";
        const released = await release.releaseHeldFee(tx, { runId: f.runId,
          row: { ...original, frequency: frequencyFromLine(line, 10) }, originalRow: original,
          sourceLine: line, sourceText: text, categoryModel: model, frequencyFromSourceLine: frequencyFromLine });
        expect(released.feeVerifiedId).toBeTypeOf("number");
        expect(await values(tx, f)).toEqual([expect.objectContaining({ frequency: "per_item" })]);
      }
    });
  });

  it("runs the real complete Oakwood extraction→Darwin→publication path with consumer Check Images", async () => {
    await rolledBack(async tx => {
      const text = readFileSync(new URL("../knox/__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
      expect(hash(text)).toBe("dc6eb4136b9e193c6b9c250ba56e74499b1b8d29f3276658e6bdd81af9241ccc");
      const f = await seed(tx, text);
      await tx`DELETE FROM raw_fee_observations WHERE fee_raw_id=${f.rawId}`;
      const { runKnoxExtract } = await import("../knox/extract");
      const { runHamiltonPublish } = await import("../hamilton/publish");
      await runKnoxExtract({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 10 });
      const result = await verify.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100 });
      expect(result.deferrals).toEqual([]);
      await runHamiltonPublish({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100, minInstitutionFees: 1 });
      const rows = await tx`SELECT fee_name,amount,frequency,fee_audience,audience_evidence FROM published_fee_records
        WHERE institution_id=${f.institutionId} AND fee_name='Check Images' AND rolled_back_at IS NULL`;
      expect(rows).toEqual([expect.objectContaining({ amount: 10, frequency: "per_statement", fee_audience: "consumer",
        audience_evidence: expect.stringContaining("darwin:fee_exclusive_price_clause:") })]);
    });
  });
});
