// @vitest-environment node
/** Production-schema proof in an owned loopback database. Fixtures never call providers. */
import postgres from "postgres";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtractedFeeCandidate } from "./rules";
import { prospectiveTakedownIdentity } from "./takedown-witness";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));
vi.mock("@/lib/agents/fee-source-fetch", async (original) => ({
  ...await original<typeof import("@/lib/agents/fee-source-fetch")>(),
  feeSourceFetch: () => { throw new Error("Learned-hold SQL fixtures forbid network and provider requests"); },
}));
const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
type Fixture = { institutionId:number; runId:number; documentId:number; textId:number; text:string; hash:string;
  candidate:ExtractedFeeCandidate; rawId:number; verifiedId:number; publishedId:number; runIds:number[] };

describe.skipIf(!connection)("Confirmed learned holds preserve identity and original source (#2186)", () => {
  let db:postgres.Sql;
  let appSql:Db;
  let extract:typeof import("./extract");
  let lessons:typeof import("./takedown-lessons");
  let limits:typeof import("../hamilton/limit-guard");
  // Private explicit positive IDs are required by the witness. Never consume the public run sequence.
  let nextRunId=1_800_000_000-process.pid*100;
  beforeAll(async()=>{
    if(!connection || !["localhost","127.0.0.1","[::1]"].includes(new URL(connection).hostname))
      throw new Error("Learned-hold tests require a disposable loopback production-schema database");
    vi.stubEnv("DATABASE_URL",connection);
    const connectionModule=await import("@/lib/data-store/connection");appSql=connectionModule.sql;
    db=postgres(connection,{max:3,ssl:"require",types:{numeric:connectionModule.NUMERIC_AS_NUMBER,json:connectionModule.JSON_TEXT_PASSTHROUGH,text:connectionModule.TEXT_WITHOUT_NUL}}) as unknown as postgres.Sql;
    extract=await import("./extract");lessons=await import("./takedown-lessons");limits=await import("../hamilton/limit-guard");
  });
  afterAll(async()=>{if(db)await db.end();if(appSql)await appSql.end();vi.unstubAllEnvs();});
  async function client(){
    const connectionModule=await import("@/lib/data-store/connection");
    return postgres(connection!,{max:1,ssl:"require",types:{numeric:connectionModule.NUMERIC_AS_NUMBER,json:connectionModule.JSON_TEXT_PASSTHROUGH,text:connectionModule.TEXT_WITHOUT_NUL}}) as unknown as postgres.Sql;
  }
  async function rollback(test:(tx:Db)=>Promise<void>){
    const stop=new Error("rollback learned-hold fixture");
    await db.begin(async scope=>{await test(scope as unknown as Db);throw stop;}).catch(error=>{if(error!==stop)throw error;});
  }
  const candidate=(changes:Partial<ExtractedFeeCandidate>={}):ExtractedFeeCandidate=>({
    feeName:"Monthly Account Limit",canonicalHint:"monthly_maintenance",amount:1000,frequency:"monthly",confidence:.99,
    excerpt:"Monthly Account Limit | $1,000.00",waivable:false,
    lineup:{productName:"Alpha Checking",minBalanceToAvoid:null,minOpeningDeposit:null,waiverText:null},...changes,
  });
  async function document(tx:Db,base:Pick<Fixture,"institutionId"|"runId">,text:string){
    const hash=createHash("sha256").update(text).digest("hex"),url=`https://lesson.example/${randomUUID()}.pdf`;
    // Distinct PDF bytes/URLs can normalize to identical text. Document bytes and text hashes are separate contracts.
    const bytesHash=createHash("sha256").update(`${url}\n${text}`).digest("hex");
    const [{id:documentId}]=await tx`INSERT INTO source_documents(institution_id,status,document_url,content_hash,content_type)
      VALUES(${base.institutionId},'success',${url},${bytesHash},'application/pdf') RETURNING id`;
    const [{id:textId}]=await tx`INSERT INTO agent_source_texts(agent_run_id,source_document_id,institution_id,source_url,
      document_type,content_type,status,normalized_text,text_hash,char_count)
      VALUES(${base.runId},${documentId},${base.institutionId},${url},'text_pdf','application/pdf','completed',${text},${hash},${text.length}) RETURNING id`;
    return {...base,documentId:Number(documentId),textId:Number(textId),text,hash};
  }
  function context(f:Pick<Fixture,"institutionId"|"documentId"|"textId"|"text"|"hash">){
    return {document_text_id:f.textId,source_document_id:f.documentId,institution_id:f.institutionId,
      source_url:"https://lesson.example/fees.pdf",normalized_text:f.text,text_hash:f.hash,institution_name:"Learned fixture"} as Parameters<typeof extract.insertCandidate>[1]["row"];
  }
  async function seed(tx:Db,changes:Partial<ExtractedFeeCandidate>={}):Promise<Fixture>{
    const [{id}]=await tx`INSERT INTO institution_sources(institution_name,website_url,charter_type,state,state_code,source,status)
      VALUES('Learned-hold fixture','https://lesson.example/','bank','Texas','TX','e2e','active') RETURNING id`;
    const [{id:runId}]=await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
      VALUES(${nextRunId--},'hamilton','state_agent','Learned-hold fixture','running') RETURNING id`;
    const c=candidate(changes),f=await document(tx,{institutionId:Number(id),runId:Number(runId)},`Account services\n${c.excerpt}\n`);
    expect(await extract.insertCandidate(tx,{runId:f.runId,row:context(f),candidate:c})).toBe(true);
    const [{fee_raw_id:rawId}]=await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE source_document_id=${f.documentId}`;
    const [{fee_verified_id:verifiedId}]=await tx`INSERT INTO verified_fee_observations(fee_raw_id,institution_id,source_url,
      canonical_fee_key,verified_by_agent_event_id,fee_name,amount,frequency,fee_audience,amount_kind)
      SELECT fee_raw_id,institution_id,source_url,${c.canonicalHint},agent_event_id,fee_name,amount,frequency,fee_audience,'flat'
      FROM raw_fee_observations WHERE fee_raw_id=${rawId} RETURNING fee_verified_id`;
    const [{fee_published_id:publishedId}]=await tx`INSERT INTO published_fee_records(lineage_ref,institution_id,canonical_fee_key,
      fee_name,amount,frequency,fee_audience,amount_kind,published_by_adversarial_event_id,verified_by_agent_event_id,agent_event_id,batch_id)
      SELECT fv.fee_verified_id,fv.institution_id,fv.canonical_fee_key,fv.fee_name,fv.amount,fv.frequency,fv.fee_audience,'flat',
      fv.verified_by_agent_event_id,fv.verified_by_agent_event_id,fr.agent_event_id,'initial'
      FROM verified_fee_observations fv JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
      WHERE fv.fee_verified_id=${verifiedId} RETURNING fee_published_id`;
    return {...f,candidate:c,rawId:Number(rawId),verifiedId:Number(verifiedId),publishedId:Number(publishedId),runIds:[f.runId]};
  }
  async function confirm(tx:Db,f:Fixture){
    const options={runId:f.runId,batchId:`learned-${f.runId}`,institutionId:f.institutionId,dryRun:false};
    expect(await limits.rollBackLimitsPublishedAsFees(tx,options)).toEqual([]);
    await tx`UPDATE pipeline_feedback SET evidence=jsonb_set(evidence,'{flagged_at}',to_jsonb((now()-interval '13 hours')::text))
      WHERE fee_published_id=${f.publishedId} AND kind='takedown_pending'`;
    const runId=nextRunId--;
    f.runIds.push(runId);
    await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status) VALUES(${runId},'hamilton','state_agent','Confirmation fixture','running')`;
    const closed=await limits.rollBackLimitsPublishedAsFees(tx,{...options,runId,batchId:`learned-${runId}`});
    expect(closed).toHaveLength(1);
    const [row]=await tx`SELECT evidence,kind FROM pipeline_feedback WHERE fee_published_id=${f.publishedId} AND kind='takedown_confirmed'`;
    expect(row?.evidence?.takedown_witness).toMatchObject({version:1,judgeRunId:runId,publishedId:f.publishedId,
      source:{artifactId:f.textId,sourceDocumentId:f.documentId,hash:f.hash}});
    return lessons.loadTakedownLessons(tx,[f.institutionId]);
  }
  async function insertCopy(tx:Db,f:Fixture,index:Awaited<ReturnType<typeof lessons.loadTakedownLessons>>,c=f.candidate,text=f.text){
    const copy=await document(tx,f,text);
    const receipt=await extract.insertCandidateWithLearning(tx,{runId:f.runId,row:context(copy),candidate:c},index);
    const rows=await tx`SELECT * FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`;
    return {receipt,row:rows[0],copy};
  }

  it("carries a pre-judgement witness through actual limit guard confirmation into a same-identity insert",async()=>{
    await rollback(async tx=>{
      const f=await seed(tx),index=await confirm(tx,f);
      expect(index.size,JSON.stringify(index.unknownReasons)).toBe(1);
      const {receipt,row}=await insertCopy(tx,f,index);
      expect(receipt).toMatchObject({inserted:true,takenDownBy:"hamilton.limit_guard",declinedReason:null});
      expect(row.outlier_flags).toEqual(expect.arrayContaining(["knox_review:taken_down","knox_lesson:taken_down:hamilton.limit_guard"]));
      expect(row.outlier_flags).not.toContain("needs_darwin_verification");
      expect(row.product_name).toBe("Alpha Checking");
    });
  });
  it("counts only the actual held insert in the extract caller on a normally due current copy",async()=>{
    await rollback(async tx=>{
      const f=await seed(tx,{feeName:"Online Bill Payment Fee",canonicalHint:"bill_pay",amount:1000,frequency:null,
        excerpt:"Online Bill Payment Fee | $1000.00",lineup:undefined});
      await confirm(tx,f);const copy=await document(tx,f,f.text);
      // Existing selection exception: a superseded document does not suppress its current copy.
      await tx`UPDATE source_documents SET superseded_by_id=${copy.documentId} WHERE id=${f.documentId}`;
      const result=await extract.runKnoxExtract({db:tx,runId:f.runId,institutionId:f.institutionId,limit:10});
      expect(result.takedownHolds).toEqual({"hamilton.limit_guard":1});
      expect(result.insertedFees).toBe(1);
      const [row]=await tx`SELECT outlier_flags FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`;
      expect(row.outlier_flags).toContain("knox_review:taken_down");expect(row.outlier_flags).not.toContain("needs_darwin_verification");
      // Settled extract83 fingerprints remain unchanged; this is an ordinarily eligible new copy.
      const again=await extract.runKnoxExtract({db:tx,runId:f.runId,institutionId:f.institutionId,limit:10});
      expect(again.takedownHolds).toEqual({});expect(again.insertedFees).toBe(0);
    });
  });
  it.each([false,true])("re-read caller reports actual learned hold, legacy witness missing=%s",async legacy=>{
    await rollback(async tx=>{
      const f=await seed(tx,{feeName:"Online Bill Payment Fee",canonicalHint:"bill_pay",amount:1000,frequency:null,
        excerpt:"Online Bill Payment Fee | $1000.00",lineup:undefined});
      await confirm(tx,f);const copy=await document(tx,f,f.text);
      if(legacy)await tx`UPDATE pipeline_feedback SET evidence=evidence-'takedown_witness' WHERE fee_published_id=${f.publishedId} AND kind='takedown_confirmed'`;
      await extract.insertCandidate(tx,{runId:f.runId,row:context(copy),candidate:{...f.candidate,feeName:"Online Bill Payment"}});
      const [{fee_raw_id:fragmentId}]=await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`;
      const {LIVE_FRAGMENT_REREAD_KIND}=await import("../darwin/live-fragment-check");
      await tx`INSERT INTO pipeline_feedback(about_stage,signal,kind,reported_by,institution_id,source_document_id,fee_raw_id,
        fee_published_id,canonical_fee_key,amount,evidence,dedupe_key)
        VALUES('verify','wrong',${LIVE_FRAGMENT_REREAD_KIND},'darwin',${f.institutionId},${copy.documentId},${fragmentId},
          ${f.publishedId},'bill_pay',1000,'{"request":"reread_source_line","fee_name":"Online Bill Payment","kept_live":false}'::jsonb,${`fixture-reread-${f.rawId}`})`;
      const {consumeRereadRequests,KNOX_REREAD_FEEDBACK_FLAG}=await import("./reread-feedback");
      const result=await consumeRereadRequests(tx,{runId:f.runId,institutionId:f.institutionId,dryRun:false,live:true});
      expect(result.outcomes).toEqual(legacy?{sent_to_darwin:1}:{held_taken_down:1});
      expect(result.sentToDarwin).toEqual(legacy?[f.publishedId]:[]);
      if(legacy)expect(result.takedownLessonsUnknown).toEqual({missing_or_invalid_original_witness:1});
      const [row]=await tx`SELECT outlier_flags FROM raw_fee_observations WHERE source_document_id=${copy.documentId} AND fee_name=${f.candidate.feeName}`;
      expect(row.outlier_flags).toContain(KNOX_REREAD_FEEDBACK_FLAG);
      expect(row.outlier_flags.includes("needs_darwin_verification")).toBe(legacy);
      expect(row.outlier_flags.includes("knox_review:taken_down")).toBe(!legacy);
    });
  });
  it.each([
    ["another product",{lineup:{productName:"Beta Checking",minBalanceToAvoid:null,minOpeningDeposit:null,waiverText:null}}],
    ["unassigned product",{lineup:undefined}], ["different frequency",{frequency:"per_item"}],
    ["different category",{canonicalHint:"minimum_balance"}], ["different amount",{amount:1001}],
    ["meaningful name digits",{feeName:"Monthly Account Limit 2"}],
    ["business applicability",{excerpt:"Business accounts: Monthly Account Limit | $1,000.00"}],
  ] as const)("leaves %s for ordinary Darwin verification",async(_label,changes)=>{
    await rollback(async tx=>{
      const f=await seed(tx),index=await confirm(tx,f),c={...f.candidate,...changes} as ExtractedFeeCandidate;
      expect(prospectiveTakedownIdentity(f.institutionId,c)).not.toEqual(prospectiveTakedownIdentity(f.institutionId,f.candidate));
      const {receipt,row}=await insertCopy(tx,f,index,c);
      expect(receipt.takenDownBy).toBeNull();expect(row.outlier_flags).toContain("needs_darwin_verification");
      expect(row.outlier_flags).not.toContain("knox_review:taken_down");
    });
  });
  it("does not transfer a lesson to changed bytes under the same URL or a later artifact",async()=>{
    await rollback(async tx=>{
      const f=await seed(tx),index=await confirm(tx,f);
      const {receipt,row}=await insertCopy(tx,f,index,f.candidate,`${f.text}New condition applies.\n`);
      expect(receipt.takenDownBy).toBeNull();expect(row.outlier_flags).toContain("needs_darwin_verification");
    });
  });
  it.each(["source_check","business_schedule","missing"])("treats unsupported/legacy %s proof as unknown, without releasing old rows",async(kind)=>{
    await rollback(async tx=>{
      const f=await seed(tx);await confirm(tx,f);
      await tx`UPDATE pipeline_feedback SET check_name=${kind==="missing"?"hamilton.limit_guard":`hamilton.${kind}`},
        evidence=evidence-'takedown_witness' WHERE fee_published_id=${f.publishedId} AND kind='takedown_confirmed'`;
      const index=await lessons.loadTakedownLessons(tx,[f.institutionId]);
      expect(index.size).toBe(0);expect(Object.values(index.unknownReasons).reduce((a,b)=>a+b,0)).toBe(1);
      expect((await insertCopy(tx,f,index)).row.outlier_flags).toContain("needs_darwin_verification");
      expect((await tx`SELECT rolled_back_at FROM published_fee_records WHERE fee_published_id=${f.publishedId}`)[0].rolled_back_at).not.toBeNull();
    });
  });
  it.each(["product","amount","feedback","restored","source","candidate_source"])("defers %s drift after loading rather than holding new lineage",async(kind)=>{
    await rollback(async tx=>{
      const f=await seed(tx),index=await confirm(tx,f),copy=await document(tx,f,f.text);
      if(kind==="product")await tx`UPDATE raw_fee_observations SET product_name='Beta Checking' WHERE fee_raw_id=${f.rawId}`;
      if(kind==="amount")await tx`UPDATE verified_fee_observations SET amount=999 WHERE fee_verified_id=${f.verifiedId}`;
      if(kind==="feedback")await tx`UPDATE pipeline_feedback SET kind='takedown_cleared' WHERE fee_published_id=${f.publishedId} AND kind='takedown_confirmed'`;
      if(kind==="restored")await tx`UPDATE published_fee_records SET rolled_back_at=NULL WHERE fee_published_id=${f.publishedId}`;
      if(kind==="source")await tx`UPDATE agent_source_texts SET normalized_text=normalized_text||' changed' WHERE id=${f.textId}`;
      if(kind==="candidate_source")await tx`UPDATE agent_source_texts SET normalized_text=normalized_text||' changed' WHERE id=${copy.textId}`;
      const receipt=await extract.insertCandidateWithLearning(tx,{runId:f.runId,row:context(copy),candidate:f.candidate},index);
      expect(receipt).toMatchObject({inserted:true,takenDownBy:null,declinedReason:expect.any(String)});
      expect((await tx`SELECT outlier_flags FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`)[0].outlier_flags).toContain("needs_darwin_verification");
    });
  });
  it("retains prior raw ownership on a learned-hold insert conflict and reports no invented hold",async()=>{
    await rollback(async tx=>{
      const f=await seed(tx),index=await confirm(tx,f),copy=await document(tx,f,f.text);
      await extract.insertCandidate(tx,{runId:f.runId,row:context(copy),candidate:{...f.candidate,lineup:undefined}});
      const before=await tx`SELECT * FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`;
      const receipt=await extract.insertCandidateWithLearning(tx,{runId:f.runId,row:context(copy),candidate:f.candidate},index);
      expect(receipt).toMatchObject({inserted:false,takenDownBy:null});
      expect(await tx`SELECT * FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`).toEqual(before);
    });
  });

  async function liveSibling(tx:Db,f:Fixture,product:string|null){
    const copy=await document(tx,f,f.text);
    await extract.insertCandidate(tx,{runId:f.runId,row:context(copy),candidate:{...f.candidate,lineup:product?{...f.candidate.lineup!,productName:product}:undefined}});
    const [{fee_verified_id:id}]=await tx`INSERT INTO verified_fee_observations(fee_raw_id,institution_id,source_url,
      canonical_fee_key,verified_by_agent_event_id,fee_name,amount,frequency,fee_audience,amount_kind)
      SELECT fee_raw_id,institution_id,source_url,${f.candidate.canonicalHint},agent_event_id,fee_name,amount,frequency,fee_audience,'flat'
      FROM raw_fee_observations WHERE source_document_id=${copy.documentId} RETURNING fee_verified_id`;
    await tx`INSERT INTO published_fee_records(lineage_ref,institution_id,canonical_fee_key,fee_name,amount,frequency,fee_audience,
      amount_kind,published_by_adversarial_event_id,verified_by_agent_event_id,agent_event_id,batch_id)
      SELECT fee_verified_id,institution_id,canonical_fee_key,fee_name,amount,frequency,fee_audience,'flat',
        verified_by_agent_event_id,verified_by_agent_event_id,verified_by_agent_event_id,'live-sibling'
      FROM verified_fee_observations WHERE fee_verified_id=${id}`;
  }
  it.each(["Alpha Checking","Beta Checking",null])("only a true live twin cancels the lesson, owner=%s",async product=>{
    await rollback(async tx=>{
      const f=await seed(tx);await confirm(tx,f);await liveSibling(tx,f,product);
      const index=await lessons.loadTakedownLessons(tx,[f.institutionId]);
      expect(index.size).toBe(product==="Alpha Checking"?0:1);
      expect(index.liveTwins).toBe(product==="Alpha Checking"?1:0);
      const {receipt,row}=await insertCopy(tx,f,index);
      expect(Boolean(receipt.takenDownBy)).toBe(product!=="Alpha Checking");
      expect(row.outlier_flags.includes("needs_darwin_verification")).toBe(product==="Alpha Checking");
    });
  });
  it("rechecks a true live twin added after loading and leaves the new read for Darwin",async()=>{
    await rollback(async tx=>{
      const f=await seed(tx),index=await confirm(tx,f);await liveSibling(tx,f,"Alpha Checking");
      const {receipt,row}=await insertCopy(tx,f,index);
      expect(receipt).toMatchObject({inserted:true,takenDownBy:null,declinedReason:"lesson_state_changed"});
      expect(row.outlier_flags).toContain("needs_darwin_verification");
    });
  });
  it.each(["category","name_digits","amount","audience","frequency","variant","rate_contract","conditions","treatment"])("does not cancel the lesson using a live sibling with different %s",async field=>{
    await rollback(async tx=>{
      const f=await seed(tx);await confirm(tx,f);await liveSibling(tx,f,"Alpha Checking");
      const [live]=await tx`SELECT fp.fee_published_id,fr.fee_raw_id FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id=fp.lineage_ref JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
        WHERE fp.institution_id=${f.institutionId} AND fp.rolled_back_at IS NULL`;
      if(field==="category")await tx`UPDATE published_fee_records SET canonical_fee_key='minimum_balance' WHERE fee_published_id=${live.fee_published_id}`;
      if(field==="name_digits")await tx`UPDATE published_fee_records SET fee_name=fee_name||' 2' WHERE fee_published_id=${live.fee_published_id}`;
      if(field==="amount")await tx`UPDATE published_fee_records SET amount=999 WHERE fee_published_id=${live.fee_published_id}`;
      if(field==="audience"){
        await tx`UPDATE raw_fee_observations SET fee_audience='business',audience_evidence='Business accounts' WHERE fee_raw_id=${live.fee_raw_id}`;
        await tx`UPDATE verified_fee_observations SET fee_audience='business' WHERE fee_raw_id=${live.fee_raw_id}`;
        await tx`UPDATE published_fee_records SET fee_audience='business' WHERE fee_published_id=${live.fee_published_id}`;
      }
      if(field==="frequency")await tx`UPDATE published_fee_records SET frequency='annual' WHERE fee_published_id=${live.fee_published_id}`;
      if(field==="variant")await tx`UPDATE published_fee_records SET variant_type='tiered' WHERE fee_published_id=${live.fee_published_id}`;
      if(field==="rate_contract")await tx`UPDATE published_fee_records SET amount_kind='percent',amount=NULL,rate_percent=2,
        rate_basis='transaction',rate_min_amount=1,rate_max_amount=2000 WHERE fee_published_id=${live.fee_published_id}`;
      if(field==="conditions")await tx`UPDATE raw_fee_observations SET conditions='Different own conditions' WHERE fee_raw_id=${live.fee_raw_id}`;
      if(field==="treatment")await tx`UPDATE raw_fee_observations SET fee_treatment='unknown' WHERE fee_raw_id=${live.fee_raw_id}`;
      const index=await lessons.loadTakedownLessons(tx,[f.institutionId]);
      expect(index.size).toBe(1);expect(index.liveTwins).toBe(0);
      expect((await insertCopy(tx,f,index)).receipt.takenDownBy).toBe("hamilton.limit_guard");
    });
  });
  it.each(["missing","multiple","wrong_hash"])("never fills %s original provenance from a newer document artifact",async kind=>{
    await rollback(async tx=>{
      const f=await seed(tx);
      const latestId=(await document(tx,f,f.text)).textId;
      if(kind==="missing")await tx`UPDATE raw_fee_observations SET extraction_note=replace(extraction_note,${`Rosetta artifact #${f.textId}`},'legacy extraction') WHERE fee_raw_id=${f.rawId}`;
      if(kind==="multiple")await tx`UPDATE raw_fee_observations SET extraction_note=extraction_note||${` Rosetta artifact #${latestId}`} WHERE fee_raw_id=${f.rawId}`;
      if(kind==="wrong_hash")await tx`UPDATE raw_fee_observations SET extraction_note=replace(extraction_note,${f.hash},${"f".repeat(64)}) WHERE fee_raw_id=${f.rawId}`;
      const options={runId:f.runId,batchId:"legacy-closure",institutionId:f.institutionId,dryRun:false};
      await limits.rollBackLimitsPublishedAsFees(tx,options);
      await tx`UPDATE pipeline_feedback SET evidence=jsonb_set(evidence,'{flagged_at}',to_jsonb((now()-interval '13 hours')::text))
        WHERE fee_published_id=${f.publishedId} AND kind='takedown_pending'`;
      expect(await limits.rollBackLimitsPublishedAsFees(tx,{...options,runId:nextRunId--})).toHaveLength(1);
      const [feedback]=await tx`SELECT evidence FROM pipeline_feedback WHERE fee_published_id=${f.publishedId} AND kind='takedown_confirmed'`;
      expect(feedback.evidence.takedown_witness).toBeUndefined();
      const index=await lessons.loadTakedownLessons(tx,[f.institutionId]);
      expect(index.size).toBe(0);expect(index.unknownReasons).toEqual({missing_or_invalid_original_witness:1});
    });
  });
  it("does not release an existing confirmed raw hold or invent a second held insert",async()=>{
    await rollback(async tx=>{
      const f=await seed(tx),index=await confirm(tx,f),first=await insertCopy(tx,f,index);
      const before=await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${first.row.fee_raw_id}`;
      const receipt=await extract.insertCandidateWithLearning(tx,{runId:f.runId,row:context(first.copy),candidate:f.candidate},index);
      expect(receipt).toMatchObject({inserted:false,takenDownBy:null,declinedReason:"existing_raw_kept"});
      expect(await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${first.row.fee_raw_id}`).toEqual(before);
    });
  });
  it("rolls back a writer failure after a valid guard, then retries without a fabricated hold receipt",async()=>{
    await rollback(async tx=>{
      const f=await seed(tx),index=await confirm(tx,f),copy=await document(tx,f,f.text);
      const stop=new Error("fail after held INSERT RETURNING");
      await expect((tx as unknown as {savepoint:(work:(scope:Db)=>Promise<never>)=>Promise<never>}).savepoint(async scope=>{
        const receipt=await extract.insertCandidateWithLearning(scope,{runId:f.runId,row:context(copy),candidate:f.candidate},index);
        expect(receipt.takenDownBy).toBe("hamilton.limit_guard");
        throw stop;
      })).rejects.toBe(stop);
      expect(await tx`SELECT 1 FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`).toHaveLength(0);
      const receipt=await extract.insertCandidateWithLearning(tx,{runId:f.runId,row:context(copy),candidate:f.candidate},index);
      expect(receipt).toMatchObject({inserted:true,takenDownBy:"hamilton.limit_guard"});
    });
  });
  it("propagates a failure after the actual held INSERT instead of falling back to an ordinary write",async()=>{
    await rollback(async tx=>{
      const f=await seed(tx),index=await confirm(tx,f),copy=await document(tx,f,f.text),stop=new Error("writer failed after SQL");
      let inserts=0;
      const wrap=(scope:Db):Db=>{
        const tag=async(strings:TemplateStringsArray,...values:unknown[])=>{
          const rows=await (scope as unknown as (...args:unknown[])=>Promise<unknown>)(strings,...values);
          if(strings.join(" ").includes("INSERT INTO raw_fee_observations")){inserts++;throw stop;}
          return rows;
        };
        return Object.assign(tag,{unsafe:scope.unsafe.bind(scope),savepoint:(work:(inner:Db)=>Promise<unknown>)=>
          (scope as unknown as {savepoint:(work:(inner:Db)=>Promise<unknown>)=>Promise<unknown>}).savepoint(inner=>work(wrap(inner)))}) as unknown as Db;
      };
      await expect(extract.insertCandidateWithLearning(wrap(tx),{runId:f.runId,row:context(copy),candidate:f.candidate},index)).rejects.toBe(stop);
      expect(inserts).toBe(1);
      expect(await tx`SELECT 1 FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`).toHaveLength(0);
      expect((await extract.insertCandidateWithLearning(tx,{runId:f.runId,row:context(copy),candidate:f.candidate},index)).takenDownBy).toBe("hamilton.limit_guard");
    });
  });

  // Only these race fixtures commit, in this disposable loopback database, so two sessions
  // can see them. The entire private institution cohort and explicit run IDs are removed.
  async function cleanup(f:Fixture){
    await db.begin(async scope=>{
      const tx=scope as unknown as Db;
      await tx`DELETE FROM pipeline_feedback WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM published_fee_records WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM verified_fee_observations WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM agent_source_texts WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM source_documents WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM institution_sources WHERE id=${f.institutionId}`;
      await tx`DELETE FROM agent_run_events WHERE agent_run_id=ANY(${f.runIds}::int[])`;
      await tx`DELETE FROM agent_runs WHERE id=ANY(${f.runIds}::int[])`;
    });
  }
  it.each(["raw_product","published_lineage","feedback","original_text"])("rechecks %s committed by another session after selection",async change=>{
    let f:Fixture|undefined;const changer=await client();
    try{
      const seeded=await db.begin(async scope=>{const tx=scope as unknown as Db,fixture=await seed(tx),index=await confirm(tx,fixture),copy=await document(tx,fixture,fixture.text);return{fixture,index,copy};});
      f=seeded.fixture;const {fixture,index,copy}=seeded;
      await changer.begin(async scope=>{
        const tx=scope as unknown as Db;
        if(change==="raw_product")await tx`UPDATE raw_fee_observations SET product_name='Beta Checking' WHERE fee_raw_id=${fixture.rawId}`;
        if(change==="published_lineage"){
          const [{fee_verified_id:id}]=await tx`INSERT INTO verified_fee_observations(fee_raw_id,institution_id,canonical_fee_key,
            verified_by_agent_event_id,fee_name,amount,frequency,fee_audience,amount_kind)
            SELECT fee_raw_id,institution_id,canonical_fee_key,verified_by_agent_event_id,fee_name,amount,frequency,fee_audience,amount_kind
            FROM verified_fee_observations WHERE fee_verified_id=${fixture.verifiedId} RETURNING fee_verified_id`;
          await tx`UPDATE published_fee_records SET lineage_ref=${id} WHERE fee_published_id=${fixture.publishedId}`;
        }
        if(change==="feedback")await tx`UPDATE pipeline_feedback SET evidence=evidence||'{"reviewed_again":true}'::jsonb WHERE fee_published_id=${fixture.publishedId} AND kind='takedown_confirmed'`;
        if(change==="original_text")await tx`UPDATE agent_source_texts SET normalized_text=normalized_text||' changed' WHERE id=${fixture.textId}`;
      });
      const result=await db.begin(scope=>extract.insertCandidateWithLearning(scope as unknown as Db,{runId:fixture.runId,row:context(copy),candidate:fixture.candidate},index));
      expect(result).toMatchObject({inserted:true,takenDownBy:null,declinedReason:expect.any(String)});
      expect((await db`SELECT outlier_flags FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`)[0].outlier_flags).toContain("needs_darwin_verification");
    }finally{await changer.end();if(f)await cleanup(f);}
  });
  it.each(["publication","verified","raw","feedback","original_text","incoming_text"])("declines an actual second-session %s lock without deadlock or an invented hold",async target=>{
    let f:Fixture|undefined;
    const holder=await client();
    let release!:()=>void,locked!:()=>void,holding:Promise<unknown>|undefined;
    const canFinish=new Promise<void>(r=>{release=r;}),hasLock=new Promise<void>(r=>{locked=r;});
    try{
      const seeded=await db.begin(async scope=>{
        const tx=scope as unknown as Db,fixture=await seed(tx),index=await confirm(tx,fixture),copy=await document(tx,fixture,fixture.text);
        return {fixture,index,copy};
      });f=seeded.fixture;
      const {fixture,index,copy}=seeded;
      holding=holder.begin(async scope=>{
        const tx=scope as unknown as Db;
        if(target==="publication")await tx`SELECT fee_published_id FROM published_fee_records WHERE fee_published_id=${fixture.publishedId} FOR UPDATE`;
        if(target==="verified")await tx`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_verified_id=${fixture.verifiedId} FOR UPDATE`;
        if(target==="raw")await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId} FOR UPDATE`;
        if(target==="feedback")await tx`SELECT id FROM pipeline_feedback WHERE fee_published_id=${fixture.publishedId} AND kind='takedown_confirmed' FOR UPDATE`;
        if(target==="original_text"||target==="incoming_text")await tx`SELECT id FROM agent_source_texts WHERE id=${target==="original_text"?fixture.textId:copy.textId} FOR UPDATE`;
        locked();await canFinish;
      });
      await hasLock;
      const result=await db.begin(scope=>extract.insertCandidateWithLearning(scope as unknown as Db,{runId:fixture.runId,row:context(copy),candidate:fixture.candidate},index));
      expect(result).toMatchObject({inserted:true,takenDownBy:null,declinedReason:"lesson_contended"});
      expect((await db`SELECT outlier_flags FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`)[0].outlier_flags).toContain("needs_darwin_verification");
      release();await holding;
    }finally{release();await Promise.allSettled([holding]);await holder.end();if(f)await cleanup(f);}
  },15_000);
  it("keeps existing ownership and actual counts after a real raw insert-conflict wait",async()=>{
    let f:Fixture|undefined;
    const holder=await client(),writer=await client();
    let release!:()=>void,locked!:()=>void,started!:(pid:number)=>void,holding:Promise<unknown>|undefined,writing:Promise<unknown>|undefined;
    const canFinish=new Promise<void>(r=>{release=r;}),hasLock=new Promise<void>(r=>{locked=r;}),writerPid=new Promise<number>(r=>{started=r;});
    try{
      const seeded=await db.begin(async scope=>{const tx=scope as unknown as Db,fixture=await seed(tx),index=await confirm(tx,fixture),copy=await document(tx,fixture,fixture.text);return{fixture,index,copy};});
      f=seeded.fixture;const {fixture,index,copy}=seeded;
      holding=holder.begin(async scope=>{
        const tx=scope as unknown as Db;
        await extract.insertCandidate(tx,{runId:fixture.runId,row:context(copy),candidate:{...fixture.candidate,
          lineup:{...fixture.candidate.lineup!,productName:"Beta Checking"}}});
        const [selected]=await tx`SELECT product_name,outlier_flags FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`;
        expect(selected.product_name).toBe("Beta Checking");
        expect(Array.isArray(selected.outlier_flags)).toBe(true);
        expect(selected.outlier_flags).toContain("account_product:v73");
        locked();await canFinish;
      });
      await hasLock;
      writing=writer.begin(async scope=>{
        const tx=scope as unknown as Db;
        const [{pid}]=await tx`SELECT pg_backend_pid() AS pid`;started(Number(pid));
        return extract.insertCandidateWithLearning(tx,{runId:fixture.runId,row:context(copy),candidate:fixture.candidate},index);
      });
      const pid=await writerPid;let waiting=false;
      for(let i=0;i<200;i++){
        const [state]=await db`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
        if(state?.wait_event_type==="Lock"){waiting=true;break;}
        await new Promise(r=>setTimeout(r,10));
      }
      expect(waiting).toBe(true);release();await holding;
      expect(await writing).toMatchObject({inserted:false,takenDownBy:null,declinedReason:"existing_raw_kept"});
      const [row]=await db`SELECT product_name,outlier_flags FROM raw_fee_observations WHERE source_document_id=${copy.documentId}`;
      expect(row.product_name).toBe("Beta Checking");expect(row.outlier_flags).toContain("needs_darwin_verification");
      expect(row.outlier_flags).not.toContain("knox_review:taken_down");
    }finally{release();await Promise.allSettled([holding,writing]);await holder.end();await writer.end();if(f)await cleanup(f);}
  },15_000);
});
