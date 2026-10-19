// @vitest-environment node
/** Accepted paid-shaped input, actual shared writer and normal stages; loopback rollback only. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/fee-source-fetch", async original => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Symbolic formula SQL fixtures forbid network/provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
const FLAG = "knox_eligibility:symbolic_lesser";
const OWN = "Late Payment Fee | $10.00 each billing period or amount of minimum payment, whichever is less";
const TEXT = readFileSync(new URL("./__fixtures__/woodlawn-symbolic-lesser-source.txt", import.meta.url), "utf8");

describe.skipIf(!connection)("Symbolic lesser-of source eligibility in actual PostgreSQL (#2335)", () => {
  let db: postgres.Sql, appSql: Db;
  let extract: typeof import("./extract");
  let paid: typeof import("./paid-extract");
  let darwin: typeof import("../darwin/verify");
  let publish: typeof import("../hamilton/publish");
  let nextRunId = -233_500_000 - process.pid * 10;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("Symbolic formula SQL tests require disposable loopback PostgreSQL; production forbidden");
    vi.stubEnv("DATABASE_URL", connection);
    const m = await import("@/lib/data-store/connection");
    appSql = m.sql;
    db = postgres(connection, { max: 1, ssl: "require", types: {
      numeric: m.NUMERIC_AS_NUMBER, json: m.JSON_TEXT_PASSTHROUGH, text: m.TEXT_WITHOUT_NUL,
    } }) as unknown as postgres.Sql;
    extract = await import("./extract");
    paid = await import("./paid-extract");
    darwin = await import("../darwin/verify");
    publish = await import("../hamilton/publish");
  }, 30_000);
  afterAll(async () => { if (db) await db.end(); if (appSql) await appSql.end(); vi.unstubAllEnvs(); });

  async function rolledBack(work: (tx: Db) => Promise<void>) {
    const rollback = new Error("rollback own symbolic formula fixture");
    await db.begin(async scope => { await work(scope as unknown as Db); throw rollback; })
      .catch(error => { if (error !== rollback) throw error; });
  }
  async function seed(tx: Db, text = TEXT) {
    const sourceUrl = "https://www.grwfcu.com/disclosures";
    const hash = createHash("sha256").update(text).digest("hex");
    const [{ id: institutionId }] = await tx`INSERT INTO institution_sources
      (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
      VALUES ('Synthetic symbolic formula bank','https://www.grwfcu.com/',${sourceUrl},
        'bank','Wisconsin','WI',500000,'e2e','active') RETURNING id`;
    const [{ id: runId }] = await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
      VALUES (${nextRunId--},'knox','state_agent','Symbolic formula SQL fixture','running') RETURNING id`;
    const [{ id: documentId }] = await tx`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type)
      VALUES (${institutionId},'success',${sourceUrl},${hash},'text/plain') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,status,normalized_text,text_hash,char_count)
      VALUES (${runId},${documentId},${institutionId},${sourceUrl},'completed',${text},${hash},${text.length}) RETURNING id`;
    const [{ id: stepId }] = await tx`INSERT INTO agent_run_steps(agent_run_id,step_key,agent_name,title,status)
      VALUES (${runId},'publish','hamilton','Symbolic formula applicability publication fixture','running') RETURNING id`;
    return { institutionId: Number(institutionId), runId: Number(runId), documentId: Number(documentId), textId: Number(textId), stepId: Number(stepId), text, hash, sourceUrl };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;
  const rowOf = (f: Fixture) => ({ document_text_id: f.textId, source_document_id: f.documentId,
    institution_id: f.institutionId, source_url: f.sourceUrl, text_hash: f.hash, normalized_text: f.text });
  function accepted(f: Fixture) {
    const fee = paid.groundPaidRow({ fee_name: "Late Payment Fee", canonical_key: "late_payment", amount: 10,
      source_line: f.text.includes(OWN) ? OWN : "Late Payment Fee | $10.00 each billing period", frequency: "per_item", conditions: "invented standard fee" }, f.text);
    if (typeof fee === "string") throw new Error(`Fixture paid row must be price-grounded: ${fee}`);
    return { feeName: fee.feeName, amount: fee.amount, frequency: fee.frequency, canonicalHint: fee.canonicalKey,
      confidence: .95, excerpt: fee.sourceLine, waivable: false, lineup: fee.lineup,
      ownUnit: fee.ownUnit, ownCondition: fee.ownCondition };
  }

  async function fullPublish(tx: Db, fixture: Fixture) {
    const sweeps = await import("../hamilton/publish-sweeps");
    const opts = { runId: fixture.runId, stepId: fixture.stepId, institutionId: fixture.institutionId,
      dryRun: false, batchId: `agentic-run-${fixture.runId}` };
    const ctx = { db: tx, ...opts, researchSplitFullCount: false, categoryGuardLimit: 1000,
      sweepMs: {} as Record<string, number>, mode: "full" as const };
    const results = [
      await sweeps.sweepsBeforeGuardRequeue(ctx),
      await (await import("../hamilton/guard-requeue")).requeueGuardRejectedFees(tx, opts),
      await (await import("../hamilton/companion-retire")).rollBackRetiredCompanionFees(tx, opts),
      await sweeps.sweepsBeforeNewerCopy(ctx),
      await (await import("../hamilton/newer-copy-retire")).retireFeesDroppedFromNewerCopy(tx, opts),
      await sweeps.sweepsBeforeRefreshCopy(ctx),
      await (await import("../hamilton/refresh-copy")).refreshFeesFromCurrentCopy(tx, opts),
      await (await import("../hamilton/current-copy")).secondLookFeesNotOnCurrentCopy(tx, opts),
      await (await import("../hamilton/rules-recheck")).rollBackUnreproducedFees(tx, opts),
      await sweeps.sweepsBeforeRows(ctx),
      await (await import("../hamilton/source-link")).resourceSourceLinks(tx, opts),
      await publish.runHamiltonPublish({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId,
        limit: 100, minInstitutionFees: 1 }),
      await (await import("../hamilton/duplicate-collapse")).collapsePublishedDuplicates(tx, opts),
      await (await import("../hamilton/source-check")).takeDownUntraceableFees(tx, opts),
      await sweeps.sweepsAfterRows(ctx),
    ];
    // Exercise every normal owner, including the pre-publication account hold. A caught
    // read/schema error cannot turn this test into evidence that the owner protected a row.
    const failures: unknown[] = [];
    const errors = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "error" && child != null) failures.push(child);
        else if (typeof child === "object") errors(child);
      }
    };
    results.forEach(errors);
    expect(failures).toEqual([]);
  }
  async function automaticHeldPasses(tx: Db, fixture: Fixture) {
    const held = await import("./held-recheck");
    const opts = { runId: fixture.runId, institutionId: fixture.institutionId, dryRun: false };
    await held.recheckPromotedRows(tx, opts);
    await held.recheckHeldRows(tx, opts);
    await held.fileHeldByName(tx, opts);
    await held.recheckUntracedRows(tx, opts);
    await held.recheckSupersededRows(tx, opts);
    await held.recheckSupersededRows(tx, { ...opts, source: "free" });
    await held.refileSupersededRows(tx, opts);
    await held.recheckHeldRates(tx, opts);
    await held.setAsideRangeBands(tx, opts);
    await held.previewHeldNameRules(tx, opts);
  }

  it("holds an accepted paid-shaped price using actual source context, not model conditions", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      expect(createHash("sha256").update(f.text).digest("hex")).toBe("45f5bd42895b89ea2ca8094823266e397ad826e9516b2b7df8f87f84f30f9c47");
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: rowOf(f), candidate: accepted(f),
        extraFlags: [paid.KNOX_PAID_FLAG, FLAG, "needs_darwin_verification"] })).toBe(true);
      const [raw] = await tx`SELECT * FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      expect(raw.outlier_flags).toContain("knox_review:eligibility");
      expect(raw.outlier_flags).toContain(FLAG);
      expect(raw.outlier_flags).toContain(paid.KNOX_PAID_FLAG);
      expect(raw.outlier_flags).not.toContain("needs_darwin_verification");
      expect(raw.conditions).toContain("amount of minimum payment, whichever is less");
      expect(raw.conditions).toContain("or amount of minimum payment, whichever is less");
      expect(raw.conditions).not.toContain("invented");
    });
  });

  it("applies the same gate to learning and free-held writers, with independent line-share identities", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const { emptyTakedownLessons } = await import("./takedown-lessons");
      const candidate = accepted(f);
      expect((await extract.insertCandidateWithLearning(tx, { runId: f.runId, row: rowOf(f), candidate }, emptyTakedownLessons())).inserted).toBe(true);
      const held = { shape: "eligibility" as const, feeName: candidate.feeName, amount: 10, amountMax: null,
        percent: null, canonicalHint: "late_payment", frequency: "per_item", excerpt: "model quote",
        linkedConditions: "invented model applicability", lineShare: "second-own-identity" };
      expect(await extract.insertHeldCandidate(tx, { runId: f.runId, row: rowOf(f), held })).toBe(true);
      expect(await extract.insertHeldCandidate(tx, { runId: f.runId, row: rowOf(f), held })).toBe(false);
      const rows = await tx`SELECT outlier_flags,conditions FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      expect(rows).toHaveLength(2);
      expect(rows.every(raw => raw.outlier_flags.includes(FLAG) && !raw.outlier_flags.includes("needs_darwin_verification"))).toBe(true);
      expect(rows.every(raw => raw.conditions.includes("amount of minimum payment, whichever is less") && !raw.conditions.includes("model quote"))).toBe(true);
      expect(rows.every(raw => !raw.conditions.includes("invented model applicability"))).toBe(true);
    });
  });

  it("binds minimal callers to exactly the completed source artifact and rejects missing/mismatched content", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx), candidate = accepted(f);
      const minimal = { ...rowOf(f), normalized_text: undefined };
      for (const row of [{ ...minimal, text_hash: null }, { ...minimal, text_hash: '0'.repeat(64) },
        { ...minimal, document_text_id: -1 }, { ...minimal, source_document_id: -1 }, { ...minimal, institution_id: -1 },
        { ...minimal, document_text_id: f.textId + 999999 }, { ...minimal, source_document_id: f.documentId + 999999 },
        { ...minimal, institution_id: f.institutionId + 999999 },
        { ...minimal, document_text_id: "" }, { ...rowOf(f), institution_id: "" },
        { ...rowOf(f), normalized_text: "General Fees\nLate Payment Fee | $5" }])
        expect(await extract.insertCandidate(tx, { runId: f.runId, row, candidate })).toBe(false);
      await tx`UPDATE agent_source_texts SET status='failed' WHERE id=${f.textId}`;
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: minimal, candidate })).toBe(false);
      await tx`UPDATE agent_source_texts SET status='completed' WHERE id=${f.textId}`;
      expect(await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE institution_id=${f.institutionId}`).toHaveLength(0);
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: minimal, candidate })).toBe(true);
      const [raw] = await tx`SELECT outlier_flags FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      expect(raw.outlier_flags).toContain(FLAG);
    });
  });

  it("declines unsupported or ambiguous formulas and prevents extra flags from inventing provenance", async () => {
    await rolledBack(async tx => {
      for (const text of [TEXT.replace(OWN, OWN + " for the first month"), TEXT + "\nLate Payment Fee | $10 per item"]) {
        const f = await seed(tx, text);
        expect(await extract.insertCandidate(tx, { runId: f.runId, row: rowOf(f), candidate: accepted(f) })).toBe(false);
        expect(await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE institution_id=${f.institutionId}`).toHaveLength(0);
      }
      const f = await seed(tx, TEXT.replace(OWN, "Late Payment Fee | $10.00 each billing period"));
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: rowOf(f), candidate: accepted(f), extraFlags: [FLAG] })).toBe(true);
      const [raw] = await tx`SELECT outlier_flags FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      expect(raw.outlier_flags).not.toContain(FLAG);
      expect(raw.outlier_flags).toContain("needs_darwin_verification");
    });
  });

  it("makes the ordinary missing-source late-payment limit explicit without changing other minimal families", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx, TEXT.replace(OWN, "Late Payment Fee | $10.00 each billing period"));
      const minimal = { ...rowOf(f), normalized_text: undefined, text_hash: null };
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: minimal, candidate: accepted(f) })).toBe(false);
      // An ordinary exact legacy late-payment artifact remains eligible when recoverable.
      expect(await extract.insertCandidate(tx, { runId: f.runId,
        row: { ...minimal, text_hash: f.hash }, candidate: accepted(f) })).toBe(true);
      // The new source contract is not applied to unrelated ordinary direct callers.
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: minimal,
        candidate: { feeName: "Money Orders", amount: 1, frequency: "per_item", canonicalHint: "money_order",
          confidence: .95, excerpt: "Money Orders | $1.00", waivable: false }, extraFlags: [FLAG] })).toBe(true);
      const rows = await tx`SELECT outlier_flags FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      expect(rows).toHaveLength(2);
      expect(rows.every(row => !row.outlier_flags.includes(FLAG) && row.outlier_flags.includes("needs_darwin_verification"))).toBe(true);
    });
  });

  async function oldRaw(tx: Db, f: Fixture, lineShare: string) {
    const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
      (institution_id,source_document_id,source_url,source,extraction_confidence,agent_event_id,fee_name,amount,
      frequency,conditions,extraction_note,outlier_flags,fee_audience,line_share)
      VALUES (${f.institutionId},${f.documentId},${f.sourceUrl},'knox',.91,gen_random_uuid(),'Late Payment Fee',10,'per_item',
      'Original history conditions','Original history witness','["needs_darwin_verification","canonical_hint:late_payment","unrelated_review"]'::jsonb,
      'unknown',${lineShare}) RETURNING fee_raw_id`;
    return Number(rawId);
  }

  it("takes over only the exact unverified identity and retains unrelated flags", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx), rawId = await oldRaw(tx, f, "");
      const other = await oldRaw(tx, f, "other-identity");
      const [beforeOther] = await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${other}`;
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: rowOf(f), candidate: accepted(f) })).toBe(true);
      const [raw] = await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`;
      expect(raw.outlier_flags).toContain(FLAG);
      expect(raw.outlier_flags).toContain("unrelated_review");
      expect(raw.outlier_flags).not.toContain("needs_darwin_verification");
      expect(raw.conditions).toContain("amount of minimum payment, whichever is less");
      expect((await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${other}`)[0]).toEqual(beforeOther);
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: rowOf(f), candidate: accepted(f) })).toBe(false);
      expect((await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`)[0]).toEqual(raw);
    });
  });

  it.each(["knox_review:eligibility", "knox_review:unclassified", "manual_review"])("keeps an unrelated nonpending raw hold %s byte-identical", async flag => {
    await rolledBack(async tx => {
      const f = await seed(tx), rawId = await oldRaw(tx, f, "");
      await tx`UPDATE raw_fee_observations SET outlier_flags=${JSON.stringify([flag, "canonical_hint:late_payment"])}::jsonb WHERE fee_raw_id=${rawId}`;
      const [before] = await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`;
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: rowOf(f), candidate: accepted(f) })).toBe(false);
      expect((await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`)[0]).toEqual(before);
    });
  });

  it.each(["rejected", "challenged", "verified", "published"])("preserves every raw/verified/published field of %s history", async state => {
    await rolledBack(async tx => {
      const f = await seed(tx), rawId = await oldRaw(tx, f, "");
      const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations
        (fee_raw_id,institution_id,source_url,extraction_confidence,canonical_fee_key,verified_by_agent_event_id,
        fee_name,amount,frequency,review_status,outlier_flags)
        VALUES (${rawId},${f.institutionId},${f.sourceUrl},.91,'late_payment',gen_random_uuid(),'Late Payment Fee',10,'per_item',
        ${state === "published" ? "verified" : state},'[]'::jsonb) RETURNING fee_verified_id`;
      if (state === "published") await tx`INSERT INTO published_fee_records
        (lineage_ref,institution_id,canonical_fee_key,source_url,extraction_confidence,published_by_adversarial_event_id,
        fee_name,amount,frequency,batch_id) VALUES (${verifiedId},${f.institutionId},'late_payment',${f.sourceUrl},.91,
        gen_random_uuid(),'Late Payment Fee',10,'per_item','symbolic-lesser-history-fixture')`;
      const [before] = await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`;
      const verifiedBefore = await tx`SELECT * FROM verified_fee_observations WHERE fee_raw_id=${rawId}`;
      const publishedBefore = await tx`SELECT * FROM published_fee_records WHERE lineage_ref=${verifiedId}`;
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: rowOf(f), candidate: accepted(f) })).toBe(false);
      expect((await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`)[0]).toEqual(before);
      expect(await tx`SELECT * FROM verified_fee_observations WHERE fee_raw_id=${rawId}`).toEqual(verifiedBefore);
      expect(await tx`SELECT * FROM published_fee_records WHERE lineage_ref=${verifiedId}`).toEqual(publishedBefore);
    });
  });

  it("keeps the accepted price held through every normal promoter and full publication owner twice", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: rowOf(f), candidate: accepted(f), extraFlags: [paid.KNOX_PAID_FLAG] })).toBe(true);
      const [held] = await tx`SELECT * FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      for (let cycle = 0; cycle < 2; cycle++) {
        await extract.runKnoxExtract({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 10 });
        await automaticHeldPasses(tx, f);
        await darwin.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100 });
        await fullPublish(tx, f);
      }
      expect((await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${held.fee_raw_id}`)[0]).toEqual(held);
      expect(await tx`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_raw_id=${held.fee_raw_id}`).toHaveLength(0);
      const catalog = await tx`SELECT fee_category,amount FROM published_fee_catalog WHERE institution_id=${f.institutionId}`;
      expect(catalog.some(row => Number(row.amount) === 1 && row.fee_category === "money_order")).toBe(true);
      expect(catalog.some(row => row.fee_category === "late_payment" && Number(row.amount) === 10)).toBe(false);
    });
  }, 60_000);

  it("does not turn a prospective formula hold into an automatic historical price retirement", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx), rawId = await oldRaw(tx, f, "");
      const note = `Knox deterministic extraction from Rosetta artifact #${f.textId}. canonical_hint=late_payment; text_hash=${f.hash}; excerpt="${OWN}"`;
      await tx`UPDATE raw_fee_observations SET extraction_note=${note},conditions=NULL WHERE fee_raw_id=${rawId}`;
      const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations
        (fee_raw_id,institution_id,source_url,extraction_confidence,canonical_fee_key,verified_by_agent_event_id,
        fee_name,amount,frequency,review_status,outlier_flags)
        VALUES (${rawId},${f.institutionId},${f.sourceUrl},.91,'late_payment',gen_random_uuid(),'Late Payment Fee',10,'per_item',
        'verified','["agentic_darwin_verified"]'::jsonb) RETURNING fee_verified_id`;
      const [{ fee_published_id: publishedId }] = await tx`INSERT INTO published_fee_records
        (lineage_ref,institution_id,canonical_fee_key,source_url,extraction_confidence,published_by_adversarial_event_id,
        fee_name,amount,frequency,batch_id) VALUES (${verifiedId},${f.institutionId},'late_payment',${f.sourceUrl},.91,
        gen_random_uuid(),'Late Payment Fee',10,'per_item','symbolic-lesser-existing-public-fixture') RETURNING fee_published_id`;
      const [rawBefore] = await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`;
      const recheck = await (await import("../hamilton/rules-recheck")).rollBackUnreproducedFees(tx, {
        runId: f.runId, institutionId: f.institutionId, dryRun: false, batchId: `agentic-run-${f.runId}` });
      expect(recheck.documentsChecked).toBe(1);
      expect(recheck.liveFeesChecked).toBe(1);
      expect(recheck.rollbacks).toEqual([]);
      expect(recheck.disputed).toContainEqual(expect.objectContaining({ feePublishedId: Number(publishedId), amount: 10 }));
      expect((await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`)[0]).toEqual(rawBefore);
      expect(await tx`SELECT amount,rolled_back_at,quarantined_at FROM published_fee_records
        WHERE fee_published_id=${publishedId}`).toEqual([expect.objectContaining({ amount: 10, rolled_back_at: null, quarantined_at: null })]);
    });
  });

  it("still publishes the ordinary flat price through the same actual stages", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx, TEXT.replace(OWN, "Late Payment Fee | $10.00 each billing period"));
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: rowOf(f), candidate: accepted(f) })).toBe(true);
      await extract.runKnoxExtract({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 10 });
      await automaticHeldPasses(tx, f);
      await darwin.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100 });
      await fullPublish(tx, f);
      expect(await tx`SELECT amount FROM published_fee_catalog WHERE institution_id=${f.institutionId} AND fee_category='late_payment'`)
        .toEqual([expect.objectContaining({ amount: 10 })]);
    });
  }, 60_000);

});
