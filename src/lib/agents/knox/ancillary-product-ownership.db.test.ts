// @vitest-environment node
/** Actual lineage/schema regressions. All data is rolled back in an owned loopback database. */
import postgres from "postgres";
import { withAncillaryProduct } from "./ancillary-product";
import { productKey, productKeySql } from "@/lib/fee-product";
import { feeScheduleContext } from "@/app/(public)/institution/[id]/profile-fee-context";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ancillaryAccountText, ancillaryOfficialText } from "./ancillary-product-fixtures";

vi.mock("@/lib/agents/fee-source-fetch", async (original) => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Ancillary product SQL fixtures forbid network/provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
type Fixture = { institutionId: number; runId: number; documentId: number; textId: number; text: string };

describe.skipIf(!connection)("Ancillary account ownership in actual SQL (#1911 code phase)", () => {
  let db: postgres.Sql;
  let appSql: Db;
  let syncPipelineFeedback: typeof import("../learning/feedback-sync").syncPipelineFeedback;
  let loadKnoxCalibration: typeof import("./calibration").loadKnoxCalibration;
  let extract: typeof import("./extract");
  let verify: typeof import("../darwin/verify");
  let publish: typeof import("../hamilton/publish");
  let collapse: typeof import("../hamilton/duplicate-collapse");
  let page: typeof import("../hamilton/page-copy-collapse");
  let safe: string;
  let nextRunId = -191_100_000 - process.pid * 100;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Ancillary tests require a disposable loopback database; production is forbidden");
    }
    vi.stubEnv("DATABASE_URL", connection);
    const connectionModule = await import("@/lib/data-store/connection");
    appSql = connectionModule.sql;
    ({syncPipelineFeedback}=await import("../learning/feedback-sync"));
    ({loadKnoxCalibration}=await import("./calibration"));
    db = postgres(connection, { max: 1, ssl: "require", types: {
      numeric: connectionModule.NUMERIC_AS_NUMBER, json: connectionModule.JSON_TEXT_PASSTHROUGH, text: connectionModule.TEXT_WITHOUT_NUL,
    } }) as unknown as postgres.Sql;
    extract = await import("./extract");
    verify = await import("../darwin/verify");
    publish = await import("../hamilton/publish");
    collapse = await import("../hamilton/duplicate-collapse");
    page = await import("../hamilton/page-copy-collapse");
    safe = await ancillaryOfficialText("safe");
  });
  afterAll(async () => { if (db) await db.end(); if (appSql) await appSql.end(); vi.unstubAllEnvs(); });
  async function rollback(test: (tx: Db) => Promise<void>) {
    const stop = new Error("rollback ancillary fixture");
    await db.begin(async (scope) => { await test(scope as unknown as Db); throw stop; })
      .catch((error) => { if (error !== stop) throw error; });
  }
  async function seed(tx: Db, text: string): Promise<Fixture> {
    const [{ id }] = await tx`INSERT INTO institution_sources
      (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
      VALUES ('Fixture Community Bank','https://product.example/', 'https://product.example/fees.pdf',
       'bank','Texas','TX',1000000,'e2e','active') RETURNING id`;
    const [{ id: runId }] = await tx`INSERT INTO agent_runs (id,agent_name,run_kind,title,status)
      VALUES (${nextRunId--},'knox','state_agent','Ancillary product SQL fixture','running') RETURNING id`;
    return addDocument(tx, { institutionId: Number(id), runId: Number(runId) }, text);
  }
  async function addDocument(tx: Db, base: Pick<Fixture, "institutionId" | "runId">, text: string): Promise<Fixture> {
    const hash = createHash("sha256").update(text).digest("hex");
    const url = `https://product.example/${hash.slice(0, 12)}.pdf`;
    const [{ id: documentId }] = await tx`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type)
      VALUES (${base.institutionId},'success',${url},${hash},'application/pdf') RETURNING id`;
    const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
      (agent_run_id,source_document_id,institution_id,source_url,document_type,content_type,status,normalized_text,text_hash,char_count)
      VALUES (${base.runId},${documentId},${base.institutionId},${url},'text_pdf','application/pdf','completed',${text},${hash},${text.length}) RETURNING id`;
    return { ...base, documentId: Number(documentId), textId: Number(textId), text };
  }
  async function read(tx: Db, f: Fixture) {
    await extract.runKnoxExtract({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 10 });
    return verify.runDarwinVerify({ db: tx, runId: f.runId, institutionId: f.institutionId, limit: 100 });
  }
  const published = (tx: Db, f: Fixture) => publish.runHamiltonPublish({ db: tx, runId: f.runId,
    institutionId: f.institutionId, limit: 100, minInstitutionFees: 1 });

  it("agrees with actual PostgreSQL on supported product whitespace/case without Unicode over-merging", async () => {
    const values = [null, "", " ", "\u00a0", "\tEveryday\u00a0 Debit Account\n", "EVERYDAY   DEBIT ACCOUNT", "México Account", "méxico account",
      "Ü Account", "ü Account", "İ Account", "i Account", "Debit\u2003Account", "Debit Account", "Premium Debit Account"];
    await rollback(async (tx) => {
      const keys = await tx<{value:string|null; key:string}[]>`SELECT v.value, ${tx.unsafe(productKeySql("v.value"))} AS key FROM unnest(${values}::text[]) v(value)`;
      expect(keys.map((r) => r.key)).toEqual(values.map(productKey));
      expect(new Set(keys.slice(-3).map((r) => r.key)).size).toBe(3);
    });
  });

  async function forcePublished(tx:Db,f:Fixture) {
    return tx`INSERT INTO published_fee_records (lineage_ref,institution_id,canonical_fee_key,fee_name,amount,frequency,amount_kind,batch_id,
      published_by_adversarial_event_id,verified_by_agent_event_id,agent_event_id)
      SELECT fv.fee_verified_id,fv.institution_id,fv.canonical_fee_key,fv.fee_name,fv.amount,fv.frequency,'flat','ancillary-test',
        fv.verified_by_agent_event_id,fv.verified_by_agent_event_id,fr.agent_event_id
      FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
      WHERE fv.institution_id=${f.institutionId} RETURNING fee_published_id`;
  }

  it.each([null,"Premium Debit Account","everyday  DEBIT Account"])("page-copy SQL keeps different/unassigned product %s and still closes normalized twins",async(product)=>{
    await rollback(async(tx)=>{
      const f=await seed(tx,ancillaryAccountText());
      const second=await addDocument(tx,f,ancillaryAccountText("Premium Debit Account"));
      await read(tx,f);
      await tx`UPDATE raw_fee_observations SET product_name=${product} WHERE source_document_id=${second.documentId}`;
      await tx`UPDATE source_documents SET document_url='https://product.example/fees.pdf' WHERE institution_id=${f.institutionId}`;
      await forcePublished(tx,f);
      const result=await page.collapsePageCopies(tx,{runId:f.runId,batchId:'product-page',dryRun:false,institutionId:f.institutionId,live:true});
      expect(result.error).toBeUndefined();
      expect(result.collapses).toHaveLength(product==='everyday  DEBIT Account'?3:0);
    });
  });

  it.each([null,"Premium Debit Account","everyday  DEBIT Account"])("near-name SQL keeps different/unassigned product %s and still closes normalized twins",async(product)=>{
    await rollback(async(tx)=>{
      const f=await seed(tx,ancillaryAccountText());
      const second=await addDocument(tx,f,ancillaryAccountText("Premium Debit Account"));
      await read(tx,f);
      await tx`UPDATE raw_fee_observations SET source_document_id=${f.documentId},fee_name='Money order',product_name=${product}
        WHERE source_document_id=${second.documentId} AND fee_name='Personal money order'`;
      await tx`UPDATE verified_fee_observations fv SET fee_name=fr.fee_name FROM raw_fee_observations fr
        WHERE fv.fee_raw_id=fr.fee_raw_id AND fr.institution_id=${f.institutionId}`;
      await forcePublished(tx,f);
      const result=await collapse.collapseNearNameDuplicates(tx,{runId:f.runId,batchId:'product-near',dryRun:false,institutionId:f.institutionId,live:true});
      expect(result.collapses).toHaveLength(product==='everyday  DEBIT Account'?1:0);
    });
  });

  it.each(["pending","held","verified"])("keeps existing %s raw ownership on an ordinarily due same-document insert conflict",async(state)=>{
    await rollback(async(tx)=>{
      const text=ancillaryAccountText();
      const f=await seed(tx,text);
      await extract.runKnoxExtract({db:tx,runId:f.runId,institutionId:f.institutionId,limit:10});
      await tx`UPDATE raw_fee_observations SET product_name=NULL,outlier_flags=outlier_flags-'ancillary_product:v1' WHERE source_document_id=${f.documentId}`;
      if(state==='held') await tx`UPDATE raw_fee_observations SET outlier_flags=(outlier_flags-'needs_darwin_verification')||'["knox_review:untraced"]'::jsonb
        WHERE source_document_id=${f.documentId}`;
      if(state==='verified') await verify.runDarwinVerify({db:tx,runId:f.runId,institutionId:f.institutionId,limit:100});
      const before=await tx`SELECT fee_raw_id,product_name,outlier_flags,extraction_note,conditions,line_share FROM raw_fee_observations
        WHERE source_document_id=${f.documentId} AND fee_name='Personal money order'`;
      const candidate=withAncillaryProduct({feeName:'Personal money order',canonicalHint:'money_order',amount:5,frequency:'per_item',
        confidence:.95,excerpt:'Personal money order | $5.00 each',waivable:false},text);
      expect(candidate.ancillaryProduct).toBeDefined();
      await extract.insertCandidate(tx,{runId:f.runId,row:({document_text_id:f.textId,source_document_id:f.documentId,
        institution_id:f.institutionId,source_url:'https://product.example/fees.pdf',text_hash:createHash('sha256').update(text).digest('hex')} as Parameters<typeof extract.insertCandidate>[1]['row']),candidate});
      expect(await tx`SELECT fee_raw_id,product_name,outlier_flags,extraction_note,conditions,line_share FROM raw_fee_observations
        WHERE source_document_id=${f.documentId} AND fee_name='Personal money order'`).toEqual(before);
    });
  });

  it("does not verify a v1-owned raw fee using a different product's title or a price outside its fee block",async()=>{
    await rollback(async(tx)=>{
      const f=await seed(tx,ancillaryAccountText());
      await extract.runKnoxExtract({db:tx,runId:f.runId,institutionId:f.institutionId,limit:10});
      await tx`UPDATE raw_fee_observations SET product_name='Premium Debit Account' WHERE source_document_id=${f.documentId}`;
      const result=await verify.runDarwinVerify({db:tx,runId:f.runId,institutionId:f.institutionId,limit:100});
      expect(result.results.filter((r)=>r.reasonCode==='not_in_source')).toHaveLength(3);
      expect(await tx`SELECT 1 FROM verified_fee_observations WHERE institution_id=${f.institutionId}`).toHaveLength(0);
    });
  });

  it("retains the actual current Safe Debit PDF's two ancillary account exceptions through catalog lineage", async () => {
    await rollback(async (tx) => {
      const f = await seed(tx, safe);
      // The public catalog requires three categories; use the bank's actual general guide,
      // preserving its unassigned $3 ATM/$5 money-order rows beside these exceptions.
      const general = await addDocument(tx, f, await ancillaryOfficialText("general"));
      await read(tx, f);
      const raw = await tx`SELECT fee_name,amount,frequency,product_name,conditions FROM raw_fee_observations
        WHERE source_document_id=${f.documentId} AND amount IN (1.65,2.5) ORDER BY amount`;
      expect(raw).toHaveLength(2);
      for (const row of raw) {
        expect(row.product_name).toBe("Safe Debit Account");
        expect(row.conditions).toContain("Safe Debit Account");
        expect(row.conditions).toContain("exceptions");
        expect(feeScheduleContext({ fee_name:row.fee_name,amount:Number(row.amount),conditions:row.conditions,
          account_product_type:row.product_name,waiver_text:null,source_line:null })).toContain("Safe Debit Account");
      }
      expect(raw.map((r) => r.frequency)).toEqual(["per_item", null]);
      const publication = await published(tx, f);
      const catalog = await tx`SELECT amount,account_product_type,conditions FROM published_fee_catalog
        WHERE institution_id=${f.institutionId} AND source_document_id=${f.documentId} AND amount IN (1.65,2.5) ORDER BY amount`;
      expect(catalog, JSON.stringify(publication)).toHaveLength(2);
      expect(catalog.every((r) => r.account_product_type === "Safe Debit Account")).toBe(true);
      expect(await tx`SELECT canonical_fee_key,amount,account_product_type FROM published_fee_catalog
        WHERE institution_id=${f.institutionId} AND source_document_id=${general.documentId}
        AND (canonical_fee_key='money_order' AND amount=5 OR canonical_fee_key='atm_non_network' AND amount=3)
        ORDER BY amount`).toEqual([{canonical_fee_key:'atm_non_network',amount:3,account_product_type:null},
          {canonical_fee_key:'money_order',amount:5,account_product_type:null}]);
      await read(tx, f); await published(tx, f);
      expect(await tx`SELECT 1 FROM published_fee_catalog WHERE institution_id=${f.institutionId} AND source_document_id=${f.documentId} AND amount IN (1.65,2.5)`).toHaveLength(2);
    });
  }, 30_000);

  it("publishes equal-priced represented products as separate fees instead of skipping one as identical", async () => {
    await rollback(async (tx) => {
      const first = await seed(tx, ancillaryAccountText("Everyday Debit Account"));
      const second = await addDocument(tx, first, ancillaryAccountText("Premium Debit Account"));
      await read(tx, first);
      // Explicit represented fixture ownership isolates publication from the extractor defect.
      await tx`UPDATE raw_fee_observations SET product_name='Everyday Debit Account' WHERE source_document_id=${first.documentId}`;
      await tx`UPDATE raw_fee_observations SET product_name='Premium Debit Account' WHERE source_document_id=${second.documentId}`;
      await published(tx, first);
      const rows = await tx`SELECT amount,account_product_type FROM published_fee_catalog
        WHERE institution_id=${first.institutionId} AND canonical_fee_key='money_order' ORDER BY account_product_type`;
      expect(rows).toEqual([{ amount: 5, account_product_type: "Everyday Debit Account" }, { amount: 5, account_product_type: "Premium Debit Account" }]);
    });
  }, 30_000);

  it("keeps different represented products apart in the actual exact-collapse UPDATE", async () => {
    await rollback(async (tx) => {
      const first = await seed(tx, ancillaryAccountText("Everyday Debit Account"));
      const second = await addDocument(tx, first, ancillaryAccountText("Premium Debit Account"));
      await read(tx, first);
      await tx`UPDATE raw_fee_observations SET product_name='Everyday Debit Account' WHERE source_document_id=${first.documentId}`;
      await tx`UPDATE raw_fee_observations SET product_name='Premium Debit Account' WHERE source_document_id=${second.documentId}`;
      await tx`INSERT INTO published_fee_records (lineage_ref,institution_id,canonical_fee_key,fee_name,amount,frequency,amount_kind,batch_id,
        published_by_adversarial_event_id,verified_by_agent_event_id,agent_event_id)
        SELECT fv.fee_verified_id,fv.institution_id,fv.canonical_fee_key,fv.fee_name,fv.amount,fv.frequency,'flat','ancillary-test',
          fv.verified_by_agent_event_id,fv.verified_by_agent_event_id,fr.agent_event_id
        FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
        WHERE fv.institution_id=${first.institutionId} AND fv.canonical_fee_key='money_order'`;
      expect(await collapse.collapsePublishedDuplicates(tx, { runId:first.runId,batchId:'ancillary-test',dryRun:false,institutionId:first.institutionId })).toEqual([]);
      expect(await tx`SELECT 1 FROM published_fee_records WHERE institution_id=${first.institutionId} AND rolled_back_at IS NULL`).toHaveLength(2);
    });
  }, 30_000);  it.each(["audience", "status", "amount", "flags", "frequency", "rate", "source_event", "raw_product", "raw_lineage"])("defers frozen publication after selected verification/raw %s changed", async (changed) => {
    await rollback(async (tx) => {
      const f=await seed(tx,ancillaryAccountText()); await read(tx,f);
      let changedOnce=false;
      const wrap=(scope:Db):Db => {
        const tag=async(strings:TemplateStringsArray,...values:unknown[])=>{
          if(!changedOnce && strings.join(" ").includes("SELECT fp.lineage_ref FROM published_fee_records fp")) {
            changedOnce=true;
            if(changed==="audience") {
              await tx`UPDATE raw_fee_observations SET fee_audience='business',audience_evidence='Fixture changed to business' WHERE institution_id=${f.institutionId} AND product_name='Everyday Debit Account'`;
              await tx`UPDATE verified_fee_observations SET fee_audience='business' WHERE institution_id=${f.institutionId}`;
            }
            if(changed==="status") await tx`UPDATE verified_fee_observations SET review_status='rejected' WHERE institution_id=${f.institutionId}`;
            if(changed==="amount") await tx`UPDATE verified_fee_observations SET amount=99 WHERE institution_id=${f.institutionId}`;
            if(changed==='flags') await tx`UPDATE verified_fee_observations SET outlier_flags=outlier_flags||'["needs_human"]'::jsonb WHERE institution_id=${f.institutionId}`;
            if(changed==='frequency') await tx`UPDATE verified_fee_observations SET frequency='annual' WHERE institution_id=${f.institutionId}`;
            if(changed==='rate') await tx`UPDATE verified_fee_observations SET amount=NULL,amount_kind='percent',rate_percent=5,rate_basis='transaction' WHERE institution_id=${f.institutionId}`;
            if(changed==='source_event') await tx`UPDATE verified_fee_observations SET source_url='https://product.example/changed.pdf',verified_by_agent_event_id='00000000-0000-4000-8000-000000000999' WHERE institution_id=${f.institutionId}`;
            if(changed==='raw_product') await tx`UPDATE raw_fee_observations SET product_name='Premium Debit Account' WHERE institution_id=${f.institutionId}`;
            if(changed==='raw_lineage') {
              const originals=await tx`SELECT fv.fee_verified_id,fr.* FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id WHERE fv.institution_id=${f.institutionId}`;
              for(const original of originals) {
                const [fresh]=await tx`INSERT INTO raw_fee_observations (institution_id,source_document_id,fee_name,amount,source,fee_audience,product_name,agent_event_id)
                  VALUES (${f.institutionId},${f.documentId},${original.fee_name+' fresh lineage'},${original.amount},'knox',${original.fee_audience},${original.product_name},${original.agent_event_id}::uuid) RETURNING fee_raw_id`;
                await tx`UPDATE verified_fee_observations SET fee_raw_id=${fresh.fee_raw_id} WHERE fee_verified_id=${original.fee_verified_id}`;
              }
            }
          }
          return (scope as unknown as (...args:unknown[])=>Promise<unknown>)(strings,...values);
        };
        Object.assign(tag,{unsafe:scope.unsafe.bind(scope),savepoint:(work:(inner:Db)=>Promise<unknown>)=>(scope as unknown as {savepoint:(work:(inner:Db)=>Promise<unknown>)=>Promise<unknown>}).savepoint(inner=>work(wrap(inner)))});
        return tag as unknown as Db;
      };
      const feedbackBefore=await tx`SELECT * FROM pipeline_feedback WHERE institution_id=${f.institutionId} ORDER BY id`;
      const calibrationBefore=changed==='status'?await loadKnoxCalibration(tx):null;
      const result=await published(wrap(tx),f);
      const rows=await tx`SELECT fp.amount,fp.fee_audience,fv.review_status,fv.amount AS current_verified_amount FROM published_fee_records fp JOIN verified_fee_observations fv ON fv.fee_verified_id=fp.lineage_ref WHERE fp.institution_id=${f.institutionId}`;
      expect(changedOnce).toBe(true);
      expect(rows,JSON.stringify({changed,rows,result})).toHaveLength(0);
      expect(result.results).toHaveLength(3);
      expect(result.results.every((row)=>row.reason?.includes('deferred') && row.identityDeferred)).toBe(true);
      expect(await tx`SELECT 1 FROM fee_change_records WHERE institution_id=${f.institutionId}`).toHaveLength(0);
      expect(await tx`SELECT 1 FROM pipeline_attempts WHERE institution_id=${f.institutionId} AND strategy=${publish.HAMILTON_PUBLISH_STRATEGY.strategy}`).toHaveLength(0);
      if(changed==='status') {
        await syncPipelineFeedback(tx,{runId:f.runId});
        expect(await tx`SELECT * FROM pipeline_feedback WHERE institution_id=${f.institutionId} ORDER BY id`).toEqual(feedbackBefore);
        expect(await loadKnoxCalibration(tx)).toEqual(calibrationBefore);
        expect(await tx`SELECT 1 FROM hamilton_signals WHERE institution_id=${f.institutionId}
          AND signal_type IN ('hamilton_publication_completed','hamilton_fee_movement_detected')`).toHaveLength(0);
        expect(result).toMatchObject({identityDeferredFees:3,outcomes:{evidence_mismatch:3}});
        await tx`UPDATE verified_fee_observations SET review_status='verified' WHERE institution_id=${f.institutionId}`;
        expect((await published(tx,f)).publishedFees).toBe(3);
      }
    });
  });

  it.each([false,true])("preserves a selected prior fee when replacement verification changes=%s",async(change)=>{
    await rollback(async(tx)=>{
      const f=await seed(tx,ancillaryAccountText()); await read(tx,f); await published(tx,f);
      const [prior]=await tx`SELECT fee_published_id FROM published_fee_records WHERE institution_id=${f.institutionId} AND canonical_fee_key='money_order'`;
      const fresh=await addDocument(tx,f,ancillaryAccountText('Everyday Debit Account',7));
      await tx`UPDATE source_documents SET document_url='https://product.example/fees.pdf',crawled_at='2026-01-01' WHERE id=${f.documentId}`;
      await tx`UPDATE source_documents SET document_url='https://product.example/fees.pdf',crawled_at='2026-02-01' WHERE id=${fresh.documentId}`;
      await read(tx,fresh);
      let changed=false;
      const wrap=(scope:Db):Db=>{
        const tag=async(strings:TemplateStringsArray,...values:unknown[])=>{
          if(change && !changed && strings.join(' ').includes('SELECT fp.lineage_ref FROM published_fee_records fp')) {
            changed=true;
            await tx`UPDATE verified_fee_observations fv SET amount=99 FROM raw_fee_observations fr WHERE fv.fee_raw_id=fr.fee_raw_id
              AND fr.source_document_id=${fresh.documentId} AND fv.canonical_fee_key='money_order'`;
          }
          return (scope as unknown as (...args:unknown[])=>Promise<unknown>)(strings,...values);
        };
        return Object.assign(tag,{unsafe:scope.unsafe.bind(scope),savepoint:(work:(inner:Db)=>Promise<unknown>)=>
          (scope as unknown as {savepoint:(work:(inner:Db)=>Promise<unknown>)=>Promise<unknown>}).savepoint(inner=>work(wrap(inner)))}) as unknown as Db;
      };
      const result=await published(wrap(tx),fresh);
      const rows=await tx`SELECT fee_published_id,amount FROM published_fee_records WHERE institution_id=${f.institutionId}
        AND canonical_fee_key='money_order' AND rolled_back_at IS NULL`;
      expect(rows).toHaveLength(1); expect(Number(rows[0].amount)).toBe(change?5:7);
      expect((await tx`SELECT rolled_back_at FROM published_fee_records WHERE fee_published_id=${prior.fee_published_id}`)[0].rolled_back_at===null).toBe(change);
      if(change) expect(result.results.some((row)=>row.reason?.includes('deferred'))).toBe(true);
    });
  });

  it("defers current verified status committed during a real two-connection lock wait",async()=>{
    // This one fixture must commit for another session to see it. The owned loopback-only
    // cohort is removed by institution/run ID in finally; no public sequence run IDs are used.
    let f:Fixture|undefined;
    const holder=postgres(connection!,{max:1,ssl:'require'}),writer=postgres(connection!,{max:1,ssl:'require'});
    let release!:()=>void,locked!:()=>void,started!:(pid:number)=>void;
    const canCommit=new Promise<void>((resolve)=>{release=resolve;});
    const hasLock=new Promise<void>((resolve)=>{locked=resolve;});
    const writerPid=new Promise<number>((resolve)=>{started=resolve;});
    let holding:Promise<unknown>|undefined,writing:Promise<unknown>|undefined;
    try {
      f=await db.begin(async(scope)=>{const tx=scope as unknown as Db;const fixture=await seed(tx,ancillaryAccountText());await read(tx,fixture);return fixture;});
      const fixture=f;
      holding=holder.begin(async(scope)=>{
        const tx=scope as unknown as Db;
        await tx`SELECT fee_verified_id FROM verified_fee_observations WHERE institution_id=${fixture.institutionId} ORDER BY fee_verified_id FOR UPDATE`;
        await tx`UPDATE verified_fee_observations SET review_status='rejected' WHERE institution_id=${fixture.institutionId}`;
        locked();await canCommit;
      });
      await hasLock;
      writing=writer.begin(async(scope)=>{
        const tx=scope as unknown as Db;
        const [{pid}]=await tx`SELECT pg_backend_pid() AS pid`;started(Number(pid));
        return published(tx,fixture);
      });
      const pid=await writerPid;
      let blocked=false;
      for(let i=0;i<200;i++) {
        const [state]=await db`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
        if(state?.wait_event_type==='Lock') {blocked=true;break;}
        await new Promise((resolve)=>setTimeout(resolve,10));
      }
      expect(blocked).toBe(true);release();await holding;
      const result=await writing as Awaited<ReturnType<typeof published>>;
      expect(result.publishedFees).toBe(0);
      expect(result.results.every((row)=>row.reason?.includes('deferred') && row.identityDeferred)).toBe(true);
      expect(await db`SELECT 1 FROM published_fee_records WHERE institution_id=${fixture.institutionId}`).toHaveLength(0);
    } finally {
      release();await Promise.allSettled([holding,writing]);await holder.end();await writer.end();
      if(f) await db.begin(async(scope)=>{
        const tx=scope as unknown as Db;
        await tx`DELETE FROM fee_change_records WHERE institution_id=${f!.institutionId}`;
        await tx`DELETE FROM published_fee_records WHERE institution_id=${f!.institutionId}`;
        await tx`DELETE FROM verified_fee_observations WHERE institution_id=${f!.institutionId}`;
        await tx`DELETE FROM raw_fee_observations WHERE institution_id=${f!.institutionId}`;
        await tx`DELETE FROM hamilton_signals WHERE institution_id=${f!.institutionId}`;
        await tx`DELETE FROM source_documents WHERE institution_id=${f!.institutionId}`;
        await tx`DELETE FROM institution_sources WHERE id=${f!.institutionId}`;
        await tx`DELETE FROM agent_institution_run_results WHERE agent_run_id=${f!.runId}`;
        await tx`DELETE FROM agent_runs WHERE id=${f!.runId}`;
      });
    }
  },15_000);

});
