// @vitest-environment node
/**
 * Knox's audience lessons (#2062) in an owned loopback database with the production schema: which
 * confirmed business-schedule takedowns teach, and the raw row a learned read writes. Every fixture
 * runs in a transaction that is rolled back. No provider or network call.
 */
import postgres from "postgres";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtractedFeeCandidate } from "./rules";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));
vi.mock("@/lib/agents/fee-source-fetch", async (original) => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Audience lesson fixtures forbid network and provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;

describe.skipIf(!connection)("Knox learns the audience from confirmed business-schedule takedowns (#2062)", () => {
  let db: postgres.Sql;
  let appSql: Db;
  let extract: typeof import("./extract");
  let lessons: typeof import("./audience-lessons");
  let nextRunId = 1_700_000_000 - process.pid * 100;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("Audience lesson tests require a disposable loopback production-schema database");
    vi.stubEnv("DATABASE_URL", connection);
    const connectionModule = await import("@/lib/data-store/connection");
    appSql = connectionModule.sql;
    db = postgres(connection, { max: 2, ssl: "require", types: { numeric: connectionModule.NUMERIC_AS_NUMBER, json: connectionModule.JSON_TEXT_PASSTHROUGH, text: connectionModule.TEXT_WITHOUT_NUL } }) as unknown as postgres.Sql;
    extract = await import("./extract");
    lessons = await import("./audience-lessons");
  });
  afterAll(async () => { if (db) await db.end(); if (appSql) await appSql.end(); vi.unstubAllEnvs(); });

  async function rollback(test: (tx: Db) => Promise<void>) {
    const stop = new Error("rollback audience lesson fixture");
    await db.begin(async (scope) => { await test(scope as unknown as Db); throw stop; }).catch((error) => { if (error !== stop) throw error; });
  }
  const candidate = (feeName: string, amount: number, canonicalHint: string): ExtractedFeeCandidate =>
    ({ feeName, amount, frequency: null, canonicalHint, confidence: 0.95, excerpt: `${feeName} | $${amount.toFixed(2)}`, waivable: false });

  async function bank(tx: Db) {
    const [{ id }] = await tx`INSERT INTO institution_sources(institution_name,website_url,charter_type,state,state_code,source,status)
      VALUES('Audience lesson fixture','https://audience.example/','bank','Texas','TX','e2e','active') RETURNING id`;
    const [{ id: runId }] = await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
      VALUES(${nextRunId--},'knox','state_agent','Audience lesson fixture','running') RETURNING id`;
    return { institutionId: Number(id), runId: Number(runId) };
  }
  async function document(tx: Db, b: { institutionId: number; runId: number }, path: string, text: string) {
    const url = `https://audience.example/${path}/${randomUUID()}.pdf`, hash = createHash("sha256").update(text).digest("hex");
    const [{ id: documentId }] = await tx`INSERT INTO source_documents(institution_id,status,document_url,content_hash,content_type)
      VALUES(${b.institutionId},'success',${url},${createHash("sha256").update(url).digest("hex")},'application/pdf') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts(agent_run_id,source_document_id,institution_id,source_url,
      document_type,content_type,status,normalized_text,text_hash,char_count)
      VALUES(${b.runId},${documentId},${b.institutionId},${url},'text_pdf','application/pdf','completed',${text},${hash},${text.length}) RETURNING id`;
    return { documentId: Number(documentId), row: { document_text_id: Number(textId), source_document_id: Number(documentId), institution_id: b.institutionId,
      source_url: url, normalized_text: text, text_hash: hash, institution_name: "Audience lesson fixture" } as Parameters<typeof extract.insertCandidate>[1]["row"] };
  }
  /** A live fee read from the document, then taken down with this reason and a confirmed second look from this check. */
  async function takenDown(tx: Db, b: { institutionId: number; runId: number }, doc: Awaited<ReturnType<typeof document>>, c: ExtractedFeeCandidate,
    reason: string | null, check = "hamilton.business_schedule") {
    expect(await extract.insertCandidate(tx, { runId: b.runId, row: doc.row, candidate: c })).toBe(true);
    const [{ fee_raw_id: rawId }] = await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE source_document_id=${doc.documentId} AND fee_name=${c.feeName}`;
    const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations(fee_raw_id,institution_id,source_url,
      canonical_fee_key,verified_by_agent_event_id,fee_name,amount,frequency,fee_audience,amount_kind)
      SELECT fee_raw_id,institution_id,source_url,${c.canonicalHint},agent_event_id,fee_name,amount,frequency,fee_audience,'flat'
      FROM raw_fee_observations WHERE fee_raw_id=${rawId} RETURNING fee_verified_id`;
    const [{ fee_published_id: publishedId }] = await tx`INSERT INTO published_fee_records(lineage_ref,institution_id,canonical_fee_key,
      fee_name,amount,frequency,fee_audience,amount_kind,published_by_adversarial_event_id,verified_by_agent_event_id,agent_event_id,batch_id,
      rolled_back_at,rolled_back_reason)
      SELECT fv.fee_verified_id,fv.institution_id,fv.canonical_fee_key,fv.fee_name,fv.amount,fv.frequency,fv.fee_audience,'flat',
      fv.verified_by_agent_event_id,fv.verified_by_agent_event_id,fr.agent_event_id,'initial',
      ${reason == null ? null : new Date()},${reason}
      FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
      WHERE fv.fee_verified_id=${verifiedId} RETURNING fee_published_id`;
    const [{ id }] = await tx`INSERT INTO pipeline_feedback(about_stage,signal,kind,reported_by,check_name,institution_id,fee_published_id,
      canonical_fee_key,weight,dedupe_key,evidence)
      VALUES('publish','wrong','takedown_confirmed','hamilton',${check},${b.institutionId},${publishedId},${c.canonicalHint},1,
        ${`${check}:pub:${publishedId}:test2062`},${tx.json({ confirm_reason: reason } as never)}) RETURNING id`;
    return Number(id);
  }

  it("learns only from confirmed business-schedule takedowns that are still down, scoped to their document", async () => {
    await rollback(async (tx) => {
      const b = await bank(tx);
      const mixed = await document(tx, b, "disclosures/fee-schedule", "Fee Schedule\nBusiness ATM/Debit Transactions, off premises | $2.00\nStop Payment | $30.00\n");
      const business = await document(tx, b, "business/fee-schedule", "Business Fee Schedule\nMonthly Service Charge | $20.00\nStop Payment | $35.00\n");
      const nameLesson = await takenDown(tx, b, mixed, candidate("Business ATM/Debit Transactions, off premises", 2, "atm_non_network"), "business_schedule: consumer fee #1");
      const docLesson = await takenDown(tx, b, business, candidate("Monthly Service Charge", 20, "monthly_maintenance"), "business_schedule: consumer fee #2");
      // Restored (live again), down for another reason, or another check's confirmation: none teaches.
      await takenDown(tx, b, mixed, candidate("Overdraft Fee", 35, "overdraft"), null);
      await takenDown(tx, b, mixed, candidate("Wire Transfer", 25, "wire_domestic_outgoing"), "duplicate of #5");
      await takenDown(tx, b, mixed, candidate("Paper Statement", 3, "paper_statement"), "business_schedule: consumer fee #3", "hamilton.limit_guard");

      const loaded = await lessons.loadAudienceLessons(tx, [mixed.documentId, business.documentId]);
      expect(loaded.readFailed).toBeUndefined();
      expect(loaded.loaded).toBe(2);
      expect([...loaded.names.values()].sort()).toEqual([nameLesson, docLesson].sort());
      expect([...loaded.documents.entries()]).toEqual([[business.documentId, docLesson]]);
      expect(lessons.audienceLessonFor(candidate("Business ATM/Debit Transactions, off premises", 2, "atm_non_network"), loaded, mixed.documentId))
        .toEqual({ scope: "name", feedbackId: nameLesson });
      // The same name at another price on the mixed schedule is not taught.
      expect(lessons.audienceLessonFor(candidate("Business ATM/Debit Transactions, off premises", 2.5, "atm_non_network"), loaded, mixed.documentId)).toBeNull();
      expect(lessons.audienceLessonFor(candidate("Stop Payment", 30, "stop_payment"), loaded, mixed.documentId)).toBeNull();
      expect(lessons.audienceLessonFor(candidate("Stop Payment", 35, "stop_payment"), loaded, business.documentId))
        .toEqual({ scope: "document", feedbackId: docLesson });
      // Another document of the same bank is not taught, and an unrelated document reads nothing.
      expect((await lessons.loadAudienceLessons(tx, [mixed.documentId])).documents.size).toBe(0);
      expect((await lessons.loadAudienceLessons(tx, [987654321])).loaded).toBe(0);
    });
  });

  it("writes a learned re-read as a business fee with its evidence and flag", async () => {
    await rollback(async (tx) => {
      const b = await bank(tx);
      const business = await document(tx, b, "commercial/fees", "Commercial Fees\nStop Payment | $35.00\n");
      const id = await takenDown(tx, b, business, candidate("Monthly Service Charge", 20, "monthly_maintenance"), "business_schedule: consumer fee #9");
      const copy = await document(tx, b, "commercial/fees-2026", "Commercial Fees\nStop Payment | $35.00\nMonthly Service Charge | $20.00\n");
      // The newer copy is its own document, so only a lesson read from it teaches it: the lesson is the document's.
      expect(lessons.audienceLessonFor(candidate("Stop Payment", 35, "stop_payment"), await lessons.loadAudienceLessons(tx, [copy.documentId]), copy.documentId)).toBeNull();
      const loaded = await lessons.loadAudienceLessons(tx, [business.documentId]);
      const read = candidate("Stop Payment", 35, "stop_payment");
      const match = lessons.audienceLessonFor(read, loaded, business.documentId)!;
      expect(match).toEqual({ scope: "document", feedbackId: id });
      expect(await extract.insertCandidate(tx, { runId: b.runId, row: business.row, candidate: lessons.withAudienceLesson(read, match),
        extraFlags: [lessons.audienceLessonFlag(match.scope)] })).toBe(true);
      const [raw] = await tx`SELECT fee_audience,audience_evidence,outlier_flags FROM raw_fee_observations
        WHERE source_document_id=${business.documentId} AND fee_name='Stop Payment'`;
      expect(raw.fee_audience).toBe("business");
      expect(raw.audience_evidence).toBe(`knox_lesson:hamilton.business_schedule:document (confirmed takedown feedback #${id})`);
      expect(raw.outlier_flags).toEqual(expect.arrayContaining(["needs_darwin_verification", "knox_lesson:business_audience:document"]));
    });
  });
});
