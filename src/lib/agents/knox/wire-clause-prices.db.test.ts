// @vitest-environment node
/** Actual own-source stages and normal two-look handling; every local fixture rolls back. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/fee-source-fetch", async original => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Wire SQL fixtures forbid network/provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
const official = JSON.parse(readFileSync(new URL("./__fixtures__/family-wire-inline-directions.json", import.meta.url), "utf8"));
type Db = typeof import("@/lib/data-store/connection").sql;
type Fixture = { institutionId: number; runId: number; documentId: number; textId: number; text: string; hash: string };

describe.skipIf(!connection)("Wire clause actual PostgreSQL stages (#2021)", () => {
  let db: postgres.Sql;
  let appSql: Db;
  let extract: typeof import("./extract");
  let darwin: typeof import("../darwin/verify");
  let hamilton: typeof import("../hamilton/publish");
  let nextRunId = -202_100_000 - process.pid * 10;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Wire SQL tests require disposable loopback PostgreSQL; production forbidden");
    }
    vi.stubEnv("DATABASE_URL", connection);
    const connectionModule = await import("@/lib/data-store/connection");
    appSql = connectionModule.sql;
    db = postgres(connection, { max: 1, ssl: "require", types: {
      numeric: connectionModule.NUMERIC_AS_NUMBER, json: connectionModule.JSON_TEXT_PASSTHROUGH, text: connectionModule.TEXT_WITHOUT_NUL,
    } }) as unknown as postgres.Sql;
    extract = await import("./extract");
    darwin = await import("../darwin/verify");
    hamilton = await import("../hamilton/publish");
  });
  afterAll(async () => {
    if (db) await db.end();
    if (appSql) await appSql.end();
    vi.unstubAllEnvs();
  });

  async function rolledBack(test: (tx: Db) => Promise<void>) {
    const rollback = new Error("roll back owned wire fixture");
    await db.begin(async scope => {
      await test(scope as unknown as Db);
      throw rollback;
    }).catch(error => { if (error !== rollback) throw error; });
  }
  async function run(tx: Db) {
    const id = nextRunId--;
    await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
      VALUES(${id},'knox','state_agent','Wire ownership fixture','running')`;
    return id;
  }
  async function seed(tx: Db, source = official): Promise<Fixture> {
    const text = source.normalizedText;
    const hash = createHash("sha256").update(text).digest("hex");
    const [{ id: institutionId }] = await tx`INSERT INTO institution_sources
      (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
      VALUES(${source.institution},${new URL(source.sourceURL).origin},${source.sourceURL},
      'credit_union','Alabama','AL',1000000,'e2e','active') RETURNING id`;
    const runId = await run(tx);
    const [{ id: documentId }] = await tx`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type)
      VALUES(${institutionId},'success',${source.sourceURL},${source.sourceBytesSHA256},'text/html') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,document_type,content_type,status,source_hash,normalized_text,text_hash,char_count)
      VALUES(${runId},${documentId},${institutionId},${source.sourceURL},'html','text/html','completed',
        ${source.sourceBytesSHA256},${text},${hash},${text.length}) RETURNING id`;
    return { institutionId: Number(institutionId), runId, documentId: Number(documentId), textId: Number(textId), text, hash };
  }
  async function stages(tx: Db, f: Fixture) {
    await extract.runKnoxExtract({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 10 });
    await darwin.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100 });
    await hamilton.runHamiltonPublish({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100, minInstitutionFees: 1 });
  }
  const live = (tx: Db, f: Fixture) => tx`SELECT fee_name,fee_category,amount,frequency,conditions
    FROM published_fee_catalog WHERE institution_id=${f.institutionId} AND fee_category LIKE 'wire_%'
    ORDER BY fee_category,amount,fee_name`;

  it("publishes own incoming10/outgoing20 while keeping newly extracted generic international35 held on repeat", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      expect(f.hash).toBe(official.textSHA256);
      await stages(tx, f);
      const before = await live(tx, f);
      expect(before.filter(r => r.fee_category === "wire_domestic_incoming").map(r => r.amount)).toEqual([10]);
      expect(before.filter(r => r.fee_category === "wire_domestic_outgoing").map(r => r.amount)).toEqual([20]);
      // #2278 changes prospective admission only. The historical seeded35/two-look
      // control below still proves existing verified/published history stays unchanged.
      expect(before.filter(r => r.fee_category === "wire_intl_outgoing")).toEqual([]);
      expect(before.some(r => r.amount === 45)).toBe(false);
      const [held35] = await tx`SELECT fee_raw_id,to_jsonb(r)::text AS raw_bytes,
        outlier_flags ? 'knox_eligibility:international_wire' AS private_hold,
        outlier_flags ? 'needs_darwin_verification' AS needs_verification
        FROM raw_fee_observations r WHERE institution_id=${f.institutionId}
          AND source_document_id=${f.documentId} AND fee_name='International Wire Transfer Fee' AND amount=35`;
      expect(held35?.private_hold).toBe(true);
      expect(held35?.needs_verification).toBe(false);
      expect(await tx`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_raw_id=${held35.fee_raw_id}`).toEqual([]);
      const incoming = before.find(r => r.fee_category === "wire_domestic_incoming");
      expect(incoming?.conditions).toContain("$10.00 on Incoming Wires");
      expect(incoming?.conditions).not.toContain("$20");
      const outgoing = before.find(r => r.fee_category === "wire_domestic_outgoing");
      expect(outgoing?.conditions).toContain("$20 on Outgoing Outgoing Domestic");
      expect(outgoing?.conditions).not.toContain("$10");
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
      expect(await live(tx, f)).toEqual(before);
      const [heldAfter] = await tx`SELECT to_jsonb(r)::text AS raw_bytes FROM raw_fee_observations r WHERE fee_raw_id=${held35.fee_raw_id}`;
      expect(heldAfter.raw_bytes).toBe(held35.raw_bytes);
    });
  }, 60_000);

  it("requires real first/immediate/aged13h looks to remove only a preexisting borrowed incoming20", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const ids: Record<string, number> = {};
      for (const [key, name, amount, category] of [
        ["wrong", "Incoming Wires", 20, "wire_domestic_incoming"],
        ["incoming", "Incoming Wires", 10, "wire_domestic_incoming"],
        ["outgoing", "Wire Transfer Fee: Outgoing Domestic", 20, "wire_domestic_outgoing"],
        ["international", "International Wire Transfer Fee", 35, "wire_intl_outgoing"],
      ] as const) {
        const note = `canonical_hint=${category}; text_hash=${f.hash}; excerpt="${name} | $${amount}"`;
        const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
          (institution_id,source_document_id,source_url,extraction_confidence,agent_event_id,fee_name,amount,frequency,extraction_note,outlier_flags,source)
          VALUES(${f.institutionId},${f.documentId},${official.sourceURL},.95,gen_random_uuid(),
            ${name},${amount},'per_item',${note},'[]'::jsonb,'knox') RETURNING fee_raw_id`;
        const [{ fee_verified_id: verifiedId }] = await tx`INSERT INTO verified_fee_observations
          (fee_raw_id,institution_id,source_url,extraction_confidence,canonical_fee_key,verified_by_agent_event_id,fee_name,amount,frequency,review_status)
          VALUES(${rawId},${f.institutionId},${official.sourceURL},.95,${category},
            gen_random_uuid(),${name},${amount},'per_item','approved') RETURNING fee_verified_id`;
        const [{ fee_published_id: publishedId }] = await tx`INSERT INTO published_fee_records
          (lineage_ref,institution_id,canonical_fee_key,source_url,extraction_confidence,published_by_adversarial_event_id,fee_name,amount,frequency,batch_id)
          VALUES(${verifiedId},${f.institutionId},${category},${official.sourceURL},.95,
            gen_random_uuid(),${name},${amount},'per_item','agentic-run-wire-fixture') RETURNING fee_published_id`;
        ids[key] = Number(publishedId);
      }
      const { knoxFreeSignature, rollBackUnreproducedFees, RULES_RECHECK_STRATEGY } = await import("../hamilton/rules-recheck");
      const oldSignature = knoxFreeSignature().replace(/extract\.rules@(\d+)/, (_, version) => "extract.rules@" + (Number(version) - 1));
      expect(oldSignature).not.toBe(knoxFreeSignature());
      // An existing passed attempt at the preceding rules signature cannot suppress
      // this bounded refusal. General source-check decisions are not reopened.
      await tx`INSERT INTO pipeline_attempts
        (institution_id,source_document_id,stage,strategy,strategy_version,input_fingerprint,outcome,yield_count)
        VALUES(${f.institutionId},${f.documentId},'publish',${RULES_RECHECK_STRATEGY.strategy},
          ${RULES_RECHECK_STRATEGY.version},${oldSignature},'ok',0)`;
      const options = { institutionId: f.institutionId, dryRun: false, takedownLive: true };
      const first = await rollBackUnreproducedFees(tx, { ...options, runId: f.runId, batchId: "wire-first" });
      expect(first.flagged).toBe(1);
      expect(first.rollbacks).toEqual([]);
      const immediate = await rollBackUnreproducedFees(tx, { ...options, runId: await run(tx), batchId: "wire-too-soon" });
      expect(immediate.rollbacks).toEqual([]);
      const pending = await tx`SELECT fee_published_id,evidence FROM pipeline_feedback
        WHERE check_name='hamilton.rules_recheck' AND kind='takedown_pending' AND fee_published_id=${ids.wrong}`;
      expect(pending).toHaveLength(1);
      await tx`UPDATE pipeline_feedback
        SET evidence=jsonb_set(evidence,'{flagged_at}',to_jsonb((NOW()-INTERVAL '13 hours')::text))
        WHERE check_name='hamilton.rules_recheck' AND kind='takedown_pending' AND fee_published_id=${ids.wrong}`;
      const confirmed = await rollBackUnreproducedFees(tx, { ...options, runId: await run(tx), batchId: "wire-confirmed" });
      expect(confirmed.rollbacks).toEqual([
        expect.objectContaining({ feePublishedId: ids.wrong, secondLook: "source_trace:amount_not_the_fee" }),
      ]);
      const rows = await tx`SELECT fp.fee_published_id,fp.rolled_back_at,fv.review_status
        FROM published_fee_records fp JOIN verified_fee_observations fv ON fv.fee_verified_id=fp.lineage_ref
        WHERE fp.institution_id=${f.institutionId} ORDER BY fp.fee_published_id`;
      expect(rows.find(r => Number(r.fee_published_id) === ids.wrong)?.rolled_back_at).not.toBeNull();
      expect(rows.find(r => Number(r.fee_published_id) === ids.wrong)?.review_status).toBe("rejected");
      expect(rows.filter(r => Number(r.fee_published_id) !== ids.wrong)
        .every(r => r.rolled_back_at == null && r.review_status === "approved")).toBe(true);
    });
  }, 60_000);

  it("publishes both own directions from the complete current hash-bound New Heights source", async () => {
    await rolledBack(async tx => {
      const source = JSON.parse(readFileSync(new URL("./__fixtures__/new-heights-wire-inline-directions.json", import.meta.url), "utf8"));
      const f = await seed(tx, source);
      expect(f.hash).toBe(source.textSHA256);
      await stages(tx, f);
      const rows = await live(tx, f);
      expect(rows.filter(row => row.fee_category === "wire_domestic_incoming").map(row => row.amount)).toEqual([5]);
      expect(rows.filter(row => row.fee_category === "wire_domestic_outgoing").map(row => row.amount)).toEqual([15]);
      expect(rows.find(row => row.fee_category === "wire_domestic_incoming")?.conditions).toContain("$5 Per Transaction Incoming");
      expect(rows.find(row => row.fee_category === "wire_domestic_outgoing")?.conditions).toContain("$15.00 Per Transaction Outgoing");
    });
  }, 60_000);

  it("does not newly admit an unknown-audience own-price pair from a business or commercial heading", async () => {
    for (const heading of ["Business Wire Fees", "Commercial Wire Services"]) {
      await rolledBack(async tx => {
        const source = { ...official, normalizedText: heading + "\nWire Transfer Fee | $5 on Incoming Wires / $10 on Outgoing Domestic" };
        const f = await seed(tx, source);
        await stages(tx, f);
        const rows = await tx`SELECT fp.amount,fp.fee_audience,fp.canonical_fee_key FROM published_fee_records fp
          WHERE fp.institution_id=${f.institutionId} AND fp.rolled_back_at IS NULL`;
        // The unchanged legacy path can still misread this synthetic section.
        // This change must not add its newly recovered own prices as unscoped fees.
        expect(rows.filter(row => row.fee_audience !== "business" && (
          (row.canonical_fee_key === "wire_domestic_incoming" && row.amount === 5) ||
          (row.canonical_fee_key === "wire_domestic_outgoing" && row.amount === 10)
        ))).toEqual([]);
      });
    }
  }, 60_000);

  it("keeps the accepted paid-row path behind the same own-direction publication check without a provider call", async () => {
    await rolledBack(async tx => {
      const f = await seed(tx);
      const { groundPaidRow } = await import("./paid-extract");
      const sourceLine = f.text.split("\n").find(line => line.includes("$10.00 on Incoming Wires"))!;
      const grounded = groundPaidRow({
        fee_name: "Incoming Wires", canonical_key: "wire_domestic_incoming", amount: 10, source_line: sourceLine,
      }, f.text);
      expect(grounded).toMatchObject({ feeName: "Incoming Wires", amount: 10, canonicalKey: "wire_domestic_incoming" });
      expect(groundPaidRow({
        fee_name: "Incoming Wires", canonical_key: "wire_domestic_incoming", amount: 20, source_line: sourceLine,
      }, f.text)).toBe("not_in_text");
      const row = { document_text_id: f.textId, source_document_id: f.documentId, institution_id: f.institutionId,
        source_url: official.sourceURL, normalized_text: f.text, text_hash: f.hash } as Parameters<typeof extract.insertCandidate>[1]["row"];
      expect(typeof grounded).toBe("object");
      if (typeof grounded === "string") throw new Error("Own incoming price should be accepted");
      expect(await extract.insertCandidate(tx, { runId: f.runId, row, candidate: {
        feeName: grounded.feeName, amount: grounded.amount, canonicalHint: grounded.canonicalKey,
        frequency: grounded.frequency, confidence: .95, excerpt: grounded.sourceLine, waivable: false,
      } })).toBe(true);
      await extract.insertCandidate(tx, { runId: f.runId, row, candidate: {
        feeName: "Incoming Wires", amount: 20, canonicalHint: "wire_domestic_incoming",
        frequency: "per_item", confidence: .95, excerpt: sourceLine, waivable: false,
      } });
      const verified = await darwin.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100 });
      const published = await hamilton.runHamiltonPublish({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100, minInstitutionFees: 1 });
      expect(verified.verifiedFees).toBe(1);
      expect(verified.reasonCounts).toMatchObject({ not_in_source: 1 });
      expect(published.publishedFees).toBe(1);
      const records = await tx`SELECT amount FROM published_fee_records
        WHERE institution_id=${f.institutionId} AND rolled_back_at IS NULL`;
      expect(records.map(row => row.amount)).toEqual([10]);
      // The public catalog requires three distinct categories. Finish the same source
      // through ordinary free extraction before testing its public projection.
      await stages(tx, f);
      expect((await live(tx, f)).filter(row => row.fee_category === "wire_domestic_incoming")
        .map(row => row.amount)).toEqual([10]);
    });
  }, 60_000);
});
