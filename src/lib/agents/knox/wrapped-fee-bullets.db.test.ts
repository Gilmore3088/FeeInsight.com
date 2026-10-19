// @vitest-environment node
/** Full deterministic raw→Darwin→Hamilton stages in disposable loopback SQL; every fixture rolls back. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { officialFeeDisclosure, wrappedPair } from "./wrapped-bullet-fixtures";

vi.mock("@/lib/agents/fee-source-fetch", async (original) => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Wrapped-bullet SQL fixtures forbid network/provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
type Fixture = { institutionId: number; runId: number; documentId: number; textId: number; text: string };

describe.skipIf(!connection)("Wrapped bullet stages in real PostgreSQL (#2151)", () => {
  let db: postgres.Sql;
  let appSql: Db;
  let extract: typeof import("./extract");
  let darwin: typeof import("../darwin/verify");
  let publish: typeof import("../hamilton/publish");
  let excerptOf: typeof import("../hamilton/frequency-fill").excerptOf;
  let official: string;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Wrapped-bullet SQL tests require a disposable loopback database; production is forbidden");
    }
    vi.stubEnv("DATABASE_URL", connection);
    const module = await import("@/lib/data-store/connection");
    appSql = module.sql;
    db = postgres(connection, { max: 1, ssl: "require", types: {
      numeric: module.NUMERIC_AS_NUMBER, json: module.JSON_TEXT_PASSTHROUGH, text: module.TEXT_WITHOUT_NUL,
    } }) as unknown as postgres.Sql;
    extract = await import("./extract");
    darwin = await import("../darwin/verify");
    publish = await import("../hamilton/publish");
    ({ excerptOf } = await import("../hamilton/frequency-fill"));
    official = await officialFeeDisclosure();
  });
  afterAll(async () => { if (db) await db.end(); if (appSql) await appSql.end(); vi.unstubAllEnvs(); });

  async function rolledBack(test: (tx: Db) => Promise<void>) {
    const rollback = new Error("roll back owned SQL fixture");
    await db.begin(async (scope) => { await test(scope as unknown as Db); throw rollback; })
      .catch((error) => { if (error !== rollback) throw error; });
  }
  async function seed(tx: Db, text: string): Promise<Fixture> {
    const [{ id: institutionId }] = await tx`INSERT INTO institution_sources
      (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
      VALUES ('SchoolsFirst Federal Credit Union','https://www.schoolsfirstfcu.org/',
      'https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf',
      'credit_union','California','CA',35000000,'e2e','active') RETURNING id`;
    const [{ id: runId }] = await tx`INSERT INTO agent_runs (agent_name,run_kind,title,status)
      VALUES ('knox','state_agent','Wrapped fee bullets SQL fixture','running') RETURNING id`;
    return addDocument(tx, { institutionId: Number(institutionId), runId: Number(runId) }, text);
  }
  async function addDocument(tx: Db, base: Pick<Fixture, "institutionId" | "runId">, text: string): Promise<Fixture> {
    const hash = createHash("sha256").update(text).digest("hex");
    const [{ id: documentId }] = await tx`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type)
      VALUES (${base.institutionId},'success','https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf',${hash},'application/pdf') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,document_type,content_type,status,normalized_text,text_hash,char_count)
      VALUES (${base.runId},${documentId},${base.institutionId},
      'https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf','text_pdf','application/pdf','completed',${text},${hash},${text.length}) RETURNING id`;
    return { ...base, documentId: Number(documentId), textId: Number(textId), text };
  }
  async function stages(tx: Db, fixture: Fixture) {
    await extract.runKnoxExtract({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId, limit: 10 });
    const verified = await darwin.runDarwinVerify({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId, limit: 100 });
    const published = await publish.runHamiltonPublish({ db: tx, runId: fixture.runId, institutionId: fixture.institutionId,
      limit: 100, minInstitutionFees: 1 });
    return { verified, published };
  }
  const live = (tx: Db, f: Fixture) => tx`SELECT fp.fee_published_id,fp.lineage_ref,fp.canonical_fee_key,fp.amount,fp.frequency,
      fp.quarantined_at,fr.fee_raw_id,fr.source_document_id,fr.line_share,COALESCE(fr.extraction_note,fr.conditions) AS note
      FROM published_fee_records fp JOIN verified_fee_observations fv ON fv.fee_verified_id=fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
      WHERE fp.institution_id=${f.institutionId} AND fp.canonical_fee_key IN ('nsf','overdraft')
        AND fp.rolled_back_at IS NULL ORDER BY fp.canonical_fee_key`;

  it("carries the actual official PDF's complete conditions through every stage and repeats idempotently", async () => {
    await rolledBack(async (tx) => {
      const f = await seed(tx, official);
      await stages(tx, f);
      const rows = await live(tx, f);
      expect(rows.map((r) => [r.canonical_fee_key, Number(r.amount)])).toEqual([["nsf", 22], ["overdraft", 22]]);
      for (const row of rows) {
        expect(Number(row.source_document_id)).toBe(f.documentId);
        expect(row.line_share).toBe("");
        // The disclosure names payment items but states no charging unit. Its daily cap
        // must not become the fee's frequency (Darwin preserves this as unknown).
        expect(row.frequency).toBeNull();
        expect(row.note).toContain(row.canonical_fee_key === "nsf" ? "and returned" : "and paid");
        expect(row.note).toContain("$22");
        expect(row.note).toContain("*No more than three NSF or Overdraft fees are charged per share, per day.");
        expect(excerptOf(row.note)).not.toContain("per day");
      }
      const catalog = await tx`SELECT canonical_fee_key,conditions,frequency FROM published_fee_catalog
        WHERE institution_id=${f.institutionId} AND canonical_fee_key IN ('nsf','overdraft') ORDER BY canonical_fee_key`;
      expect(catalog).toHaveLength(2);
      for (const row of catalog) {
        expect(row.conditions).toContain("*No more than three NSF or Overdraft fees are charged per share, per day.");
        expect(row.frequency).toBeNull();
      }
      await stages(tx, f);
      expect(await live(tx, f)).toEqual(rows);
    });
  }, 30_000);
  it.each([false, true])("keeps unequal prices in reverse order=%s and rejects the wrong neighbor price", async (reverse) => {
    await rolledBack(async (tx) => {
      const f = await seed(tx, wrappedPair({ returned: 25, paid: 22, reverse }));
      // A deliberately incorrect raw NSF22 cannot borrow the neighboring paid22 witness.
      await extract.insertCandidate(tx, { runId: f.runId, row: { document_text_id: f.textId, source_document_id: f.documentId,
        institution_id: f.institutionId, source_url: 'https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf',
        text_hash: createHash('sha256').update(f.text).digest('hex') } as Parameters<typeof extract.insertCandidate>[1]["row"],
        candidate: { feeName: "NSF", amount: 22, frequency: "per_item", canonicalHint: "nsf", confidence: .95,
          excerpt: "NSF $22", waivable: false } });
      const { verified } = await stages(tx, f);
      expect(verified.results).toContainEqual(expect.objectContaining({ feeName: "NSF", amount: 22, reasonCode: "not_in_source" }));
      expect((await live(tx, f)).map((r) => [r.canonical_fee_key, Number(r.amount)])).toEqual([["nsf", 25], ["overdraft", 22]]);
      expect(await tx`SELECT fv.fee_verified_id FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
        WHERE fv.institution_id=${f.institutionId} AND fv.canonical_fee_key='nsf' AND fv.amount=22`).toHaveLength(0);
    });
  }, 30_000);
  it("keeps an operator-held fee held when a new copy extracts and verifies it again", async () => {
    await rolledBack(async (tx) => {
      const f = await seed(tx, wrappedPair());
      await stages(tx, f);
      const [held] = await live(tx, f);
      expect(held.canonical_fee_key).toBe("nsf");
      await tx`UPDATE published_fee_records SET quarantined_at=NOW(),quarantine_reason='admin_hold: fixture'
        WHERE fee_published_id=${held.fee_published_id}`;
      const fresh = await addDocument(tx, f, f.text + "\nCurrent disclosure copy.");
      await tx`UPDATE source_documents SET superseded_by_id=${fresh.documentId} WHERE id=${f.documentId}`;
      const { published } = await stages(tx, fresh);
      expect(published.results).toContainEqual(expect.objectContaining({ feeName: "NSF", status: "skipped", reason: expect.stringContaining("Held by an operator") }));
      const heldRows = (await live(tx, f)).filter((r) => r.canonical_fee_key === "nsf");
      expect(heldRows).toHaveLength(1);
      expect(heldRows[0].fee_published_id).toBe(held.fee_published_id);
      expect(heldRows[0].quarantined_at).not.toBeNull();
    });
  }, 30_000);
});
