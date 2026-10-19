// @vitest-environment node
/** Exact historical monthly state → repaired source → actual full publication owners; rollback only. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import beforeState from "./__fixtures__/oakwood-monthly-before-state.json";

vi.mock("@/lib/agents/fee-source-fetch", async original => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Monthly ownership SQL fixtures forbid bank/provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;

describe.skipIf(!connection)("Monthly account ownership through real PostgreSQL (#2259)", () => {
  let db: postgres.Sql;
  let appSql: Db;
  let extract: typeof import("./extract");
  let darwin: typeof import("../darwin/verify");
  let publish: typeof import("../hamilton/publish");
  let nextRunId = -225_900_000 - process.pid * 10;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("Monthly ownership tests require disposable loopback PostgreSQL; production is forbidden");
    vi.stubEnv("DATABASE_URL", connection);
    const mod = await import("@/lib/data-store/connection");
    appSql = mod.sql;
    db = postgres(connection, { max: 1, ssl: "require", types: {
      numeric: mod.NUMERIC_AS_NUMBER, json: mod.JSON_TEXT_PASSTHROUGH, text: mod.TEXT_WITHOUT_NUL,
    } }) as unknown as postgres.Sql;
    extract = await import("./extract");
    darwin = await import("../darwin/verify");
    publish = await import("../hamilton/publish");
  }, 30_000);
  afterAll(async () => { if (db) await db.end(); if (appSql) await appSql.end(); vi.unstubAllEnvs(); });

  async function rolledBack(test: (tx: Db) => Promise<void>) {
    const rollback = new Error("roll back owned monthly SQL fixture");
    await db.begin(async scope => { await test(scope as unknown as Db); throw rollback; })
      .catch(error => { if (error !== rollback) throw error; });
  }
  async function seed(tx: Db, text: string) {
    const hash = createHash("sha256").update(text.trim()).digest("hex");
    const [{ id: institutionId }] = await tx`INSERT INTO institution_sources
      (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
      VALUES ('Oakwood Bank','https://www.oakwoodbank.net/',${beforeState.source_url},
      'bank','Wisconsin','WI',500000,'e2e','active') RETURNING id`;
    const [{ id: runId }] = await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
      VALUES (${nextRunId--},'hamilton','state_agent','Monthly account ownership SQL fixture','running') RETURNING id`;
    const [{ id: documentId }] = await tx`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type)
      VALUES (${institutionId},'success',${beforeState.source_url},${beforeState.source_sha256},'application/pdf') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,status,reader,source_hash,normalized_text,text_hash,char_count)
      VALUES (${runId},${documentId},${institutionId},${beforeState.source_url},'completed','read.pdf_layout',
      ${beforeState.source_sha256},${text},${hash},${text.length}) RETURNING id`;
    const [{ id: stepId }] = await tx`INSERT INTO agent_run_steps(agent_run_id,step_key,agent_name,title,status)
      VALUES (${runId},'publish','hamilton','Full normal monthly publication owners','running') RETURNING id`;
    return { institutionId: Number(institutionId), runId: Number(runId), documentId: Number(documentId),
      textId: Number(textId), stepId: Number(stepId) };
  }
  async function historicalRows(tx: Db, fixture: Awaited<ReturnType<typeof seed>>) {
    const rawMap = new Map<number, number>();
    const verifiedMap = new Map<number, number>();
    const publishedMap = new Map<number, number>();
    for (const row of beforeState.rows) {
      const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
        (institution_id,source_document_id,source_url,source,extraction_confidence,agent_event_id,fee_name,amount,
        frequency,conditions,extraction_note,outlier_flags,product_name,min_balance_to_avoid,min_opening_deposit,
        waiver_text,fee_audience,audience_evidence,fee_treatment,line_share)
        VALUES (${fixture.institutionId},${fixture.documentId},${beforeState.source_url},${row.source},
        ${row.raw_confidence},gen_random_uuid(),${row.fee_name},${row.amount},${row.frequency},${row.conditions},
        ${row.extraction_note},${JSON.stringify(row.outlier_flags)}::jsonb,${row.product_name},${row.min_balance_to_avoid},
        ${row.min_opening_deposit},${row.waiver_text},${row.fee_audience},${row.audience_evidence},${row.fee_treatment},
        ${row.line_share}) RETURNING fee_raw_id`;
      rawMap.set(row.fee_raw_id, Number(rawId));
      if (row.fee_verified_id == null) continue;
      const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations
        (fee_raw_id,institution_id,source_url,extraction_confidence,canonical_fee_key,verified_by_agent_event_id,
        fee_name,amount,frequency,review_status,outlier_flags)
        VALUES (${rawId},${fixture.institutionId},${beforeState.source_url},${row.verified_confidence},${row.canonical_fee_key},
        gen_random_uuid(),${row.verified_name},${row.verified_amount},${row.verified_frequency},${row.review_status},
        ${JSON.stringify(row.verified_flags)}::jsonb) RETURNING fee_verified_id`;
      verifiedMap.set(row.fee_verified_id, Number(verifiedId));
      if (row.fee_published_id == null) continue;
      const [{ fee_published_id: publishedId }] = await tx`INSERT INTO published_fee_records
        (lineage_ref,institution_id,canonical_fee_key,source_url,extraction_confidence,published_by_adversarial_event_id,
        fee_name,amount,frequency,batch_id,rolled_back_at,rolled_back_reason,quarantined_at,quarantine_reason)
        VALUES (${verifiedId},${fixture.institutionId},${row.canonical_fee_key},${beforeState.source_url},
        ${row.published_confidence},gen_random_uuid(),${row.published_name},${row.published_amount},${row.published_frequency},
        'agentic-run-historical-monthly-fixture',${row.rolled_back_at},${row.rolled_back_reason},
        ${row.quarantined_at},${row.quarantine_reason}) RETURNING fee_published_id`;
      publishedMap.set(row.fee_published_id, Number(publishedId));
    }
    for (const attempt of beforeState.attempts) {
      const fingerprint = attempt.input_fingerprint?.replace(/^verified:(\d+)$/, (_, id) => {
        const mapped = verifiedMap.get(Number(id));
        if (!mapped) throw new Error(`Unmapped historical verified fingerprint ${id}`);
        return `verified:${mapped}`;
      });
      const detail = Object.fromEntries(Object.entries(attempt.detail).map(([key, value]) => {
        const map = key === "fee_raw_id" ? rawMap : key === "fee_verified_id" ? verifiedMap :
          ["fee_published_id", "previous_fee_published_id", "superseded_fee_published_id"].includes(key) ? publishedMap : null;
        if (value == null || !map) return [key, value];
        const mapped = map.get(Number(value));
        if (!mapped) throw new Error(`Unmapped historical ${key}: ${value}`);
        return [key, mapped];
      }));
      await tx`INSERT INTO pipeline_attempts(institution_id,source_document_id,stage,strategy,strategy_version,
        input_fingerprint,outcome,yield_count,agent_run_id,detail)
        VALUES (${fixture.institutionId},${fixture.documentId},${attempt.stage},${attempt.strategy},${attempt.strategy_version},
        ${fingerprint},${attempt.outcome},${attempt.yield_count},${fixture.runId},${JSON.stringify(detail)}::jsonb)`;
    }
    return { rawMap, verifiedMap, publishedMap };
  }
  async function fullPublish(tx: Db, fixture: Awaited<ReturnType<typeof seed>>) {
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
  async function automaticHeldPasses(tx: Db, fixture: Awaited<ReturnType<typeof seed>>) {
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

  it("keeps new ambiguous prices held after old business holds and every normal sweep, including repeat/conflict", async () => {
    await rolledBack(async tx => {
      const oldText = readFileSync(new URL("./__fixtures__/oakwood-interleaved-source.txt", import.meta.url), "utf8");
      expect(createHash("sha256").update(oldText.trim()).digest("hex")).toBe(beforeState.original_text_sha256);
      const fixture = await seed(tx, oldText);
      const mapping = await historicalRows(tx, fixture);
      expect(mapping.rawMap.size).toBe(7);
      expect(beforeState.attempts).toHaveLength(27);
      const repaired = readFileSync(new URL("./__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
      const hash = createHash("sha256").update(repaired).digest("hex");
      await tx`UPDATE agent_source_texts SET normalized_text=${repaired},text_hash=${hash},char_count=${repaired.length},
        updated_at=NOW() WHERE id=${fixture.textId}`;
      const stages = async () => {
        await extract.runKnoxExtract({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId, limit: 10 });
        await automaticHeldPasses(tx, fixture);
        await darwin.runDarwinVerify({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId, limit: 100 });
        await fullPublish(tx, fixture);
      };
      await extract.runKnoxExtract({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId, limit: 10 });
      expect(await tx`SELECT product_name FROM raw_fee_observations WHERE institution_id=${fixture.institutionId}
        AND fee_name='monthly fee if balance goes below minimum balance' AND amount=5`)
        .toEqual([expect.objectContaining({ product_name: 'SAVINGS ACCOUNT' })]);
      await automaticHeldPasses(tx, fixture);
      await darwin.runDarwinVerify({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId, limit: 100 });
      await fullPublish(tx, fixture);
      const held = await tx`SELECT fee_raw_id,fee_name,amount,frequency,conditions,extraction_note,outlier_flags
        FROM raw_fee_observations WHERE institution_id=${fixture.institutionId}
        AND outlier_flags ? 'knox_review:eligibility' ORDER BY fee_raw_id`;
      expect(held.map(row => Number(row.amount)).sort()).toEqual([5, 7]);
      for (const row of held) {
        expect(row.conditions).toContain(Number(row.amount) === 5 ? "PERSONAL CHECKING" : "PERSONAL INTEREST CHECKING");
        expect(row.conditions).toContain(Number(row.amount) === 5 ? "AGRI/BUSINESS CHECKING" : "AGRI/BUSINESS INTEREST CHECKING");
        expect(row.conditions).toContain(Number(row.amount) === 5 ? "$50.00" : "$500.00");
        expect(JSON.stringify(row.outlier_flags)).not.toContain("needs_darwin_verification");
        // Even an ordinary candidate insert at this exact raw identity cannot clear the hold.
        expect(await extract.insertCandidate(tx, { runId: fixture.runId,
          row: { document_text_id: fixture.textId, source_document_id: fixture.documentId,
            institution_id: fixture.institutionId, source_url: beforeState.source_url, text_hash: hash } as Parameters<typeof extract.insertCandidate>[1]["row"],
          candidate: { feeName: String(row.fee_name), amount: Number(row.amount), frequency: "monthly",
            canonicalHint: "monthly_maintenance", confidence: .95, excerpt: String(row.conditions), waivable: false } })).toBe(false);
      }
      await stages();
      expect(await tx`SELECT fee_raw_id,fee_name,amount,frequency,conditions,extraction_note,outlier_flags
        FROM raw_fee_observations WHERE institution_id=${fixture.institutionId}
        AND outlier_flags ? 'knox_review:eligibility' ORDER BY fee_raw_id`).toEqual(held);
      expect(await tx`SELECT fee_verified_id FROM verified_fee_observations
        WHERE fee_raw_id=ANY(${held.map(row => Number(row.fee_raw_id))}::bigint[])`).toHaveLength(0);
      expect(await tx`SELECT id FROM published_fee_catalog WHERE institution_id=${fixture.institutionId}
        AND fee_raw_id=ANY(${held.map(row => Number(row.fee_raw_id))}::bigint[])`).toHaveLength(0);
      const oldHeld = await tx`SELECT fee_published_id,rolled_back_reason FROM published_fee_records
        WHERE fee_published_id=ANY(${[mapping.publishedMap.get(56057)!, mapping.publishedMap.get(56058)!]}::bigint[])
        AND rolled_back_at IS NOT NULL`;
      expect(oldHeld).toHaveLength(2);
      expect(oldHeld.every(row => String(row.rolled_back_reason).startsWith("account_type_hold: business"))).toBe(true);
      const savings = await tx`SELECT fr.fee_name,fr.product_name,fr.outlier_flags,fv.outlier_flags AS verified_flags,
        fv.review_status FROM raw_fee_observations fr LEFT JOIN verified_fee_observations fv ON fv.fee_raw_id=fr.fee_raw_id
        WHERE fr.institution_id=${fixture.institutionId} AND fr.amount=5`;
      // The pre-existing lineup-correct path can later mislabel this raw product as
      // MONEY MARKET ACCOUNT (separate ownership finding). Its verified savings hold
      // must survive that metadata change and every restoration owner.
      const savingsRow = savings.find(row => row.fee_name === 'monthly fee if balance goes below minimum balance');
      expect(savingsRow).toBeDefined();
      expect(JSON.stringify(savingsRow?.verified_flags)).toContain("account_type:savings");
      expect(await tx`SELECT pc.id FROM published_fee_catalog pc JOIN raw_fee_observations fr ON fr.fee_raw_id=pc.fee_raw_id
        WHERE pc.institution_id=${fixture.institutionId} AND fr.fee_name='monthly fee if balance goes below minimum balance'
        AND fr.amount=5`).toHaveLength(0);
    });
  }, 60_000);
  it("keeps a unique literal checking owner eligible through the same normal stages", async () => {
    await rolledBack(async tx => {
      const text = "Freedom Checking\nMonthly service fee | $9.00 per month\nStop Payment | $30.00\nMoney Order | $3.00";
      const fixture = await seed(tx, text);
      await extract.runKnoxExtract({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId, limit: 10 });
      await darwin.runDarwinVerify({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId, limit: 100 });
      await fullPublish(tx, fixture);
      expect(await tx`SELECT amount FROM published_fee_catalog WHERE institution_id=${fixture.institutionId}
        AND fee_category='monthly_maintenance'`).toEqual([expect.objectContaining({ amount: 9 })]);
    });
  }, 60_000);
  it.each([false, true])("holds an accepted paid quote with heading/balance=%s at the common writer", async headed => {
    await rolledBack(async tx => {
      const text = readFileSync(new URL("./__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
      const fixture = await seed(tx, text);
      const { groundPaidRow, KNOX_PAID_FLAG } = await import("./paid-extract");
      const paid = groundPaidRow({ fee_name: "Monthly fee", canonical_key: "monthly_maintenance", amount: 5,
        frequency: "monthly", source_line: headed ? "PERSONAL CHECKING\n• $50.00 average monthly balance\n• No per check charge\n• $5.00 monthly fee if balance goes below average\nminimum balance"
          : "• $5.00 monthly fee if balance goes below average minimum balance" }, text);
      expect(typeof paid).not.toBe("string");
      if (typeof paid === "string") throw new Error(paid);
      const row = { document_text_id: fixture.textId, source_document_id: fixture.documentId,
        institution_id: fixture.institutionId, institution_name: "Oakwood Bank", normalized_text: text,
        source_url: beforeState.source_url, text_hash: createHash("sha256").update(text).digest("hex") } as Parameters<typeof extract.insertCandidate>[1]["row"];
      const candidate = { feeName: paid.feeName, amount: paid.amount, frequency: paid.frequency,
        canonicalHint: paid.canonicalKey, confidence: .91, excerpt: paid.sourceLine, waivable: false, lineup: paid.lineup };
      expect(await extract.insertCandidate(tx, { runId: fixture.runId, row, candidate, extraFlags: [KNOX_PAID_FLAG] })).toBe(true);
      await automaticHeldPasses(tx, fixture);
      await darwin.runDarwinVerify({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId, limit: 100 });
      await fullPublish(tx, fixture);
      const [held] = await tx`SELECT outlier_flags,conditions FROM raw_fee_observations
        WHERE institution_id=${fixture.institutionId} AND fee_name='Monthly fee' AND amount=5`;
      expect(JSON.stringify(held.outlier_flags)).toContain("knox_review:eligibility");
      expect(JSON.stringify(held.outlier_flags)).toContain(KNOX_PAID_FLAG);
      expect(JSON.stringify(held.outlier_flags)).not.toContain("needs_darwin_verification");
      expect(held.conditions).toContain("PERSONAL CHECKING");
      expect(held.conditions).toContain("AGRI/BUSINESS CHECKING");
      expect(await tx`SELECT id FROM published_fee_catalog WHERE institution_id=${fixture.institutionId}`).toHaveLength(0);
    });
  }, 60_000);
  it("loads an exact source witness for a minimal caller and declines missing/mismatched witnesses", async () => {
    await rolledBack(async tx => {
      const text = readFileSync(new URL("./__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8").trim();
      const fixture = await seed(tx, text);
      const row = { document_text_id: fixture.textId, source_document_id: fixture.documentId,
        institution_id: fixture.institutionId, source_url: beforeState.source_url,
        text_hash: createHash("sha256").update(text).digest("hex") };
      const candidate = { feeName: "Monthly fee", amount: 5, frequency: "monthly", canonicalHint: "monthly_maintenance",
        confidence: .91, excerpt: "• $5.00 monthly fee if balance goes below average minimum balance", waivable: false };
      for (const mismatch of [{ ...row, text_hash: '0'.repeat(64) }, { ...row, document_text_id: -1 },
        { ...row, source_document_id: -1 }, { ...row, institution_id: -1 }, { ...row, text_hash: null }])
        expect(await extract.insertCandidate(tx, { runId: fixture.runId, row: mismatch, candidate })).toBe(false);
      expect(await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE institution_id=${fixture.institutionId}`).toHaveLength(0);
      expect(await extract.insertCandidate(tx, { runId: fixture.runId, row, candidate })).toBe(true);
      const [held] = await tx`SELECT outlier_flags,conditions FROM raw_fee_observations WHERE institution_id=${fixture.institutionId}`;
      expect(JSON.stringify(held.outlier_flags)).toContain("knox_review:eligibility");
      expect(JSON.stringify(held.outlier_flags)).not.toContain("needs_darwin_verification");
      expect(held.conditions).toContain("PERSONAL CHECKING");
      expect(held.conditions).toContain("AGRI/BUSINESS CHECKING");
    });
  }, 60_000);
  it.each([null, "PERSONAL CHECKING"])("a common zero-price write keeps assigned owner %s or stays eligibility-held", async product => {
    await rolledBack(async tx => {
      const text = "PERSONAL CHECKING\nMonthly fee $0.00\nBUSINESS CHECKING\nMonthly fee $0.00";
      const fixture = await seed(tx, text);
      const { groundPaidRow } = await import("./paid-extract");
      const paid = groundPaidRow({ fee_name: "Monthly fee", canonical_key: "monthly_maintenance", amount: 0,
        frequency: "monthly", source_line: "Monthly fee $0.00", product_name: product }, text);
      // The current paid source gate declines this generic zero quote; directly exercise
      // the common held writer too, rather than claiming a paid row currently passes it.
      expect(paid).toBe("not_in_text");
      expect(await extract.insertHeldCandidate(tx, { runId: fixture.runId,
        row: { document_text_id: fixture.textId, source_document_id: fixture.documentId,
          institution_id: fixture.institutionId, source_url: beforeState.source_url,
          text_hash: createHash("sha256").update(text).digest("hex"), normalized_text: text },
        assignedMonthlyProduct: product,
        held: { shape: "zero", feeName: "Monthly fee", amount: 0, amountMax: null, percent: null,
          frequency: "monthly", canonicalHint: "monthly_maintenance", excerpt: "Monthly fee $0.00" } })).toBe(true);
      const [row] = await tx`SELECT outlier_flags FROM raw_fee_observations WHERE institution_id=${fixture.institutionId}`;
      expect(JSON.stringify(row.outlier_flags)).toContain(product ? "knox_review:zero" : "knox_review:eligibility");
      expect(JSON.stringify(row.outlier_flags).includes("needs_darwin_verification")).toBe(Boolean(product));
    });
  }, 30_000);
  it("keeps separate line-share identities valid even when their nonunique event ID is the same", async () => {
    await rolledBack(async tx => {
      const text = "Unknown account service $12";
      const fixture = await seed(tx, text);
      const row = { document_text_id: fixture.textId, source_document_id: fixture.documentId,
        institution_id: fixture.institutionId, source_url: beforeState.source_url,
        text_hash: createHash("sha256").update(text).digest("hex"), normalized_text: text };
      const held = { shape: "unclassified" as const, feeName: "Unknown account service", amount: 12,
        amountMax: null, percent: null, frequency: null, canonicalHint: null, excerpt: text };
      expect(await extract.insertHeldCandidate(tx, { runId: fixture.runId, row, held })).toBe(true);
      expect(await extract.insertHeldCandidate(tx, { runId: fixture.runId, row,
        held: { ...held, lineShare: "different-key-same-event" } })).toBe(true);
      expect(await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE institution_id=${fixture.institutionId}`).toHaveLength(2);
      const repeated = { ...held, lineShare: "different-key-same-event" };
      expect(await extract.insertHeldCandidate(tx, { runId: fixture.runId, row, held: repeated })).toBe(false);
    });
  }, 30_000);
  it("keeps separate monthly held keys safe and idempotent under the same nonunique event ID", async () => {
    await rolledBack(async tx => {
      const text = "PERSONAL CHECKING\nMonthly fee $5\nBUSINESS CHECKING\nMonthly fee $5";
      const fixture = await seed(tx, text);
      const row = { document_text_id: fixture.textId, source_document_id: fixture.documentId,
        institution_id: fixture.institutionId, source_url: beforeState.source_url,
        text_hash: createHash("sha256").update(text).digest("hex"), normalized_text: text };
      const candidate = { feeName: "Monthly fee", amount: 5, frequency: "monthly", confidence: .91,
        canonicalHint: "monthly_maintenance", excerpt: "Monthly fee $5", waivable: false };
      for (const lineShare of ["", "second-monthly-key"]) {
        expect(await extract.insertCandidate(tx, { runId: fixture.runId, row, candidate: { ...candidate, lineShare } })).toBe(true);
        expect(await extract.insertCandidate(tx, { runId: fixture.runId, row, candidate: { ...candidate, lineShare } })).toBe(false);
      }
      const rows = await tx`SELECT agent_event_id,outlier_flags FROM raw_fee_observations WHERE institution_id=${fixture.institutionId}`;
      expect(rows).toHaveLength(2);
      expect(rows[0].agent_event_id).toBe(rows[1].agent_event_id);
      expect(rows.every(raw => JSON.stringify(raw.outlier_flags).includes("knox_review:eligibility"))).toBe(true);
      expect(rows.every(raw => !JSON.stringify(raw.outlier_flags).includes("needs_darwin_verification"))).toBe(true);
    });
  }, 30_000);
  it("takes over an exact unverified pending identity as held, and preserves a judged identity", async () => {
    await rolledBack(async tx => {
      const text = readFileSync(new URL("./__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
      const fixture = await seed(tx, text);
      const hash = createHash("sha256").update(text).digest("hex");
      const sourceLine = "• $5.00 monthly fee if balance goes below average minimum balance";
      const row = { document_text_id: fixture.textId, source_document_id: fixture.documentId,
        institution_id: fixture.institutionId, institution_name: "Oakwood Bank", normalized_text: text,
        source_url: beforeState.source_url, text_hash: hash } as Parameters<typeof extract.insertCandidate>[1]["row"];
      const candidate = { feeName: "Monthly fee", amount: 5, frequency: "monthly", canonicalHint: "monthly_maintenance",
        confidence: .91, excerpt: sourceLine, waivable: false };
      const pendingNote = `Knox deterministic extraction. canonical_hint=monthly_maintenance; text_hash=${hash}; excerpt="${sourceLine}"`;
      const [{ fee_raw_id: pendingId }] = await tx`INSERT INTO raw_fee_observations
        (institution_id,source_document_id,source_url,source,extraction_confidence,agent_event_id,fee_name,amount,frequency,
        extraction_note,outlier_flags) VALUES (${fixture.institutionId},${fixture.documentId},${beforeState.source_url},
        'knox',.91,gen_random_uuid(),'Monthly fee',5,'monthly',${pendingNote},'["needs_darwin_verification","canonical_hint:monthly_maintenance"]'::jsonb)
        RETURNING fee_raw_id`;
      expect(await extract.insertCandidate(tx, { runId: fixture.runId, row, candidate })).toBe(true);
      const [pending] = await tx`SELECT fee_raw_id,outlier_flags,conditions FROM raw_fee_observations WHERE fee_raw_id=${pendingId}`;
      expect(JSON.stringify(pending.outlier_flags)).toContain("knox_review:eligibility");
      expect(JSON.stringify(pending.outlier_flags)).not.toContain("needs_darwin_verification");
      expect(pending.conditions).toContain("AGRI/BUSINESS CHECKING");
      await automaticHeldPasses(tx, fixture);
      await darwin.runDarwinVerify({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId, limit: 100 });
      await fullPublish(tx, fixture);
      expect(await tx`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_raw_id=${pendingId}`).toHaveLength(0);
      expect(await extract.insertCandidate(tx, { runId: fixture.runId, row, candidate })).toBe(false);

      const [{ fee_raw_id: judgedId }] = await tx`INSERT INTO raw_fee_observations
        (institution_id,source_document_id,source_url,source,extraction_confidence,agent_event_id,fee_name,amount,frequency,
        extraction_note,outlier_flags) VALUES (${fixture.institutionId},${fixture.documentId},${beforeState.source_url},
        'knox',.91,gen_random_uuid(),'Monthly service fee',5,'monthly',${pendingNote},'["needs_darwin_verification","canonical_hint:monthly_maintenance"]'::jsonb)
        RETURNING fee_raw_id`;
      await tx`INSERT INTO verified_fee_observations(fee_raw_id,institution_id,source_url,extraction_confidence,
        canonical_fee_key,verified_by_agent_event_id,fee_name,amount,frequency,review_status,outlier_flags)
        VALUES (${judgedId},${fixture.institutionId},${beforeState.source_url},.91,'monthly_maintenance',gen_random_uuid(),
        'Monthly service fee',5,'monthly','rejected','["source_check_rejected"]'::jsonb)`;
      const [before] = await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${judgedId}`;
      expect(await extract.insertCandidate(tx, { runId: fixture.runId, row,
        candidate: { ...candidate, feeName: "Monthly service fee" } })).toBe(false);
      expect((await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${judgedId}`)[0]).toEqual(before);
    });
  }, 60_000);
});
