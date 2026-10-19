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
type Fixture = { institutionId: number; runId: number; documentId: number; textId: number; text: string; sourceUrl: string };

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
    return addDocument(tx, {
      institutionId: Number(institutionId), runId: Number(runId),
      sourceUrl: identity.url ?? "https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf",
    }, text);
  }
  async function addDocument(tx: Db, base: Pick<Fixture, "institutionId" | "runId" | "sourceUrl">, text: string): Promise<Fixture> {
    const hash = createHash("sha256").update(text).digest("hex");
    const [{ id: documentId }] = await tx`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type)
      VALUES (${base.institutionId},'success',${base.sourceUrl ?? 'https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf'},${hash},'application/pdf') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,document_type,content_type,status,normalized_text,text_hash,char_count,source_hash)
      VALUES (${base.runId},${documentId},${base.institutionId},
      ${base.sourceUrl ?? 'https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf'},'text_pdf','application/pdf','completed',${text},${hash},${text.length},${hash}) RETURNING id`;
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

  it("#2248 carries every repaired source unit through fresh raw, verify, public catalog, promoters and frequency fills", async () => {
    await rolledBack(async tx => {
      const text = readFileSync(new URL("./__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
      const f = await seed(tx, text, { name: "Oakwood Bank", website: "https://www.oakwoodbank.net/",
        url: "https://www.oakwoodbank.net/webfiles/fnitools/documents/cra_accounts_and_fees.pdf" });
      await stages(tx, f);
      const expected = new Map([
        ["Account Reconciliation", [35, "hourly"]], ["Research Fee", [50, "hourly"]],
        ["Fax Machine", [1, "per_page"]], ["Photocopies", [1, "per_page"]],
        ["Check Images", [10, "per_statement"]], ["Copy of canceled check image", [5, "per_image"]],
        ["Paper Statement Fee", [5, "per_statement"]],
      ]);
      const catalog = await tx`SELECT * FROM published_fee_catalog WHERE institution_id=${f.institutionId} ORDER BY id`;
      const { marketEligibilityOf } = await import("@/app/(public)/institution/[id]/profile-data");
      const { countsInMarketComparison } = await import("@/lib/market-eligibility");
      const { readerFeeConditions } = await import("@/lib/fee-conditions");
      const unitRows = catalog.filter(row => expected.has(String(row.fee_name)));
      expect(unitRows).toHaveLength(7);
      expect(unitRows.find(row => row.fee_name === "Check Images"))
        .toMatchObject({ amount: 10, frequency: "per_statement", fee_audience: "consumer" });
      const keyRow = catalog.find(row => row.fee_name === "Replace Safe Deposit Box Key");
      expect(keyRow).toMatchObject({ amount: 50, frequency: "per_item", fee_category: "safe_deposit_box" });
      expect(readerFeeConditions(keyRow?.conditions)).toContain("$50.00 per key (Plus Locksmith Fee if unable to locate both keys)");
      for (const row of unitRows) {
        const [amount, frequency] = expected.get(String(row.fee_name))!;
        expect(row).toMatchObject({ amount, frequency });
        expect(readerFeeConditions(row.conditions)).toContain(`$${amount}`);
        expect(countsInMarketComparison(marketEligibilityOf(row as never))).toBe(false);
        const [raw] = await tx`SELECT frequency, conditions FROM raw_fee_observations WHERE fee_raw_id=${row.fee_raw_id}`;
        expect(raw).toMatchObject({ frequency, conditions: row.conditions });
      }
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
      const { fillBlankFrequencies } = await import("../hamilton/frequency-fill");
      await fillBlankFrequencies(tx, { ...scoped, dryRun: false });
      await fillBlankFrequencies(tx, { ...scoped, dryRun: false });
      const protectedRows = [...unitRows, keyRow!].sort((a, b) => Number(a.id) - Number(b.id));
      expect(await tx`SELECT * FROM published_fee_catalog WHERE id=ANY(${protectedRows.map(row => Number(row.id))}::bigint[]) ORDER BY id`).toEqual(protectedRows);
    });
  }, 30_000);

  it("#2283 does not rewrite historical raw conditions or release held rows using new additive context", async () => {
    await rolledBack(async tx => {
      const text = "Replace Safe Deposit Box Key | $50.00 per key (Plus Locksmith Fee if unable to locate both keys)";
      const f = await seed(tx, text);
      const { withOwnFeeUnit } = await import("@/lib/custom-report/own-fee-unit");
      const candidate = withOwnFeeUnit({ feeName: "Replace Safe Deposit Box Key", amount: 50, canonicalHint: "safe_deposit_box",
        frequency: "per_item", confidence: .95, excerpt: "Replace Safe Deposit Box Key | $50.00 per key", waivable: false }, text);
      expect(candidate.ownCondition).toContain("Plus Locksmith Fee");
      expect(candidate.ownUnit).toBeUndefined();
      for (const flags of [[], ["needs_darwin_verification"], ["knox_review:unclassified"], ["knox_review:untraced"], ["superseded_by_reread"]]) {
        await tx`DELETE FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
        const [old] = await tx`INSERT INTO raw_fee_observations
          (institution_id,source_document_id,fee_name,amount,frequency,conditions,extraction_note,outlier_flags,source,fee_audience,agent_event_id,extraction_confidence)
          VALUES (${f.institutionId},${f.documentId},${candidate.feeName},50,NULL,'Retained historical condition',
            ${`Knox held for review (untraced) from Rosetta artifact #${f.textId}. canonical_hint=safe_deposit_box; text_hash=${createHash("sha256").update(text).digest("hex")}; excerpt="${text}"`},
            ${JSON.stringify(flags)}::jsonb,'knox','unknown',gen_random_uuid(),.95) RETURNING fee_raw_id`;
        const [before] = await tx`SELECT to_jsonb(fr)::text AS row FROM raw_fee_observations fr WHERE fee_raw_id=${old.fee_raw_id}`;
        expect(await extract.insertCandidate(tx, { runId: f.runId,
          row: { document_text_id: f.textId, source_document_id: f.documentId, institution_id: f.institutionId,
            source_url: f.sourceUrl, text_hash: createHash("sha256").update(text).digest("hex"), normalized_text: text }, candidate,
        })).toBe(false);
        expect((await tx`SELECT to_jsonb(fr)::text AS row FROM raw_fee_observations fr WHERE fee_raw_id=${old.fee_raw_id}`)[0]).toEqual(before);
        const promoters = await import("./held-recheck");
        if (flags.includes("knox_review:untraced")) expect((await promoters.recheckUntracedRows(tx, { institutionId: f.institutionId })).promoted).toBe(0);
        if (flags.includes("superseded_by_reread")) {
          expect((await promoters.recheckSupersededRows(tx, { institutionId: f.institutionId, source: "free" })).promoted).toBe(0);
          expect((await promoters.refileSupersededRows(tx, { institutionId: f.institutionId })).refiled).toBe(0);
        }
        const [after] = await tx`SELECT frequency,conditions,outlier_flags FROM raw_fee_observations WHERE fee_raw_id=${old.fee_raw_id}`;
        expect(after).toMatchObject({ frequency: null, conditions: "Retained historical condition" });
        for (const flag of flags) expect(after.outlier_flags).toContain(flag);
      }
    });
  }, 30_000);

  it("#2248 preserves historical raw identity, frequency and conditions on ordinary and held insert conflicts", async () => {
    await rolledBack(async tx => {
      const text = "Research Fee | $25 per hour";
      const f = await seed(tx, text);
      const { withOwnFeeUnit } = await import("@/lib/custom-report/own-fee-unit");
      for (const flags of [[], ["needs_darwin_verification"], ["knox_review:unclassified"], ["knox_review:untraced"], ["superseded_by_reread"]]) {
        await tx`DELETE FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
        const [old] = await tx`INSERT INTO raw_fee_observations
          (institution_id,source_document_id,source_url,fee_name,amount,frequency,conditions,extraction_note,outlier_flags,source,fee_audience,agent_event_id,extraction_confidence)
          VALUES (${f.institutionId},${f.documentId},${f.sourceUrl ?? null},'Research Fee',25,NULL,'Retained historical condition',
            ${`Knox held for review (untraced) from Rosetta artifact #${f.textId}. canonical_hint=account_research; text_hash=${createHash("sha256").update(text).digest("hex")}; excerpt="${text}"`},
            ${JSON.stringify(flags)}::jsonb,'knox','unknown',gen_random_uuid(),.95) RETURNING fee_raw_id`;
        const [before] = await tx`SELECT to_jsonb(fr)::text AS row FROM raw_fee_observations fr WHERE fee_raw_id=${old.fee_raw_id}`;
        expect(await extract.insertCandidate(tx, { runId: f.runId,
          row: { document_text_id: f.textId, source_document_id: f.documentId, institution_id: f.institutionId,
            source_url: f.sourceUrl, text_hash: createHash("sha256").update(text).digest("hex") },
          candidate: withOwnFeeUnit({ feeName: "Research Fee", amount: 25, canonicalHint: "account_research",
            frequency: null, confidence: .95, excerpt: text, waivable: false }, text),
        })).toBe(false);
        expect((await tx`SELECT to_jsonb(fr)::text AS row FROM raw_fee_observations fr WHERE fee_raw_id=${old.fee_raw_id}`)[0]).toEqual(before);
        if (flags.includes("knox_review:untraced")) {
          const { recheckUntracedRows } = await import("./held-recheck");
          expect((await recheckUntracedRows(tx, { institutionId: f.institutionId })).promoted).toBe(0);
          const [after] = await tx`SELECT frequency,conditions,outlier_flags FROM raw_fee_observations WHERE fee_raw_id=${old.fee_raw_id}`;
          expect(after).toMatchObject({ frequency: null, conditions: "Retained historical condition" });
          expect(after.outlier_flags).toContain("knox_review:untraced");
          expect(after.outlier_flags).not.toContain("needs_darwin_verification");
        }
        if (flags.includes("superseded_by_reread")) {
          const { recheckSupersededRows, refileSupersededRows } = await import("./held-recheck");
          expect((await recheckSupersededRows(tx, { institutionId: f.institutionId, source: "free" })).promoted).toBe(0);
          expect((await refileSupersededRows(tx, { institutionId: f.institutionId })).refiled).toBe(0);
          const [after] = await tx`SELECT frequency,conditions,outlier_flags FROM raw_fee_observations WHERE fee_raw_id=${old.fee_raw_id}`;
          expect(after).toMatchObject({ frequency: null, conditions: "Retained historical condition" });
          expect(after.outlier_flags).toContain("superseded_by_reread");
          expect(after.outlier_flags).not.toContain("needs_darwin_verification");
        }
      }
    });
  }, 30_000);

  it("#2248 grounds saved paid rows in source units before the shared writer, verification and frequency fill", async () => {
    const { groundPaidRow } = await import("./paid-extract");
    const { fillBlankFrequencies } = await import("../hamilton/frequency-fill");
    const cases = [
      ["Research Fee $25 per hour", "Research Fee", 25, "account_research", "hourly"],
      ["Research Fee (per half hour) | $15.00", "Research Fee", 15, "account_research", "per_half_hour"],
      ["Research Fee (per quarter hour) | $10.00", "Research Fee", 10, "account_research", "per_quarter_hour"],
      ["| Research fee (1/2-hour minimum charge) | $50.00 per 1/2 hour |", "Research fee (1/2-hour minimum charge)", 50, "account_research", "per_half_hour"],
      ["Photocopies $1 per page", "Photocopies", 1, "document_reproduction", "per_page"],
      ["Check Images $10 per statement", "Check Images", 10, "check_image", "per_statement"],
      ["Replace Safe Deposit Box Key | $50.00 per key (Plus Locksmith Fee if unable to locate both keys)", "Replace Safe Deposit Box Key", 50, "safe_deposit_box", "per_item"],
    ] as const;
    for (const [source, feeName, amount, category, frequency] of cases) {
      await rolledBack(async tx => {
        const text = `${source}\nStop Payment Fee $31 per item\nOutgoing Domestic Wire $30 per wire`;
        const f = await seed(tx, text);
        const accepted = groundPaidRow({
          fee_name: feeName, canonical_key: category, amount, source_line: source,
          frequency: category === "safe_deposit_box" ? "per_item" : "monthly", conditions: "Unsupported model-supplied condition",
        }, text);
        expect(typeof accepted).not.toBe("string");
        if (typeof accepted === "string") return;
        expect(accepted.frequency).toBe(frequency);
        const row = {
          document_text_id: f.textId, source_document_id: f.documentId, institution_id: f.institutionId,
          source_url: f.sourceUrl, text_hash: createHash("sha256").update(text).digest("hex"),
        };
        expect(await extract.insertCandidate(tx, {
          runId: f.runId, row,
          candidate: {
            feeName: accepted.feeName, amount: accepted.amount, frequency: accepted.frequency,
            canonicalHint: accepted.canonicalKey, confidence: .95, excerpt: accepted.sourceLine,
            waivable: false, lineup: accepted.lineup, ownUnit: accepted.ownUnit, ownCondition: accepted.ownCondition,
          },
          extraFlags: ["knox_paid_extraction"],
        })).toBe(true);
        for (const control of [
          { feeName: "Stop Payment Fee", amount: 31, canonicalHint: "stop_payment", excerpt: "Stop Payment Fee $31 per item" },
          { feeName: "Outgoing Domestic Wire", amount: 30, canonicalHint: "wire_domestic_outgoing", excerpt: "Outgoing Domestic Wire $30 per wire" },
        ]) {
          await extract.insertCandidate(tx, {
            runId: f.runId, row,
            candidate: { ...control, frequency: "per_item", confidence: .95, waivable: false },
          });
        }
        await darwin.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100 });
        await publish.runHamiltonPublish({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100, minInstitutionFees: 1 });
        await fillBlankFrequencies(tx, { runId: f.runId, institutionId: f.institutionId, dryRun: false });
        const [catalog] = await tx`SELECT amount,frequency,conditions FROM published_fee_catalog
          WHERE institution_id=${f.institutionId} AND fee_name=${feeName}`;
        expect(catalog).toMatchObject({ amount, frequency });
        expect(catalog.conditions).toContain(source);
        expect(catalog.conditions).not.toContain("Unsupported model-supplied condition");
      });
    }
  }, 30_000);

  it("#2248 retains the hash-checked Morton whole-source half-hour price and minimum through normal free stages", async () => {
    await rolledBack(async tx => {
      const source = JSON.parse(readFileSync(new URL("./__fixtures__/morton-own-half-hour-unit.json", import.meta.url), "utf8"));
      expect(createHash("sha256").update(source.normalizedText).digest("hex")).toBe(source.textSHA256);
      const f = await seed(tx, source.normalizedText, {
        name: "Morton Community Bank", website: "https://hometownbanks.com/", url: source.sourceURL,
      });
      await stages(tx, f);
      const [catalog] = await tx`SELECT amount,frequency,conditions FROM published_fee_catalog
        WHERE institution_id=${f.institutionId} AND fee_name='Research fee (1/2-hour minimum charge)'`;
      expect(catalog).toMatchObject({ amount: 50, frequency: "per_half_hour" });
      expect(catalog.conditions).toContain("$50.00 per 1/2 hour");
      expect(catalog.conditions).toContain("1/2-hour minimum charge");
      const { fillBlankFrequencies } = await import("../hamilton/frequency-fill");
      await fillBlankFrequencies(tx, { runId: f.runId, institutionId: f.institutionId, dryRun: false });
      const [after] = await tx`SELECT amount,frequency,conditions FROM published_fee_catalog
        WHERE institution_id=${f.institutionId} AND fee_name='Research fee (1/2-hour minimum charge)'`;
      expect(after).toEqual(catalog);
    });
  }, 30_000);

  it("#2248 keeps SQL and client comparison exclusion equal for every transport whitespace and unit code", async () => {
    await rolledBack(async tx => {
      const { SPECIAL_UNIT_FREQUENCIES, isSpecialUnitFrequency, specialUnitSql } = await import("@/lib/fee-unit");
      const whitespace = ["", "\t", "\n", "\v", "\f", "\r", " ", "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff"];
      const inputs: Array<{ frequency: string | null }> = [{ frequency: null }, { frequency: "" }, { frequency: "other" }, { frequency: "per_item" }];
      for (const unit of SPECIAL_UNIT_FREQUENCIES) {
        for (const space of whitespace) inputs.push({ frequency: `${space}${unit.toUpperCase()}${space}` });
      }
      for (const frequency of ["per_İmage", "per_ımage", "\u0085hourly", "\u180ehourly", "\u200bhourly", "per page"]) inputs.push({ frequency });
      const rows = await tx`SELECT input.frequency, ${tx.unsafe(specialUnitSql("input"))} AS excluded
        FROM jsonb_to_recordset(${JSON.stringify(inputs)}::jsonb) AS input(frequency text)`;
      for (const row of rows) expect(row.excluded, String(row.frequency)).toBe(isSpecialUnitFrequency(row.frequency));
    });
  });

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
