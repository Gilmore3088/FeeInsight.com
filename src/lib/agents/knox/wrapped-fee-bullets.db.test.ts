// @vitest-environment node
/** Full deterministic raw→Darwin→Hamilton stages in disposable loopback SQL; every fixture rolls back. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { officialFeeDisclosure, wrappedPair } from "./wrapped-bullet-fixtures";

vi.mock("@/lib/agents/fee-source-fetch", async (original) => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Wrapped-bullet SQL fixtures forbid network/provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
type Fixture = { institutionId: number; runId: number; documentId: number; textId: number; text: string; sourceUrl?: string };

describe.skipIf(!connection)("Wrapped bullet stages in real PostgreSQL (#2151)", () => {
  let db: postgres.Sql;
  let appSql: Db;
  let extract: typeof import("./extract");
  let darwin: typeof import("../darwin/verify");
  let publish: typeof import("../hamilton/publish");
  let excerptOf: typeof import("../hamilton/frequency-fill").excerptOf;
  let official: string;
  // Rollbacks do not rewind PostgreSQL sequences. Keep these fixtures out of
  // the public run sequence used by other CI suites (including their run #1).
  let nextRunId = -215_100_000 - process.pid * 10;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Wrapped-bullet SQL tests require a disposable loopback database; production is forbidden");
    }
    vi.stubEnv("DATABASE_URL", connection);
    const connectionModule = await import("@/lib/data-store/connection");
    appSql = connectionModule.sql;
    db = postgres(connection, { max: 1, ssl: "require", types: {
      numeric: connectionModule.NUMERIC_AS_NUMBER, json: connectionModule.JSON_TEXT_PASSTHROUGH, text: connectionModule.TEXT_WITHOUT_NUL,
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
  async function seed(tx: Db, text: string, identity: { name?: string; website?: string; url?: string } = {}): Promise<Fixture> {
    const [{ id: institutionId }] = await tx`INSERT INTO institution_sources
      (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
      VALUES (${identity.name ?? 'SchoolsFirst Federal Credit Union'},${identity.website ?? 'https://www.schoolsfirstfcu.org/'},
      ${identity.url ?? 'https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf'},
      'credit_union','California','CA',35000000,'e2e','active') RETURNING id`;
    const [{ id: runId }] = await tx`INSERT INTO agent_runs (id,agent_name,run_kind,title,status)
      VALUES (${nextRunId--},'knox','state_agent','Wrapped fee bullets SQL fixture','running') RETURNING id`;
    expect(Number(runId)).toBeLessThan(0);
    return addDocument(tx, { institutionId: Number(institutionId), runId: Number(runId), sourceUrl: identity.url }, text);
  }
  async function addDocument(tx: Db, base: Pick<Fixture, "institutionId" | "runId" | "sourceUrl">, text: string): Promise<Fixture> {
    const hash = createHash("sha256").update(text).digest("hex");
    const [{ id: documentId }] = await tx`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type)
      VALUES (${base.institutionId},'success',${base.sourceUrl ?? 'https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf'},${hash},'application/pdf') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,document_type,content_type,status,normalized_text,text_hash,char_count)
      VALUES (${base.runId},${documentId},${base.institutionId},
      ${base.sourceUrl ?? 'https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf'},'text_pdf','application/pdf','completed',${text},${hash},${text.length}) RETURNING id`;
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

  it("#2240/#2241/#2246 keeps physical prices, own item units and the annual-program hold across all ordinary stages", async () => {
    await rolledBack(async tx => {
      const text = readFileSync(new URL("./__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
      const f = await seed(tx, text, {
        name: "Oakwood Bank",
        website: "https://www.oakwoodbank.net/",
        url: "https://www.oakwoodbank.net/webfiles/fnitools/documents/cra_accounts_and_fees.pdf",
      });
      await stages(tx, f);
      const catalog = await tx`
        SELECT fee_name, fee_category, amount, frequency, conditions FROM published_fee_catalog
        WHERE institution_id=${f.institutionId} ORDER BY fee_category, fee_name, amount`;
      expect(catalog.filter(row => row.fee_name === "Check Images").map(row => Number(row.amount))).toEqual([10]);
      expect(catalog).toContainEqual(expect.objectContaining({ fee_name: "Copy of canceled check image", amount: 5 }));
      expect(catalog.some(row => row.fee_name === "Ready Reserve Overdraft Protection Fee")).toBe(false);
      expect(catalog.some(row => Number(row.amount) === 140)).toBe(false);
      const overdraft = catalog.find(row => row.fee_category === "overdraft" && Number(row.amount) === 35);
      expect(overdraft).toMatchObject({ fee_name: "Overdraft Fee", amount: 35, frequency: "per_item" });
      expect(overdraft?.conditions).toContain("$140.00 Maximum. $35.00 per item");
      expect(overdraft?.conditions).not.toContain("per day");
      const held = await tx`
        SELECT fee_raw_id, fee_name, amount, frequency, conditions, extraction_note, outlier_flags
        FROM raw_fee_observations WHERE institution_id=${f.institutionId}
          AND fee_name='Ready Reserve Overdraft Protection Fee'`;
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({ amount: 25, frequency: "annual" });
      expect(held[0].conditions).toContain("(annually)");
      expect(held[0].extraction_note).toContain("(annually)");
      expect(held[0].outlier_flags).toContain("knox_review:periodic_program");
      expect(held[0].outlier_flags).not.toContain("needs_darwin_verification");

      expect(await extract.insertCandidate(tx, {
        runId: f.runId,
        row: {
          document_text_id: f.textId, source_document_id: f.documentId,
          institution_id: f.institutionId, source_url: f.sourceUrl,
          text_hash: createHash("sha256").update(f.text).digest("hex"),
        } as Parameters<typeof extract.insertCandidate>[1]["row"],
        candidate: {
          feeName: "Ready Reserve Overdraft Protection Fee", amount: 25, frequency: "annual",
          canonicalHint: "overdraft", confidence: .95, excerpt: "Ready Reserve Overdraft Protection Fee | • $25.00 (annually)",
          waivable: false, ownedPolicy: true,
        },
      })).toBe(false);
      const promoters = await import("./held-recheck");
      const scoped = { runId: f.runId, institutionId: f.institutionId };
      await promoters.recheckPromotedRows(tx, scoped);
      await promoters.recheckHeldRows(tx, scoped);
      await promoters.fileHeldByName(tx, scoped);
      await promoters.recheckUntracedRows(tx, scoped);
      await promoters.recheckSupersededRows(tx, { ...scoped, source: "free" });
      await promoters.refileSupersededRows(tx, scoped);
      await promoters.recheckHeldRates(tx, scoped);
      await stages(tx, f);
      expect(await tx`
        SELECT fee_raw_id, fee_name, amount, frequency, conditions, extraction_note, outlier_flags
        FROM raw_fee_observations WHERE institution_id=${f.institutionId}
          AND fee_name='Ready Reserve Overdraft Protection Fee'`).toEqual(held);
      expect(await tx`
        SELECT fee_name, fee_category, amount, frequency, conditions FROM published_fee_catalog
        WHERE institution_id=${f.institutionId} ORDER BY fee_category, fee_name, amount`).toEqual(catalog);
      expect(await tx`SELECT fee_verified_id FROM verified_fee_observations
        WHERE institution_id=${f.institutionId} AND fee_name='Ready Reserve Overdraft Protection Fee'`).toHaveLength(0);
    });
  }, 30_000);

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
  it("#2209 keeps standard prices public and literal restricted twins held through raw, verify, catalog and replay", async () => {
    await rolledBack(async tx => {
      const policy = readFileSync(new URL("./__fixtures__/newvalley-nsf-policy.txt", import.meta.url), "utf8");
      const text = [
        "Stop Payment | $30.00",
        "Money Order | $3.00",
        "Official Bank Check | $5.00",
        "NOTE: NSF fees will not be charged to a Rise Checking account.",
        policy,
      ].join("\n");
      const f = await seed(tx, text, {
        name: "New Valley Bank & Trust",
        website: "https://banknewvalley.com/",
        url: "https://banknewvalley.com/personal/consumer-fees/",
      });
      await stages(tx, f);
      const rows = await live(tx, f);
      expect(rows.map(row => [row.canonical_fee_key, Number(row.amount)]).sort()).toEqual([
        ["nsf", 34],
        ["overdraft", 34],
      ].sort());
      expect(rows.filter(row => row.line_share === "twin:overdraft")).toHaveLength(1);

      const catalog = await tx`
        SELECT fee_category, amount, frequency, conditions, account_product_type, source_document_id
        FROM published_fee_catalog
        WHERE institution_id=${f.institutionId} AND fee_category IN ('nsf', 'overdraft')`;
      expect(catalog).toHaveLength(2);
      for (const row of catalog) {
        expect(Number(row.amount)).toBe(34);
        expect(row.frequency).toBe("per_item");
        expect(row.account_product_type).toBeNull();
        expect(Number(row.source_document_id)).toBe(f.documentId);
        expect(row.conditions).toContain("less than $10.00");
        expect(row.conditions).toContain("Rise Checking account");
        const [own, alternate] = row.conditions.split("Other stated price tier:");
        expect(own).toContain("($136)");
        expect(own).not.toContain("18/65 checking product");
        expect(alternate).toContain("18/65 checking product");
      }

      const held = await tx`
        SELECT fee_raw_id, amount, line_share, conditions, extraction_note, outlier_flags
        FROM raw_fee_observations
        WHERE institution_id=${f.institutionId} AND amount=5
          AND fee_name='NSF/Overdraft Fee'
        ORDER BY fee_raw_id`;
      expect(held).toHaveLength(2);
      expect(held.map(row => row.line_share).sort()).toEqual(["", "twin:overdraft"]);
      for (const row of held) {
        expect(JSON.stringify(row.outlier_flags)).toContain("knox_review:eligibility");
        expect(JSON.stringify(row.outlier_flags)).not.toContain("needs_darwin_verification");
        expect(row.conditions).toContain("18/65 checking product");
        expect(row.conditions).toContain("18 or younger or 65 and older");
        expect(row.conditions).toContain("($20)");
        expect(row.conditions).not.toContain("($136)");
        expect(row.conditions).toContain("Rise Checking account");
        expect(row.extraction_note).toContain("18/65 checking product");
        expect(row.extraction_note).toContain("($20)");
        expect(row.extraction_note).toContain("Rise Checking account");
      }

      const { nsfPolicyPrices } = await import("@/lib/custom-report/nsf-policy-prices");
      const restricted = nsfPolicyPrices(text).find(row => row.amount === 5)!;
      for (const row of held) {
        // A later ordinary candidate cannot take over an eligibility-held raw identity.
        const inserted = await extract.insertCandidate(tx, {
          runId: f.runId,
          row: {
            document_text_id: f.textId,
            source_document_id: f.documentId,
            institution_id: f.institutionId,
            source_url: f.sourceUrl,
            text_hash: createHash("sha256").update(f.text).digest("hex"),
          } as Parameters<typeof extract.insertCandidate>[1]["row"],
          candidate: {
            feeName: "NSF/Overdraft Fee",
            amount: 5,
            frequency: "per_item",
            canonicalHint: row.line_share ? "overdraft" : "nsf",
            confidence: .95,
            excerpt: restricted.sourceLine,
            waivable: false,
            ownedPolicy: true,
            linkedConditions: restricted.linkedConditions,
            lineShare: String(row.line_share),
          },
        });
        expect(inserted).toBe(false);
      }

      const { pickHeadlineFees, toDisplayFees } = await import("@/app/(public)/institution/[id]/profile-data");
      const { institutionValue } = await import("@/lib/data-store/fee-stats");
      const visible = await tx`SELECT * FROM published_fee_catalog WHERE institution_id=${f.institutionId}`;
      const fees = visible as unknown as Parameters<typeof pickHeadlineFees>[0];
      expect(pickHeadlineFees(fees)).toMatchObject({ nsf: 34, overdraft: 34 });
      expect(toDisplayFees(fees)
        .filter(row => row.feeCategory === "nsf" || row.feeCategory === "overdraft")
        .map(row => row.amount)).toEqual([34, 34]);
      for (const key of ["nsf", "overdraft"]) {
        const amounts = catalog.filter(row => row.fee_category === key).map(row => Number(row.amount));
        expect(institutionValue(key, amounts)).toBe(34);
      }

      await stages(tx, f);
      expect(await live(tx, f)).toEqual(rows);
      expect(await tx`
        SELECT fee_raw_id, amount, line_share, conditions, extraction_note, outlier_flags
        FROM raw_fee_observations
        WHERE institution_id=${f.institutionId} AND amount=5
          AND fee_name='NSF/Overdraft Fee'
        ORDER BY fee_raw_id`).toEqual(held);
      expect(await tx`
        SELECT fee_verified_id FROM verified_fee_observations
        WHERE institution_id=${f.institutionId} AND amount=5
          AND canonical_fee_key IN ('nsf', 'overdraft')`).toHaveLength(0);
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
