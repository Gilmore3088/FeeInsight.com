// @vitest-environment node
/** Full exact source editions through real stages. Owned loopback fixtures only. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { institutionValue } from "@/lib/data-store/fee-stats";

vi.mock("@/lib/agents/fee-source-fetch", async original => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("International scope fixture forbids network/provider calls"); },
}));
const connection = process.env.E2E_DATABASE_URL;
const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/family-international-wire-scope.json", import.meta.url), "utf8"));
type Source = { sourceURL: string; normalizedText: string; normalizedTextSHA256?: string; textSHA256?: string; sourceBytesSHA256: string; contentType?: string };
const pdf: Source = fixture.sources.find((row: { kind: string }) => row.kind === "consumer_pdf");
const html: Source = fixture.sources.find((row: { kind: string }) => row.kind === "fresh_html");
type Db = typeof import("@/lib/data-store/connection").sql;
type Seed = { institutionId: number; runId: number; stepId: number; documentId: number; textId: number; hash: string; source: Source };

describe.skipIf(!connection)("International wire source applicability, real normal stages (#2278)", () => {
  let db: postgres.Sql, appSql: Db;
  let extract: typeof import("./extract"), paid: typeof import("./paid-extract");
  let darwin: typeof import("../darwin/verify"), publish: typeof import("../hamilton/publish");
  let runId = -227_800_000 - process.pid * 10;
  const receipts: unknown[] = [];
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("International scope tests require an owned loopback database; production forbidden");
    vi.stubEnv("DATABASE_URL", connection);
    const connectionModule = await import("@/lib/data-store/connection");
    appSql = connectionModule.sql;
    db = postgres(connection, { max: 1, ssl: "require", types: {
      numeric: connectionModule.NUMERIC_AS_NUMBER, json: connectionModule.JSON_TEXT_PASSTHROUGH,
      text: connectionModule.TEXT_WITHOUT_NUL,
    } }) as unknown as postgres.Sql;
    extract = await import("./extract"); paid = await import("./paid-extract");
    darwin = await import("../darwin/verify"); publish = await import("../hamilton/publish");
  });
  afterAll(async () => {
    if (db) await db.end(); if (typeof appSql?.end === "function") await appSql.end(); vi.unstubAllEnvs();
    if (process.env.WIRE_SCOPE_RECEIPT_PATH) writeFileSync(process.env.WIRE_SCOPE_RECEIPT_PATH,
      JSON.stringify({ capturedAt: new Date().toISOString(), scope: "Owned loopback, exact full normalized source editions; no live mutation or provider call", receipts }, null, 2) + "\n");
  });
  async function rollback(work: (tx: Db) => Promise<void>) {
    const signal = new Error("rollback owned international wire fixture");
    await db.begin(async scope => { await work(scope as unknown as Db); throw signal; })
      .catch(error => { if (error !== signal) throw error; });
  }
  async function seed(tx: Db, source: Source, existingInstitution?: number, consumerCompanion = false): Promise<Seed> {
    const hash = createHash("sha256").update(source.normalizedText).digest("hex");
    expect(hash).toBe(source.normalizedTextSHA256 ?? source.textSHA256);
    const institutionId = existingInstitution ?? Number((await tx`INSERT INTO institution_sources
      (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
      VALUES ('Synthetic international source scope fixture','https://www.familysavingscu.com/',${source.sourceURL},
      'credit_union','Alabama','AL',1000000,'e2e','active') RETURNING id`)[0].id);
    const currentRunId = runId--;
    await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
      VALUES (${currentRunId},'knox','state_agent','International scope fixture','running')`;
    const [{ id: stepId }] = await tx`INSERT INTO agent_run_steps(agent_run_id,step_key,agent_name,title,status)
      VALUES (${currentRunId},'publish','hamilton','International scope fixture','running') RETURNING id`;
    const companionId = consumerCompanion ? Number((await tx`INSERT INTO institution_additional_sources
      (institution_id,url,document_type,document_role,status,found_by_strategy,strategy_version,agent_run_id)
      VALUES (${institutionId},${source.sourceURL},'pdf','consumer_supplement','fetched',
      'synthetic_reviewed_consumer_companion',1,${currentRunId}) RETURNING id`)[0].id) : null;
    const [{ id: documentId }] = await tx`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type,companion_source_id)
      VALUES (${institutionId},'success',${source.sourceURL},${source.sourceBytesSHA256},${source.contentType ?? "text/html"},${companionId}) RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,status,source_hash,normalized_text,text_hash,char_count)
      VALUES (${currentRunId},${documentId},${institutionId},${source.sourceURL},'completed',${source.sourceBytesSHA256},${source.normalizedText},${hash},${source.normalizedText.length}) RETURNING id`;
    return { institutionId, runId: currentRunId, stepId: Number(stepId), documentId: Number(documentId), textId: Number(textId), hash, source };
  }
  const live = (tx: Db, f: Seed) => tx`SELECT c.id,c.fee_name,c.fee_category,c.amount,c.frequency,c.conditions,c.fee_audience,r.product_name
    FROM published_fee_catalog c LEFT JOIN raw_fee_observations r ON r.fee_raw_id=c.fee_raw_id
    WHERE c.institution_id=${f.institutionId} AND c.fee_category LIKE 'wire_%' ORDER BY c.fee_category,c.amount,c.id`;
  async function snapshot(tx: Db, f: Seed, name: string) {
    const catalog = await live(tx, f);
    const raw = await tx`SELECT * FROM raw_fee_observations WHERE institution_id=${f.institutionId} ORDER BY fee_raw_id`;
    const verified = await tx`SELECT * FROM verified_fee_observations WHERE institution_id=${f.institutionId} ORDER BY fee_verified_id`;
    const published = await tx`SELECT * FROM published_fee_records WHERE institution_id=${f.institutionId} ORDER BY fee_published_id`;
    const outgoing = catalog.filter(row => row.fee_category === "wire_intl_outgoing").map(row => Number(row.amount));
    receipts.push({ name, source: { documentId: f.documentId, textId: f.textId, textHash: f.hash, url: f.source.sourceURL,
      actualStream: await tx`SELECT sd.companion_source_id,ias.document_role,ias.status
        FROM source_documents sd LEFT JOIN institution_additional_sources ias ON ias.id=sd.companion_source_id WHERE sd.id=${f.documentId}` },
      raw, verified, published, catalog, internationalOutgoingValue: outgoing.length ? institutionValue("wire_intl_outgoing", outgoing) : null });
    return catalog;
  }
  async function fullPublish(tx: Db, f: Seed) {
    const sweeps = await import("../hamilton/publish-sweeps");
    const opts = { runId: f.runId, stepId: f.stepId, institutionId: f.institutionId, dryRun: false, batchId: `agentic-run-${f.runId}` };
    const ctx = { db: tx, ...opts, researchSplitFullCount: false, categoryGuardLimit: 1000, sweepMs: {} as Record<string, number>, mode: "full" as const };
    const results = [await sweeps.sweepsBeforeGuardRequeue(ctx),
      await (await import("../hamilton/guard-requeue")).requeueGuardRejectedFees(tx, opts),
      await (await import("../hamilton/companion-retire")).rollBackRetiredCompanionFees(tx, opts),
      await sweeps.sweepsBeforeNewerCopy(ctx),
      await (await import("../hamilton/newer-copy-retire")).retireFeesDroppedFromNewerCopy(tx, opts),
      await (await import("../hamilton/current-copy")).secondLookFeesNotOnCurrentCopy(tx, opts),
      await (await import("../hamilton/rules-recheck")).rollBackUnreproducedFees(tx, opts),
      await sweeps.sweepsBeforeRows(ctx), await (await import("../hamilton/source-link")).resourceSourceLinks(tx, opts),
      await publish.runHamiltonPublish({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100, minInstitutionFees: 1 }),
      await (await import("../hamilton/duplicate-collapse")).collapsePublishedDuplicates(tx, opts),
      await (await import("../hamilton/source-check")).takeDownUntraceableFees(tx, opts), await sweeps.sweepsAfterRows(ctx)];
    const errors: unknown[] = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) if (key === "error" && child != null) errors.push(child); else if (typeof child === "object") visit(child);
    };
    results.forEach(visit); expect(errors).toEqual([]);
  }
  async function stages(tx: Db, f: Seed, doExtract = true) {
    if (doExtract) await extract.runKnoxExtract({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 10 });
    await darwin.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100 });
    await fullPublish(tx, f);
  }
  async function sourceBackedDepth(tx: Db, f: Seed) {
    const { runFreeSpecialists } = await import("./specialists");
    const categories = new Set(["money_order", "cashiers_check", "card_replacement"]);
    const controls = runFreeSpecialists(f.source.normalizedText).candidates.filter(row => categories.has(row.canonicalHint));
    expect(new Set(controls.map(row => row.canonicalHint)).size).toBe(3);
    for (const candidate of controls) await extract.insertCandidate(tx, { runId: f.runId,
      row: { document_text_id: f.textId, source_document_id: f.documentId, institution_id: f.institutionId,
        source_url: f.source.sourceURL, text_hash: f.hash, normalized_text: f.source.normalizedText }, candidate });
    await stages(tx, f, false);
    expect(await tx`SELECT DISTINCT fee_category FROM published_fee_catalog
      WHERE institution_id=${f.institutionId} AND fee_category=ANY(${[...categories]}::text[])`).toHaveLength(3);
  }
  const sourceRow = (f: Seed) => ({ document_text_id: f.textId, source_document_id: f.documentId,
    institution_id: f.institutionId, source_url: f.source.sourceURL, text_hash: f.hash, normalized_text: f.source.normalizedText });
  const genericCandidate = () => ({ feeName: "International Wire Transfer Fee", amount: 35,
    frequency: "per_item", canonicalHint: "wire_intl_outgoing", confidence: .95,
    excerpt: "invented incoming standard applicability", waivable: false });
  const flag = "knox_eligibility:international_wire";

  async function historicalVerified(tx: Db, f: Seed, name: string, amount: number, category: string) {
    const note = `Knox deterministic extraction from Rosetta artifact #${f.textId}. canonical_hint=${category}; text_hash=${f.hash}; calibrated_confidence=0.98; excerpt="${name} | $${amount}"`;
    const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
      (institution_id,source_document_id,source_url,source,agent_event_id,fee_name,amount,frequency,
       extraction_confidence,extraction_note,outlier_flags,fee_audience,fee_treatment)
      VALUES (${f.institutionId},${f.documentId},${f.source.sourceURL},'knox',gen_random_uuid(),${name},${amount},'per_item',
       .95,${note},${JSON.stringify([`canonical_hint:${category}`])}::jsonb,'unknown','charged') RETURNING fee_raw_id`;
    const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations
      (fee_raw_id,institution_id,source_url,verified_by_agent_event_id,canonical_fee_key,fee_name,amount,frequency,
       extraction_confidence,review_status,outlier_flags,fee_audience,fee_treatment)
      VALUES (${rawId},${f.institutionId},${f.source.sourceURL},gen_random_uuid(),${category},${name},${amount},'per_item',
       .95,'verified','["agentic_darwin_verified"]'::jsonb,'unknown','charged') RETURNING fee_verified_id`;
    return { rawId: Number(rawId), verifiedId: Number(verifiedId) };
  }

  it("unwired publication adapter derives current verified/source facts even for a minimal direct identity", async () => rollback(async tx => {
    const { withInternationalPublicationWrite } = await import("../hamilton/international-publication");
    const f = await seed(tx, pdf);
    await sourceBackedDepth(tx, f);
    const v = await historicalVerified(tx, f, "International Wire Outgoing", 45, "wire_intl_outgoing");
    const result = await withInternationalPublicationWrite(tx, { feeVerifiedId: v.verifiedId }, async (scope, actual) => {
      expect(actual).toMatchObject({ fee_verified_id: String(v.verifiedId), canonical_fee_key: "wire_intl_outgoing", amount: 45 });
      return publish.insertPublishedFee(scope, { runId: f.runId, batchId: `agentic-run-${f.runId}`, row: actual! });
    });
    expect(result).toMatchObject({ kind: "written" });
    expect((await live(tx, f)).filter(row => row.fee_category === "wire_intl_outgoing").map(row => Number(row.amount))).toEqual([45]);
  }));

  it("unwired publication adapter defers legacy verified generic and wrong-direction rows without judging them", async () => rollback(async tx => {
    const { withInternationalPublicationWrite } = await import("../hamilton/international-publication");
    for (const [source, name, amount, category] of [[html, "International Wire Transfer Fee", 35, "wire_intl_outgoing"],
      [pdf, "International Wire Outgoing", 45, "wire_intl_incoming"]] as const) {
      const f = await seed(tx, source);
      const v = await historicalVerified(tx, f, name, amount, category);
      const [before] = await tx`SELECT * FROM verified_fee_observations WHERE fee_verified_id=${v.verifiedId}`;
      const write = vi.fn(async () => { throw new Error("Unproven source may not reach publication"); });
      expect(await withInternationalPublicationWrite(tx, { feeVerifiedId: v.verifiedId }, write)).toMatchObject({ kind: "deferred" });
      expect(await withInternationalPublicationWrite(tx, { feeVerifiedId: v.verifiedId }, write)).toMatchObject({ kind: "deferred" });
      expect(write).not.toHaveBeenCalled();
      expect((await tx`SELECT * FROM verified_fee_observations WHERE fee_verified_id=${v.verifiedId}`)[0]).toEqual(before);
      expect(await tx`SELECT id FROM pipeline_attempts WHERE input_fingerprint=${`verified:${v.verifiedId}`} AND stage='publish' AND strategy='publish.rules'`).toHaveLength(0);
    }
  }));

  it("defers a full stale international caller after the actual verified category changed to domestic", async () => rollback(async tx => {
    const { withInternationalPublicationWrite } = await import("../hamilton/international-publication");
    const f = await seed(tx, pdf);
    await sourceBackedDepth(tx, f);
    const v = await historicalVerified(tx, f, "International Wire Outgoing", 45, "wire_intl_outgoing");
    const [stale] = await tx`SELECT fv.*,to_jsonb(fv)::text AS selected_verified_state,
      fr.agent_event_id AS raw_agent_event_id,fr.source_document_id,fr.product_name
      FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
      WHERE fv.fee_verified_id=${v.verifiedId}`;
    await tx`UPDATE verified_fee_observations SET canonical_fee_key='wire_domestic_outgoing' WHERE fee_verified_id=${v.verifiedId}`;
    const writer = vi.fn(async (scope: Db) => publish.insertPublishedFee(scope, { runId: f.runId,
      batchId: `agentic-run-${f.runId}`, row: stale as unknown as import("../hamilton/publish").VerifiedFeeRow }));
    const result = await withInternationalPublicationWrite(tx,
      { feeVerifiedId: v.verifiedId, expectedVerifiedState: stale.selected_verified_state }, writer);
    expect(result).toMatchObject({ kind: "deferred", detail: { reason: "selected_changed" } });
    // A legacy direct row without a snapshot still supplies a category CAS expectation,
    // while a minimal identity-only call must derive its actual current classification.
    expect(await withInternationalPublicationWrite(tx,
      { feeVerifiedId: v.verifiedId, expectedCategory: stale.canonical_fee_key }, writer))
      .toMatchObject({ kind: "deferred", detail: { reason: "selected_changed" } });
    expect(writer).not.toHaveBeenCalled();
    expect(await tx`SELECT fee_published_id FROM published_fee_records WHERE lineage_ref=${v.verifiedId}`).toHaveLength(0);
  }));

  it("keeps an unavailable original peer market-comparable and defers instead of proving false clearance", async () => rollback(async tx => {
    const { withInternationalPublicationWrite } = await import("../hamilton/international-publication");
    const { countsInMarketComparison } = await import("@/lib/market-eligibility");
    const old = await seed(tx, fixture.historicalHtml);
    await sourceBackedDepth(tx, old);
    const v = await historicalVerified(tx, old, "International Wire Transfer Fee", 35, "wire_intl_outgoing");
    await tx`INSERT INTO published_fee_records
      (lineage_ref,institution_id,source_url,published_by_adversarial_event_id,canonical_fee_key,fee_name,amount,
       frequency,amount_kind,fee_audience,fee_treatment,published_at)
      VALUES (${v.verifiedId},${old.institutionId},${old.source.sourceURL},gen_random_uuid(),'wire_intl_outgoing',
       'International Wire Transfer Fee',35,'per_item','flat','unknown','charged',NOW()-interval '1 day')`;
    await tx`UPDATE raw_fee_observations SET extraction_note='legacy original witness unavailable' WHERE fee_raw_id=${v.rawId}`;
    const f = await seed(tx, pdf, old.institutionId, true);
    const fresh = await historicalVerified(tx, f, "International Wire Outgoing", 45, "wire_intl_outgoing");
    const [oldPublic] = await tx`SELECT * FROM published_fee_catalog WHERE fee_raw_id=${v.rawId}`;
    expect(oldPublic).toBeDefined();
    expect(countsInMarketComparison({ category: oldPublic.fee_category, amount: Number(oldPublic.amount),
      audience: oldPublic.fee_audience, sourced: oldPublic.source_document_id != null, sourceUrl: oldPublic.source_url,
      feeName: oldPublic.fee_name, accountProduct: oldPublic.account_product_type,
      sourceLine: oldPublic.conditions, frequency: oldPublic.frequency })).toBe(true);
    const write = vi.fn(async () => { throw new Error("Unavailable original peer may not disappear from comparison"); });
    expect(await withInternationalPublicationWrite(tx, { feeVerifiedId: fresh.verifiedId }, write)).toMatchObject({ kind: "deferred", detail: { reason: "live_scope_conflict" } });
    expect(write).not.toHaveBeenCalled();
    expect((await live(tx, f)).filter(row => row.fee_category === "wire_intl_outgoing").map(row => Number(row.amount))).toEqual([35]);
  }));

  it("rederives private direction provenance at both common writers, not model flags or excerpts", async () => rollback(async tx => {
    const { emptyTakedownLessons } = await import("./takedown-lessons");
    for (const learning of [false, true]) {
      const f = await seed(tx, html);
      const options = { runId: f.runId, row: sourceRow(f), candidate: genericCandidate(),
        extraFlags: [paid.KNOX_PAID_FLAG, flag, "needs_darwin_verification"] };
      const result = learning ? (await extract.insertCandidateWithLearning(tx, options, emptyTakedownLessons())).inserted
        : await extract.insertCandidate(tx, options);
      expect(result).toBe(true);
      const [raw] = await tx`SELECT * FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      expect(raw.outlier_flags).toContain(flag);
      expect(raw.outlier_flags).toContain("knox_review:eligibility");
      expect(raw.outlier_flags).toContain(paid.KNOX_PAID_FLAG);
      expect(raw.outlier_flags).not.toContain("needs_darwin_verification");
      expect(raw.conditions).toBe("International Wire Transfer Fee | $35.00");
      expect(raw.extraction_note).not.toContain("invented");
    }
  }));

  it("resolves only an exact legacy artifact and fails closed on incomplete or mismatched source", async () => rollback(async tx => {
    const f = await seed(tx, html);
    const row = { ...sourceRow(f), normalized_text: undefined };
    for (const invalid of [{ ...row, document_text_id: f.textId + 1000000 },
      { ...row, source_document_id: f.documentId + 1000000 }, { ...row, institution_id: f.institutionId + 1000000 },
      { ...row, text_hash: "0".repeat(64) }, { ...row, text_hash: null },
      { ...row, document_text_id: 0 }, { ...row, normalized_text: "unrelated content" }]) {
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: invalid, candidate: genericCandidate() })).toBe(false);
    }
    expect(await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE institution_id=${f.institutionId}`).toHaveLength(0);
    expect(await extract.insertCandidate(tx, { runId: f.runId, row, candidate: genericCandidate() })).toBe(true);
    expect((await tx`SELECT outlier_flags FROM raw_fee_observations WHERE institution_id=${f.institutionId}`)[0].outlier_flags).toContain(flag);
  }));

  it("preserves ordinary missing-content domestic callers and strips a spoofed international hold marker", async () => rollback(async tx => {
    const f = await seed(tx, html);
    expect(await extract.insertCandidate(tx, { runId: f.runId,
      row: { ...sourceRow(f), normalized_text: undefined, text_hash: null },
      candidate: { ...genericCandidate(), feeName: "Named Member Wire Outgoing", amount: 20, canonicalHint: "wire_domestic_outgoing" },
      extraFlags: [flag] })).toBe(true);
    const [raw] = await tx`SELECT * FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
    expect(raw.outlier_flags).toContain("needs_darwin_verification");
    expect(raw.outlier_flags).not.toContain(flag);
    expect(raw.outlier_flags).not.toContain("knox_review:eligibility");
  }));

  it("takes over only exact pending raw identity and preserves full judged and unrelated held histories", async () => rollback(async tx => {
    for (const state of ["pending", "held", "verified", "published"]) {
      const f = await seed(tx, html);
      const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
        (institution_id,source_document_id,source_url,source,agent_event_id,fee_name,amount,frequency,extraction_confidence,
        extraction_note,conditions,outlier_flags,fee_audience,fee_treatment,product_name)
        VALUES (${f.institutionId},${f.documentId},${f.source.sourceURL},'knox',gen_random_uuid(),
        'International Wire Transfer Fee',35,'per_item',.91,'original history','original conditions',
        ${JSON.stringify(state === "held" ? ["knox_review:eligibility"] : ["needs_darwin_verification"])}::jsonb,
        'unknown','charged','Original retained product') RETURNING fee_raw_id`;
      if (state === "verified" || state === "published") {
        const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations
          (fee_raw_id,institution_id,verified_by_agent_event_id,canonical_fee_key,fee_name,amount,review_status)
          VALUES (${rawId},${f.institutionId},gen_random_uuid(),'wire_intl_outgoing','International Wire Transfer Fee',35,'verified') RETURNING fee_verified_id`;
        if (state === "published") await tx`INSERT INTO published_fee_records
          (lineage_ref,institution_id,published_by_adversarial_event_id,canonical_fee_key,fee_name,amount,amount_kind)
          VALUES (${verifiedId},${f.institutionId},gen_random_uuid(),'wire_intl_outgoing','International Wire Transfer Fee',35,'flat')`;
      }
      const [before] = await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`;
      expect(await extract.insertCandidate(tx, { runId: f.runId, row: sourceRow(f), candidate: genericCandidate() })).toBe(state === "pending");
      const [after] = await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`;
      if (state === "pending") {
        expect(after.outlier_flags).toContain(flag);
        expect(after.outlier_flags).not.toContain("needs_darwin_verification");
        expect(after.product_name).toBe(before.product_name);
      } else expect(after).toEqual(before);
    }
  }));

  it("keeps all four properly resolved PDF wire prices through the actual normal stage owners", async () => rollback(async tx => {
    const f = await seed(tx, pdf);
    await stages(tx, f);
    const catalog = await snapshot(tx, f, "correct_full_pdf");
    const facts = catalog.map(row => [row.fee_category, Number(row.amount)]);
    expect(facts).toEqual(expect.arrayContaining([["wire_domestic_incoming", 10], ["wire_domestic_outgoing", 20],
      ["wire_intl_incoming", 35], ["wire_intl_outgoing", 45]]));
  }));

  it("does not publish a fresh generic HTML35 as an outgoing international fee", async () => rollback(async tx => {
    const f = await seed(tx, html);
    await stages(tx, f);
    const catalog = await snapshot(tx, f, "generic_html_must_hold");
    expect(catalog.filter(row => row.fee_category === "wire_intl_outgoing")).toEqual([]);
    const raw = await tx`SELECT outlier_flags FROM raw_fee_observations WHERE institution_id=${f.institutionId}
      AND fee_name='International Wire Transfer Fee' AND amount=35`;
    expect(raw[0]?.outlier_flags).toContain("knox_review:eligibility");
    expect(raw[0]?.outlier_flags).not.toContain("needs_darwin_verification");
  }));

  it("does not verify or publish an accepted paid outgoing45 claimed as incoming", async () => rollback(async tx => {
    const depth = await seed(tx, html);
    await sourceBackedDepth(tx, depth);
    const f = await seed(tx, pdf, depth.institutionId);
    const grounded = paid.groundPaidRow({ fee_name: "International Wire Outgoing", amount: 45, canonical_key: "wire_intl_incoming",
      source_line: "International Wire Outgoing $45 | FEE SCHEDULE & ACCOUNT DISCLOSURE", conditions: "invented incoming applicability" }, pdf.normalizedText);
    if (typeof grounded === "string") throw new Error(`The price baseline must remain accepted: ${grounded}`);
    await extract.insertCandidate(tx, { runId: f.runId, row: { document_text_id: f.textId, source_document_id: f.documentId,
      institution_id: f.institutionId, source_url: pdf.sourceURL, text_hash: f.hash, normalized_text: pdf.normalizedText },
      candidate: { feeName: grounded.feeName, amount: grounded.amount, frequency: grounded.frequency, canonicalHint: grounded.canonicalKey,
        confidence: .95, excerpt: grounded.sourceLine, waivable: false, ownUnit: grounded.ownUnit, ownCondition: grounded.ownCondition } });
    await stages(tx, f, false);
    const catalog = await snapshot(tx, f, "paid_outgoing45_wrong_incoming_key");
    expect(catalog.filter(row => row.fee_category === "wire_intl_incoming")).toEqual([]);
    expect(await tx`SELECT fee_verified_id FROM verified_fee_observations WHERE institution_id=${f.institutionId}
      AND canonical_fee_key='wire_intl_incoming' AND fee_name='International Wire Outgoing' AND amount=45`).toEqual([]);
  }));

  it("defers new outgoing45 while a preserved old generic outgoing35 would create a synthetic40", async () => rollback(async tx => {
    const old = await seed(tx, fixture.historicalHtml);
    await sourceBackedDepth(tx, old);
    const excerpt = "International Wire Transfer Fee | $35.00";
    const note = `Knox deterministic extraction from Rosetta artifact #${old.textId}. canonical_hint=wire_intl_outgoing; text_hash=${old.hash}; calibrated_confidence=0.98; excerpt="${excerpt}"`;
    const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
      (institution_id,source_document_id,source_url,source,agent_event_id,fee_name,amount,frequency,extraction_confidence,extraction_note,outlier_flags,fee_audience,fee_treatment)
      VALUES (${old.institutionId},${old.documentId},${old.source.sourceURL},'knox',gen_random_uuid(),'International Wire Transfer Fee',35,'per_item',.95,${note},
      '["canonical_hint:wire_intl_outgoing"]'::jsonb,'unknown','charged') RETURNING fee_raw_id`;
    const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations
      (fee_raw_id,institution_id,source_url,verified_by_agent_event_id,canonical_fee_key,fee_name,amount,frequency,extraction_confidence,review_status,fee_audience,fee_treatment)
      VALUES (${rawId},${old.institutionId},${old.source.sourceURL},gen_random_uuid(),'wire_intl_outgoing','International Wire Transfer Fee',35,'per_item',.95,'verified','unknown','charged') RETURNING fee_verified_id`;
    await tx`INSERT INTO published_fee_records
      (lineage_ref,institution_id,published_by_adversarial_event_id,canonical_fee_key,fee_name,amount,frequency,amount_kind,fee_audience,fee_treatment,published_at)
      VALUES (${verifiedId},${old.institutionId},gen_random_uuid(),'wire_intl_outgoing','International Wire Transfer Fee',35,'per_item','flat','unknown','charged',NOW()-interval '1 day')`;
    const [before] = await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`;
    expect((await live(tx, old)).filter(row => row.fee_category === "wire_intl_outgoing").map(row => Number(row.amount))).toEqual([35]);
    const f = await seed(tx, pdf, old.institutionId, true);
    await stages(tx, f);
    const catalog = await snapshot(tx, f, "old_generic35_plus_new_pdf");
    const outgoing = catalog.filter(row => row.fee_category === "wire_intl_outgoing").map(row => Number(row.amount));
    expect(outgoing).toEqual([35]);
    expect(institutionValue("wire_intl_outgoing", outgoing)).not.toBe(40);
    expect((await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`)[0]).toEqual(before);
    expect(await tx`SELECT fee_verified_id FROM verified_fee_observations WHERE institution_id=${f.institutionId}
      AND canonical_fee_key='wire_intl_outgoing' AND amount=45`).toHaveLength(1);
  }));
});
