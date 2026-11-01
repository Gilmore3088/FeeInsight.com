// @vitest-environment node
/**
 * Knox's read lessons (#2062) in an owned loopback database with the production schema: which feedback
 * rows teach (frequency fixes still live, takedowns still down, Knox's own duplicates, promoted lines
 * Darwin verified), and the held raw row a lesson's read writes. Every fixture runs in a transaction
 * that is rolled back. No provider or network call.
 */
import postgres from "postgres";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtractedFeeCandidate } from "./rules";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));
vi.mock("@/lib/agents/fee-source-fetch", async (original) => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Read lesson fixtures forbid network and provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;

describe.skipIf(!connection)("Knox learns its reads from other checks' fixes (#2062)", () => {
  let db: postgres.Sql;
  let appSql: Db;
  let extract: typeof import("./extract");
  let lessons: typeof import("./read-lessons");
  let nextRunId = 1_690_000_000 - process.pid * 100;
  let nextKey = 0;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("Read lesson tests require a disposable loopback production-schema database");
    vi.stubEnv("DATABASE_URL", connection);
    const connectionModule = await import("@/lib/data-store/connection");
    appSql = connectionModule.sql;
    db = postgres(connection, { max: 2, ssl: "require", types: { numeric: connectionModule.NUMERIC_AS_NUMBER, json: connectionModule.JSON_TEXT_PASSTHROUGH, text: connectionModule.TEXT_WITHOUT_NUL } }) as unknown as postgres.Sql;
    extract = await import("./extract");
    lessons = await import("./read-lessons");
  });
  afterAll(async () => { if (db) await db.end(); if (appSql) await appSql.end(); vi.unstubAllEnvs(); });

  async function rollback(test: (tx: Db) => Promise<void>) {
    const stop = new Error("rollback read lesson fixture");
    await db.begin(async (scope) => { await test(scope as unknown as Db); throw stop; }).catch((error) => { if (error !== stop) throw error; });
  }
  const candidate = (feeName: string, amount: number, frequency: string | null = null, canonicalHint = "stop_payment"): ExtractedFeeCandidate =>
    ({ feeName, amount, frequency, canonicalHint, confidence: 0.95, excerpt: `${feeName} | $${amount.toFixed(2)}`, waivable: false });

  async function bank(tx: Db) {
    const [{ id }] = await tx`INSERT INTO institution_sources(institution_name,website_url,charter_type,state,state_code,source,status)
      VALUES('Read lesson fixture','https://read-lesson.example/','bank','Texas','TX','e2e','active') RETURNING id`;
    const [{ id: runId }] = await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
      VALUES(${nextRunId--},'knox','state_agent','Read lesson fixture','running') RETURNING id`;
    return { institutionId: Number(id), runId: Number(runId) };
  }
  type Bank = Awaited<ReturnType<typeof bank>>;
  async function document(tx: Db, b: Bank, text: string) {
    const url = `https://read-lesson.example/fees/${randomUUID()}.pdf`, hash = createHash("sha256").update(text).digest("hex");
    const [{ id: documentId }] = await tx`INSERT INTO source_documents(institution_id,status,document_url,content_hash,content_type)
      VALUES(${b.institutionId},'success',${url},${createHash("sha256").update(url).digest("hex")},'application/pdf') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts(agent_run_id,source_document_id,institution_id,source_url,
      document_type,content_type,status,normalized_text,text_hash,char_count)
      VALUES(${b.runId},${documentId},${b.institutionId},${url},'text_pdf','application/pdf','completed',${text},${hash},${text.length}) RETURNING id`;
    return { documentId: Number(documentId), row: { document_text_id: Number(textId), source_document_id: Number(documentId), institution_id: b.institutionId,
      source_url: url, normalized_text: text, text_hash: hash, institution_name: "Read lesson fixture" } as Parameters<typeof extract.insertCandidate>[1]["row"] };
  }
  type Doc = Awaited<ReturnType<typeof document>>;
  /** A fee Knox read from the document, verified and published; down with `reason` when one is given. */
  async function published(tx: Db, b: Bank, doc: Doc, c: ExtractedFeeCandidate, options: { reason?: string | null; frequency?: string | null; reviewStatus?: string } = {}) {
    expect(await extract.insertCandidate(tx, { runId: b.runId, row: doc.row, candidate: c })).toBe(true);
    const [{ fee_raw_id: rawId }] = await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE source_document_id=${doc.documentId} AND fee_name=${c.feeName} AND amount=${c.amount}`;
    const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations(fee_raw_id,institution_id,source_url,
      canonical_fee_key,verified_by_agent_event_id,fee_name,amount,frequency,fee_audience,amount_kind,review_status)
      SELECT fee_raw_id,institution_id,source_url,${c.canonicalHint},agent_event_id,fee_name,amount,frequency,fee_audience,'flat',${options.reviewStatus ?? "verified"}
      FROM raw_fee_observations WHERE fee_raw_id=${rawId} RETURNING fee_verified_id`;
    const reason = options.reason ?? null;
    const [{ fee_published_id: publishedId }] = await tx`INSERT INTO published_fee_records(lineage_ref,institution_id,canonical_fee_key,
      fee_name,amount,frequency,fee_audience,amount_kind,published_by_adversarial_event_id,verified_by_agent_event_id,agent_event_id,batch_id,
      rolled_back_at,rolled_back_reason)
      SELECT fv.fee_verified_id,fv.institution_id,fv.canonical_fee_key,fv.fee_name,fv.amount,${options.frequency === undefined ? c.frequency : options.frequency},
      fv.fee_audience,'flat',fv.verified_by_agent_event_id,fv.verified_by_agent_event_id,fr.agent_event_id,'initial',
      ${reason == null ? null : new Date()},${reason}
      FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
      WHERE fv.fee_verified_id=${verifiedId} RETURNING fee_published_id`;
    return { rawId: Number(rawId), verifiedId: Number(verifiedId), publishedId: Number(publishedId) };
  }
  async function feedback(tx: Db, b: Bank, row: { kind: string; check: string; stage?: string; publishedId?: number | null; rawId?: number | null;
    documentId?: number | null; amount?: number | null; category?: string | null; evidence: Record<string, unknown> }) {
    const [{ id }] = await tx`INSERT INTO pipeline_feedback(about_stage,signal,kind,reported_by,check_name,institution_id,fee_published_id,fee_raw_id,
      source_document_id,amount,canonical_fee_key,weight,dedupe_key,evidence)
      VALUES(${row.stage ?? "extract"},'wrong',${row.kind},'hamilton',${row.check},${b.institutionId},${row.publishedId ?? null},${row.rawId ?? null},
        ${row.documentId ?? null},${row.amount ?? null},${row.category ?? null},1,${`read-lesson-test:${process.pid}:${nextKey++}`},${tx.json(row.evidence as never)}) RETURNING id`;
    return Number(id);
  }

  it("learns only from fixes still standing, Knox's own duplicates, and promoted lines Darwin verified that are live", async () => {
    await rollback(async (tx) => {
      const b = await bank(tx);
      const doc = await document(tx, b, "Fee Schedule\nStop Payment | $30.00 each\nAccount closing fee | /mo. $40.00\n");
      const other = await document(tx, b, "Fee Schedule (2026)\nAccount closing fee | $40.00\n");
      // Frequency: a fill still on the live row teaches; one the live row no longer carries does not.
      const filled = await published(tx, b, doc, candidate("Stop Payment", 30), { frequency: "per_item" });
      const fill = await feedback(tx, b, { kind: "frequency_filled", check: "hamilton.frequency_fill", publishedId: filled.publishedId, evidence: { from: null, to: "per_item" } });
      const reverted = await published(tx, b, doc, candidate("Returned Item", 25, "annual"), { frequency: "annual" });
      await feedback(tx, b, { kind: "frequency_cleared", check: "hamilton.frequency_fill", publishedId: reverted.publishedId, evidence: { from: "annual", to: null } });
      // Holds: a wrong payer still down teaches; one brought back does not.
      const payer = await published(tx, b, doc, candidate("Official Check (Non-Customers)", 20), { reason: "eval_critical:wrong_payer" });
      const payerLesson = await feedback(tx, b, { kind: "wrong_payer", check: "hamilton.eval_verdict", publishedId: payer.publishedId, evidence: { reason: "eval_critical:wrong_payer" } });
      const restored = await published(tx, b, doc, candidate("Money Order (Non-Customer)", 3));
      await feedback(tx, b, { kind: "wrong_payer", check: "hamilton.eval_verdict", publishedId: restored.publishedId, evidence: {} });
      const held = await published(tx, b, doc, candidate("NSF Fee", 23, "monthly", "nsf"), { reason: "frequency_hold: NSF fee priced by the month" });
      await feedback(tx, b, { kind: "frequency_held", check: "hamilton.frequency_fill", publishedId: held.publishedId, evidence: { from: "monthly", held: true } });
      // A frequency hold since restored (live again) holds nothing.
      const unheld = await published(tx, b, doc, candidate("Returned Check", 10, "monthly", "nsf"));
      await feedback(tx, b, { kind: "frequency_held", check: "hamilton.frequency_fill", publishedId: unheld.publishedId, evidence: { from: "monthly", held: true } });
      // A hand takedown names its issue after the kept fee: "duplicate of #k (#issue)".
      const keptStatement = await published(tx, b, doc, candidate("Paper Statement", 3, null, "paper_statement"));
      const handTwin = await published(tx, b, doc, candidate("Paper Statement Fee", 3, null, "paper_statement"), { reason: `duplicate of #${keptStatement.publishedId} (#1302)` });
      const handLesson = await feedback(tx, b, { kind: "duplicate", check: "hamilton.hand_takedown", publishedId: handTwin.publishedId, evidence: {} });
      // No lesson: a kept twin since taken down, and a same-name twin (one line read twice under one name).
      const keptGone = await published(tx, b, doc, candidate("Wire Fee", 25, null, "wire_domestic_outgoing"), { reason: "category_guard: test" });
      const orphan = await published(tx, b, doc, candidate("Wire Fee Each", 25, null, "wire_domestic_outgoing"), { reason: `duplicate of #${keptGone.publishedId}` });
      await feedback(tx, b, { kind: "duplicate", check: "hamilton.duplicate_collapse", publishedId: orphan.publishedId, evidence: {} });
      // Duplicates: a twin on the same document under another name teaches; one on another document does not.
      const kept = await published(tx, b, doc, candidate("Account closing fee", 40, null, "early_closure"));
      const twin = await published(tx, b, doc, candidate("Account closing fee | /mo.", 40, null, "early_closure"), { reason: `duplicate of #${kept.publishedId}` });
      const dupLesson = await feedback(tx, b, { kind: "duplicate", check: "hamilton.duplicate_collapse", publishedId: twin.publishedId, evidence: {} });
      // The same name read twice on one document (one line, two spellings of one name) is not Knox's duplicate.
      const sameName = await published(tx, b, doc, candidate("Account closing fee:", 40, null, "early_closure"), { reason: `duplicate of #${kept.publishedId}` });
      await feedback(tx, b, { kind: "duplicate", check: "hamilton.duplicate_collapse", publishedId: sameName.publishedId, evidence: {} });
      const elsewhere = await published(tx, b, other, candidate("Account closing fee", 40, null, "early_closure"), { reason: `duplicate of #${kept.publishedId}` });
      await feedback(tx, b, { kind: "duplicate", check: "hamilton.duplicate_collapse", publishedId: elsewhere.publishedId, evidence: {} });
      // Promotions: verified and live teaches, under Darwin's category; rejected does not.
      const promoted = await published(tx, b, doc, candidate("Courtesy Pay", 35, null, "overdraft"));
      const promoLesson = await feedback(tx, b, { kind: "promoted_from_held", check: "knox.held_recheck", rawId: promoted.rawId, documentId: doc.documentId,
        amount: 35, category: "nsf", evidence: { fee_name: "Courtesy Pay", promoted_to: "nsf" } });
      const rejected = await published(tx, b, doc, candidate("Skip Pay", 15, null, "overdraft"), { reviewStatus: "rejected" });
      await feedback(tx, b, { kind: "promoted_from_held", check: "knox.held_recheck", rawId: rejected.rawId, documentId: doc.documentId, amount: 15,
        evidence: { fee_name: "Skip Pay" } });

      const loaded = await lessons.loadReadLessons(tx, [doc.documentId, other.documentId]);
      expect(loaded.readFailed).toBeUndefined();
      expect(loaded.loaded).toEqual({ frequency: 1, wrong_payer: 1, frequency_held: 1, duplicate: 2, promoted_from_held: 1 });
      expect(lessons.frequencyLessonFor(candidate("Stop Payment", 30), loaded, doc.documentId)).toMatchObject({ feedbackId: fill, to: "per_item" });
      expect(lessons.frequencyLessonFor(candidate("Returned Item", 25, "annual"), loaded, doc.documentId)).toBeNull();
      const none = new Set<string>();
      expect(lessons.holdLessonFor(candidate("Official Check (Non-Customers)", 20), loaded, doc.documentId, none)).toMatchObject({ feedbackId: payerLesson, kind: "wrong_payer" });
      expect(lessons.holdLessonFor(candidate("Money Order (Non-Customer)", 3), loaded, doc.documentId, none)).toBeNull();
      expect(lessons.holdLessonFor(candidate("NSF Fee", 23, "monthly", "nsf"), loaded, doc.documentId, none)).toMatchObject({ kind: "frequency_held", check: "hamilton.frequency_fill" });
      // The restored frequency hold holds nothing.
      expect(lessons.holdLessonFor(candidate("Returned Check", 10, "monthly", "nsf"), loaded, doc.documentId, none)).toBeNull();
      // The hand takedown's "duplicate of #k (#issue)" names its kept fee.
      const statements = lessons.documentReadKeys([candidate("Paper Statement", 3), candidate("Paper Statement Fee", 3)]);
      expect(lessons.holdLessonFor(candidate("Paper Statement Fee", 3), loaded, doc.documentId, statements))
        .toMatchObject({ feedbackId: handLesson, kind: "duplicate", check: "hamilton.hand_takedown", keeper: "paper statement", keeperPublishedId: keptStatement.publishedId });
      // A twin whose kept fee is down teaches nothing.
      expect(lessons.holdLessonFor(candidate("Wire Fee Each", 25), loaded, doc.documentId, lessons.documentReadKeys([candidate("Wire Fee", 25), candidate("Wire Fee Each", 25)]))).toBeNull();
      const reads = lessons.documentReadKeys([candidate("Account closing fee", 40), candidate("Account closing fee | /mo.", 40)]);
      expect(lessons.holdLessonFor(candidate("Account closing fee | /mo.", 40), loaded, doc.documentId, reads))
        .toMatchObject({ feedbackId: dupLesson, kind: "duplicate", keeper: "account closing fee" });
      expect(lessons.holdLessonFor(candidate("Account closing fee", 40), loaded, other.documentId, reads)).toBeNull();
      expect(lessons.promotionLessonFor({ shape: "unclassified", feeName: "Courtesy Pay", amount: 35, amountMax: null, percent: null, frequency: null,
        canonicalHint: null, excerpt: "Courtesy Pay | $35.00" }, loaded, doc.documentId)).toEqual({ feedbackId: promoLesson, category: "overdraft" });
      // Another document of the bank, and an unrelated document, read nothing.
      expect((await lessons.loadReadLessons(tx, [987654321])).loaded).toEqual({});
    });
  });

  it("an extract step counts the lessons' reads while off, and applies them on", async () => {
    const text = "Fee Schedule\nStop Payment | $30.00\nOfficial Check | $8.00\nCoin Counting | $5.00\n";
    const seed = async (tx: Db) => {
      const b = await bank(tx);
      const doc = await document(tx, b, text);
      // An earlier read of each line, under a name today's rules spell another way: the fill gave the
      // stop payment its frequency, and the eval took the official check down as a wrong payer.
      const stop = await published(tx, b, doc, candidate("Stop Payment:", 30), { frequency: "per_item" });
      await feedback(tx, b, { kind: "frequency_filled", check: "hamilton.frequency_fill", publishedId: stop.publishedId, evidence: { from: null, to: "per_item" } });
      const check = await published(tx, b, doc, candidate("Official Check:", 8, null, "cashiers_check"), { reason: "eval_critical:wrong_payer" });
      await feedback(tx, b, { kind: "wrong_payer", check: "hamilton.eval_verdict", publishedId: check.publishedId, evidence: {} });
      return { b, doc };
    };
    const reads = (tx: Db, documentId: number) => tx<Array<{ fee_name: string; frequency: string | null; outlier_flags: string[] }>>`
      SELECT fee_name, frequency, outlier_flags FROM raw_fee_observations
       WHERE source_document_id=${documentId} AND fee_name IN ('Stop Payment','Official Check') ORDER BY fee_name`;
    await rollback(async (tx) => {
      vi.stubEnv(lessons.KNOX_READ_LESSONS_SWITCH, "");
      const { b, doc } = await seed(tx);
      const result = await extract.runKnoxExtract({ db: tx, runId: b.runId, institutionId: b.institutionId, limit: 5 });
      expect(result.readLessonsLive).toBe(false);
      expect(result.readLessonsLoaded).toEqual({ frequency: 1, wrong_payer: 1 });
      expect(result.readLessonMatches).toEqual({ frequency: 1, wrong_payer: 1 });
      const [check, stop] = await reads(tx, doc.documentId);
      expect(stop.frequency).toBeNull();
      expect(check.outlier_flags).toContain("needs_darwin_verification");
      expect(check.outlier_flags).not.toContain("knox_review:taken_down");
    });
    await rollback(async (tx) => {
      vi.stubEnv(lessons.KNOX_READ_LESSONS_SWITCH, "true");
      const { b, doc } = await seed(tx);
      const result = await extract.runKnoxExtract({ db: tx, runId: b.runId, institutionId: b.institutionId, limit: 5 });
      expect(result.readLessonsLive).toBe(true);
      expect(result.readLessonMatches).toEqual({ frequency: 1, wrong_payer: 1 });
      expect(result.takedownHolds).toEqual({ "hamilton.eval_verdict": 1 });
      const [check, stop] = await reads(tx, doc.documentId);
      expect(stop.frequency).toBe("per_item");
      expect(stop.outlier_flags).toEqual(expect.arrayContaining(["needs_darwin_verification", "knox_lesson:read:frequency"]));
      expect(check.outlier_flags).toEqual(expect.arrayContaining(["knox_review:taken_down", "knox_lesson:read:wrong_payer"]));
      expect(check.outlier_flags).not.toContain("needs_darwin_verification");
    });
    vi.stubEnv(lessons.KNOX_READ_LESSONS_SWITCH, "");
  });

  it("writes a held lesson's read held for review under its check, never sent to Darwin, only while the fix still stands", async () => {
    await rollback(async (tx) => {
      const b = await bank(tx);
      const doc = await document(tx, b, "Fee Schedule\nOfficial Check (Non-Customers) | $20.00\nMoney Order | $3.00\n");
      const payer = await published(tx, b, doc, candidate("Official Check (Non-Customers):", 20, null, "cashiers_check"), { reason: "eval_critical:wrong_payer" });
      await feedback(tx, b, { kind: "wrong_payer", check: "hamilton.eval_verdict", publishedId: payer.publishedId, evidence: {} });
      const loaded = await lessons.loadReadLessons(tx, [doc.documentId]);
      const read = candidate("Official Check (Non-Customers)", 20, null, "cashiers_check");
      const lesson = lessons.holdLessonFor(read, loaded, doc.documentId, new Set())!;
      expect(lesson).toMatchObject({ kind: "wrong_payer", publishedId: payer.publishedId });
      expect(await extract.insertReadLessonHold(tx, { runId: b.runId, row: doc.row, candidate: read, extraFlags: [lessons.readLessonFlag("wrong_payer")] }, lesson)).toBe("held");
      const [raw] = await tx`SELECT outlier_flags FROM raw_fee_observations WHERE source_document_id=${doc.documentId} AND fee_name=${read.feeName}`;
      expect(raw.outlier_flags).toEqual(expect.arrayContaining(["knox_review:taken_down", "knox_lesson:taken_down:hamilton.eval_verdict", "knox_lesson:read:wrong_payer"]));
      expect(raw.outlier_flags).not.toContain("needs_darwin_verification");
      // An existing row keeps every fact: a second hold writes nothing.
      expect(await extract.insertReadLessonHold(tx, { runId: b.runId, row: doc.row, candidate: read }, lesson)).toBe("existing");
      // A paid/returned pair goes its own event path while the lesson still stands: its own outcome, nothing written here.
      expect(await extract.insertReadLessonHold(tx, { runId: b.runId, row: doc.row, candidate: candidate("NSF - Paid", 20, null, "overdraft") }, lesson)).toBe("paid_returned");
      expect(await tx`SELECT 1 FROM raw_fee_observations WHERE source_document_id=${doc.documentId} AND fee_name='NSF - Paid'`).toHaveLength(0);
      // Restored between load and insert: the hold re-checks in its insert and writes nothing.
      await tx`UPDATE published_fee_records SET rolled_back_at=NULL, rolled_back_reason=NULL WHERE fee_published_id=${payer.publishedId}`;
      const money = candidate("Money Order", 3, null, "money_order");
      expect(await extract.insertReadLessonHold(tx, { runId: b.runId, row: doc.row, candidate: money }, lesson)).toBe("lesson_gone");
      expect(await tx`SELECT 1 FROM raw_fee_observations WHERE source_document_id=${doc.documentId} AND fee_name='Money Order'`).toHaveLength(0);
    });
  });

  it("drops a duplicate's hold when its kept fee is taken down after the lessons load", async () => {
    await rollback(async (tx) => {
      const b = await bank(tx);
      const doc = await document(tx, b, "Fee Schedule\nAccount closing fee | /mo. $40.00\n");
      const kept = await published(tx, b, doc, candidate("Account closing fee", 40, null, "early_closure"));
      const twin = await published(tx, b, doc, candidate("Account closing fee | /mo.", 40, null, "early_closure"), { reason: `duplicate of #${kept.publishedId}` });
      await feedback(tx, b, { kind: "duplicate", check: "hamilton.duplicate_collapse", publishedId: twin.publishedId, evidence: {} });
      const loaded = await lessons.loadReadLessons(tx, [doc.documentId]);
      const read = candidate("Account Closing Fee | /mo", 40, null, "early_closure");
      const lesson = lessons.holdLessonFor(read, loaded, doc.documentId, lessons.documentReadKeys([read, candidate("Account Closing Fee", 40)]))!;
      expect(lesson).toMatchObject({ kind: "duplicate", keeperPublishedId: kept.publishedId });
      await tx`UPDATE published_fee_records SET rolled_back_at=now(), rolled_back_reason='category_guard: test' WHERE fee_published_id=${kept.publishedId}`;
      expect(await extract.insertReadLessonHold(tx, { runId: b.runId, row: doc.row, candidate: read }, lesson)).toBe("lesson_gone");
      expect(await tx`SELECT 1 FROM raw_fee_observations WHERE source_document_id=${doc.documentId} AND fee_name=${read.feeName}`).toHaveLength(0);
    });
  });

  it("files a held line under the category Darwin verified for the document's earlier promoted read, only with the switch on", async () => {
    const text = "Fee Schedule\nStop Payment | $30.00\nZorblax Service | $12.00\nAccount Research | $25.00\n";
    const seed = async (tx: Db) => {
      const b = await bank(tx);
      const doc = await document(tx, b, text);
      const earlier = await published(tx, b, doc, candidate("Zorblax Service:", 12, null, "account_research"));
      await feedback(tx, b, { kind: "promoted_from_held", check: "knox.held_recheck", rawId: earlier.rawId, documentId: doc.documentId, amount: 12,
        category: "account_research", evidence: { fee_name: "Zorblax Service", promoted_to: "account_research" } });
      return { b, doc };
    };
    const zorblax = (tx: Db, documentId: number) => tx<Array<{ outlier_flags: string[] }>>`
      SELECT outlier_flags FROM raw_fee_observations WHERE source_document_id=${documentId} AND fee_name='Zorblax Service'`;
    await rollback(async (tx) => {
      vi.stubEnv(lessons.KNOX_READ_LESSONS_SWITCH, "");
      const { b, doc } = await seed(tx);
      const result = await extract.runKnoxExtract({ db: tx, runId: b.runId, institutionId: b.institutionId, limit: 5 });
      expect(result.readLessonMatches).toEqual({ promoted_from_held: 1 });
      // Off, the line is written held, as before, and never sent to Darwin.
      const [row] = await zorblax(tx, doc.documentId);
      expect(row.outlier_flags).not.toContain("needs_darwin_verification");
      expect(row.outlier_flags).not.toContain("knox_lesson:read:promoted_from_held");
    });
    await rollback(async (tx) => {
      vi.stubEnv(lessons.KNOX_READ_LESSONS_SWITCH, "true");
      const { b, doc } = await seed(tx);
      const result = await extract.runKnoxExtract({ db: tx, runId: b.runId, institutionId: b.institutionId, limit: 5 });
      expect(result.readLessonMatches).toEqual({ promoted_from_held: 1 });
      const [row] = await zorblax(tx, doc.documentId);
      expect(row.outlier_flags).toEqual(expect.arrayContaining(["needs_darwin_verification", "knox_lesson:read:promoted_from_held"]));
    });
    vi.stubEnv(lessons.KNOX_READ_LESSONS_SWITCH, "");
  });
});
