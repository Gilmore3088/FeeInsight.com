// @vitest-environment node
/** #2040 review of #2753: an NSF $0 from a sentence is held when the bank charges any NSF-family fee. Loopback rollback only. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NSF_FAMILY_KEYS } from "@/lib/no-charge-statement";

vi.mock("@/lib/agents/fee-source-fetch", async original => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("No-charge conflict SQL fixtures forbid network/provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
const SENTENCE = "We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.";
const NAME = "Returned item/non-sufficient funds (NSF) fee";
const TEXT = `Overdraft FAQs\n\n${SENTENCE}\n`;

describe.skipIf(!connection)("Knox v133 no-charge conflict hold in actual PostgreSQL (#2040)", () => {
  let db: postgres.Sql, appSql: Db;
  let extract: typeof import("./extract");
  let nextRunId = -204_000_000 - process.pid * 10;
  let event = 0;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("No-charge conflict SQL tests require disposable loopback PostgreSQL; production forbidden");
    vi.stubEnv("DATABASE_URL", connection);
    const m = await import("@/lib/data-store/connection");
    appSql = m.sql;
    db = postgres(connection, { max: 1, ssl: "require", types: {
      numeric: m.NUMERIC_AS_NUMBER, json: m.JSON_TEXT_PASSTHROUGH, text: m.TEXT_WITHOUT_NUL,
    } }) as unknown as postgres.Sql;
    extract = await import("./extract");
  }, 30_000);
  afterAll(async () => { if (db) await db.end(); if (appSql) await appSql.end(); vi.unstubAllEnvs(); });

  async function rolledBack(work: (tx: Db) => Promise<void>) {
    const rollback = new Error("rollback own no-charge conflict fixture");
    await db.begin(async scope => { await work(scope as unknown as Db); throw rollback; })
      .catch(error => { if (error !== rollback) throw error; });
  }
  const uuid = () => {
    const hex = createHash("sha256").update(`no-charge-conflict:${process.pid}:${event++}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  async function seed(tx: Db) {
    const sourceUrl = "https://bank.example/overdraft-faq";
    const hash = createHash("sha256").update(TEXT).digest("hex");
    const [{ id: institutionId }] = await tx`INSERT INTO institution_sources
      (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
      VALUES ('Synthetic no-charge bank','https://bank.example/',${sourceUrl},'bank','Ohio','OH',500000,'e2e','active') RETURNING id`;
    const [{ id: runId }] = await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
      VALUES (${nextRunId--},'knox','state_agent','No-charge conflict SQL fixture','running') RETURNING id`;
    const [{ id: documentId }] = await tx`INSERT INTO source_documents (institution_id,status,document_url,content_hash,content_type)
      VALUES (${institutionId},'success',${sourceUrl},${hash},'text/plain') RETURNING id`;
    const [{ id: otherDocumentId }] = await tx`INSERT INTO source_documents (institution_id,status,document_url,content_hash,content_type)
      VALUES (${institutionId},'success','https://bank.example/fee-schedule.pdf','other','application/pdf') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,status,normalized_text,text_hash,char_count)
      VALUES (${runId},${documentId},${institutionId},${sourceUrl},'completed',${TEXT},${hash},${TEXT.length}) RETURNING id`;
    return { institutionId: Number(institutionId), runId: Number(runId), documentId: Number(documentId),
      otherDocumentId: Number(otherDocumentId), textId: Number(textId), hash, sourceUrl };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;
  async function chargedRaw(tx: Db, f: Fixture, key: string, amount: number, documentId = f.otherDocumentId, extra: string[] = []) {
    const [{ fee_raw_id: id }] = await tx`INSERT INTO raw_fee_observations (institution_id,source_document_id,agent_event_id,fee_name,amount,outlier_flags,source)
      VALUES (${f.institutionId},${documentId},${uuid()}::uuid,${`NSF Fee ${event}`},${amount},${JSON.stringify([`canonical_hint:${key}`, ...extra])}::jsonb,'knox') RETURNING fee_raw_id`;
    return Number(id);
  }
  async function verified(tx: Db, f: Fixture, rawId: number, key: string, amount: number, status: string) {
    await tx`INSERT INTO verified_fee_observations (fee_raw_id,institution_id,canonical_fee_key,verified_by_agent_event_id,fee_name,amount,review_status)
      VALUES (${rawId},${f.institutionId},${key},${uuid()}::uuid,'NSF Fee',${amount},${status})`;
  }
  const charges = (tx: Db, f: Fixture) => extract.institutionChargesCategory(tx, f.institutionId, NSF_FAMILY_KEYS);
  const held = { shape: "zero" as const, feeName: NAME, amount: 0, amountMax: null, percent: null, frequency: null,
    canonicalHint: "nsf", excerpt: SENTENCE, statedNoCharge: true as const };
  const rowOf = (f: Fixture) => ({ document_text_id: f.textId, source_document_id: f.documentId, institution_id: f.institutionId,
    source_url: f.sourceUrl, text_hash: f.hash, normalized_text: TEXT });
  async function storedZero(tx: Db, f: Fixture) {
    const [row] = await tx<Array<{ fee_name: string; outlier_flags: string[] }>>`SELECT fee_name, outlier_flags FROM raw_fee_observations
      WHERE institution_id=${f.institutionId} AND source_document_id=${f.documentId} AND amount=0`;
    return row;
  }

  it("a bank charging nothing in the NSF family: the $0 goes to Darwin under the sentence's own name", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      expect(await charges(tx, f)).toBe(false);
      expect(await extract.insertHeldCandidate(tx, { runId: f.runId, row: rowOf(f), held })).toBe(true);
      const row = await storedZero(tx, f);
      expect(row.fee_name).toBe(NAME);
      expect(row.outlier_flags).toContain("needs_darwin_verification");
      expect(row.outlier_flags).not.toContain(extract.NO_CHARGE_CONFLICT_FLAG);
    });
  });

  it("holds for review when another document's raw read charges any NSF-family key (nsf_daily_cap)", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      await chargedRaw(tx, f, "nsf_daily_cap", 105);
      expect(await charges(tx, f)).toBe(true);
      expect(await extract.insertHeldCandidate(tx, { runId: f.runId, row: rowOf(f), held })).toBe(true);
      const row = await storedZero(tx, f);
      expect(row.outlier_flags).toContain(extract.NO_CHARGE_CONFLICT_FLAG);
      expect(row.outlier_flags).not.toContain("needs_darwin_verification");
    });
  });

  it("holds when a verified read is challenged, but not when the raw or verified read was rejected, retired or on an older copy", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const rejected = await chargedRaw(tx, f, "nsf", 35);
      await verified(tx, f, rejected, "nsf", 35, "rejected");
      await chargedRaw(tx, f, "nsf", 35, f.otherDocumentId, ["superseded_by_newer_copy"]);
      const [{ id: newer }] = await tx`INSERT INTO source_documents (institution_id,status,document_url,content_hash,content_type)
        VALUES (${f.institutionId},'success','https://bank.example/fees-2027.pdf','newer','application/pdf') RETURNING id`;
      await tx`UPDATE source_documents SET superseded_by_id=${newer} WHERE id=${f.otherDocumentId}`;
      await chargedRaw(tx, f, "nsf", 35);
      expect(await charges(tx, f)).toBe(false);
      await tx`UPDATE source_documents SET superseded_by_id=NULL WHERE id=${f.otherDocumentId}`;
      expect(await charges(tx, f)).toBe(true);
    });
    await rolledBack(async tx => {
      const f = await seed(tx);
      const raw = await chargedRaw(tx, f, "nsf", 35, f.otherDocumentId, ["superseded_by_reread"]);
      expect(await charges(tx, f)).toBe(false);
      await verified(tx, f, raw, "nsf", 35, "challenged");
      expect(await charges(tx, f)).toBe(true);
    });
  });

  it("holds when the same run read a charged NSF fee on another document", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      expect(await extract.insertHeldCandidate(tx, { runId: f.runId, row: rowOf(f), held, chargedInRun: true })).toBe(true);
      expect((await storedZero(tx, f)).outlier_flags).toContain(extract.NO_CHARGE_CONFLICT_FLAG);
    });
  });

  it("holds when the bank publishes an NSF-family fee as a rate", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const raw = await chargedRaw(tx, f, "nsf", 0);
      const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations
        (fee_raw_id,institution_id,canonical_fee_key,verified_by_agent_event_id,fee_name,amount,review_status)
        VALUES (${raw},${f.institutionId},'nsf',${uuid()}::uuid,'NSF Fee',NULL,'rejected') RETURNING fee_verified_id`;
      await tx`INSERT INTO published_fee_records (lineage_ref,institution_id,canonical_fee_key,published_by_adversarial_event_id,fee_name,amount,amount_kind,rate_percent)
        VALUES (${verifiedId},${f.institutionId},'nsf',${uuid()}::uuid,'NSF Fee',NULL,'percent',1.5)`;
      expect(await charges(tx, f)).toBe(true);
    });
  });
});
