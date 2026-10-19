// @vitest-environment node
/** Native production-schema constraints/FKs; loopback only, no provider/source requests. */
import postgres, { type TransactionSql } from "postgres";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL, sql as appSql } from "@/lib/data-store/connection";
import { recheckVerifiedFees, DARWIN_RECHECK_CHECK } from "./verified-recheck";
import { secondLookDedupeKey } from "../hamilton/second-look";

const url = process.env.E2E_DATABASE_URL;
if (url && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Recheck tests require disposable loopback SQL");
const db = url ? postgres(url, { ssl: "require", max: 3, prepare: false, types: { json: JSON_TEXT_PASSTHROUGH, numeric: NUMERIC_AS_NUMBER, text: TEXT_WITHOUT_NUL } }) : null;
const suite = url ? describe : describe.skip;
type Tx = TransactionSql;
type Db = Parameters<typeof recheckVerifiedFees>[0];
type State = "restore" | "reject" | "live";
type Fixture = { agentEventId:string; runId:number; stepId:number; institutionId:number; docId:number; textId:number; rawId:number; verifiedId:number; publishedId:number|null };
let runCounter = 1_000_000_000 + process.pid * 100;
const hash = (text:string) => createHash("sha256").update(text).digest("hex");
async function seed(tx:Tx,state:State):Promise<Fixture> {
  const runId=runCounter++;
  const [inst]=await tx`INSERT INTO institution_sources (institution_name,charter_type,state,state_code,website_url,fee_schedule_url,source,status) VALUES ('Recheck fixture','bank','Texas','TX','https://recheck.example/','https://recheck.example/fees','e2e','active') RETURNING id`;
  await tx`INSERT INTO agent_runs (id,agent_name,run_kind,title,status) VALUES (${runId},'darwin','state_agent','Recheck settlement fixture','running')`;
  const [step]=await tx`INSERT INTO agent_run_steps (agent_run_id,step_key,agent_name,title,status) VALUES (${runId},'classify','darwin','Recheck fixture','running') RETURNING id`;
  const [event]=await tx`INSERT INTO agent_events (agent_name,action,status) VALUES ('darwin','recheck-fixture','success') RETURNING event_id`;
  const tier=state!=="restore",name=tier?"Stop Payment":"Bill Pay",category=tier?"stop_payment":"bill_pay";
  const sourceUrl=tier?"https://recheck.example/premium-account-fees":"https://recheck.example/fees";
  const text=tier?"Premium Account\nStop Payment | $0":"Bill Pay | No Charge";
  const [doc]=await tx`INSERT INTO source_documents (institution_id,status,document_url,content_hash,content_type) VALUES (${inst.id},'success',${sourceUrl},${hash(text)},'application/pdf') RETURNING id`;
  const [source]=await tx`INSERT INTO agent_source_texts (agent_run_id,source_document_id,institution_id,source_url,document_type,status,normalized_text,text_hash,char_count) VALUES (${runId},${doc.id},${inst.id},${sourceUrl},'text_pdf','completed',${text},${hash(text)},${text.length}) RETURNING id`;
  const [raw]=await tx`INSERT INTO raw_fee_observations (institution_id,source_document_id,source_url,fee_name,amount,outlier_flags,extraction_note,agent_event_id,amount_kind,frequency,product_name) VALUES (${inst.id},${doc.id},${sourceUrl},${name},0,'["knox_review:zero"]'::jsonb,${`excerpt="${text}"`},${event.event_id},'flat','unknown','Alpha Account') RETURNING fee_raw_id`;
  const [verified]=await tx`INSERT INTO verified_fee_observations (fee_raw_id,institution_id,source_url,canonical_fee_key,fee_name,amount,review_status,outlier_flags,verified_by_agent_event_id,amount_kind,frequency) VALUES (${raw.fee_raw_id},${inst.id},${sourceUrl},${category},${name},0,${state==="restore"?"rejected":"verified"},${state==="restore"?'["darwin_recheck:conditional_zero"]':'[]'}::jsonb,${event.event_id},'flat','unknown') RETURNING fee_verified_id`;
  if(state!=="restore") await tx`INSERT INTO pipeline_attempts (institution_id,source_document_id,stage,strategy,strategy_version,input_fingerprint,outcome,yield_count,cost_microusd,agent_run_id,agent_run_step_id,detail) VALUES (${inst.id},${doc.id},'verify','verify.rules',3,${`raw:${raw.fee_raw_id}`},'ok',1,0,${runId},${step.id},'{"decision":"verified"}'::jsonb)`;
  let publishedId:number|null=null;
  if(state==="live") {
    const [pub]=await tx`INSERT INTO published_fee_records (institution_id,canonical_fee_key,fee_name,amount,lineage_ref,source_url,published_by_adversarial_event_id,verified_by_agent_event_id,agent_event_id,amount_kind,frequency) VALUES (${inst.id},${category},${name},0,${verified.fee_verified_id},${sourceUrl},${event.event_id},${event.event_id},${event.event_id},'flat','unknown') RETURNING fee_published_id`;
    publishedId=Number(pub.fee_published_id);
    await tx`INSERT INTO pipeline_feedback (dedupe_key,about_stage,about_strategy,reported_by,check_name,signal,kind,weight,fee_published_id,institution_id,agent_run_id,evidence) VALUES (${secondLookDedupeKey(DARWIN_RECHECK_CHECK,publishedId)},'publish',${DARWIN_RECHECK_CHECK},'gutenberg',${DARWIN_RECHECK_CHECK},'wrong','takedown_pending',0,${publishedId},${inst.id},${runId},jsonb_build_object('flag_run_id',${runId-1}::int,'flagged_at',NOW()-INTERVAL '13 hours','reason','darwin_recheck:tier_perk_zero'))`;
  }
  return {agentEventId:String(event.event_id),runId,stepId:Number(step.id),institutionId:Number(inst.id),docId:Number(doc.id),textId:Number(source.id),rawId:Number(raw.fee_raw_id),verifiedId:Number(verified.fee_verified_id),publishedId};
}
const check = (tx:Tx,f:Fixture) => recheckVerifiedFees(tx as unknown as Db,{runId:f.runId,stepId:f.stepId});
async function rollback(state:State,work:(tx:Tx,f:Fixture)=>Promise<void>) {
  const stop=new Error("rollback recheck fixture");
  await db!.begin(async tx=>{const f=await seed(tx,state);await work(tx,f);throw stop;}).catch(error=>{if(error!==stop)throw error;});
}
async function attemptCount(tx:Tx,f:Fixture) { return Number((await tx`SELECT count(*)::int AS n FROM pipeline_attempts WHERE agent_run_id=${f.runId} AND strategy='verify.recheck'`)[0].n); }
async function failWrite(tx:Tx,f:Fixture,table:string,condition:string,mode:"skip"|"throw"="skip") {
  const suffix=randomUUID().replaceAll("-","");
  await tx.unsafe(`CREATE FUNCTION pg_temp.f_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN ${mode==="skip"?"RETURN NULL;":"RAISE EXCEPTION 'fixture write failure';"} END IF; RETURN NEW; END $$`);
  await tx.unsafe(`CREATE TRIGGER recheck_${suffix} BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION pg_temp.f_${suffix}()`);
}
async function committed(state:State,work:(f:Fixture)=>Promise<void>) {
  const f=await db!.begin(tx=>seed(tx,state)) as unknown as Fixture;
  try { await work(f); } finally {
    await db!.begin(async tx=>{
      await tx`DELETE FROM pipeline_feedback WHERE institution_id=${f.institutionId} OR fee_published_id=${f.publishedId}`;
      await tx`DELETE FROM pipeline_attempts WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM published_fee_records WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM verified_fee_observations WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM raw_fee_observations WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM agent_source_texts WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM source_documents WHERE institution_id=${f.institutionId}`;
      await tx`DELETE FROM agent_run_events WHERE agent_run_id=${f.runId}`;
      await tx`DELETE FROM agent_run_steps WHERE agent_run_id=${f.runId}`;
      await tx`DELETE FROM agent_runs WHERE id=${f.runId}`;
      await tx`DELETE FROM institution_sources WHERE id=${f.institutionId}`;
      await tx`DELETE FROM agent_events WHERE event_id=${f.agentEventId}`;
    });
  }
}
/** Test-only interstatement seam; every scope remains a real native transaction/savepoint. */
function afterSourceSelection(tx:Tx,work:()=>Promise<void>,state={done:false}):Db {
  return new Proxy(tx,{
    apply(target,thisArg,args) {
      const query=Reflect.apply(target,thisArg,args);
      if(!state.done && Array.isArray(args[0]) && args[0].join(" ").includes("FROM agent_source_texts t JOIN source_documents")) {
        state.done=true;return Promise.resolve(query).then(async rows=>{await work();return rows;});
      }
      return query;
    },
    get(target,key) {
      if(key==="savepoint") return (work:(inner:Db)=>Promise<unknown>)=>target.savepoint(inner=>work(afterSourceSelection(inner,workHook,state)));
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    },
  }) as unknown as Db;
  function workHook(){return work();}
}
/** Injects a real SQL error at one selection boundary, preserving native rollback semantics. */
function failSelectedSql(tx:Tx,needle:string):Db {
  return new Proxy(tx,{
    apply(target,thisArg,args) {
      if(Array.isArray(args[0]) && args[0].join(" ").includes(needle)) return target.unsafe("SELECT 1/0");
      return Reflect.apply(target,thisArg,args);
    },
    get(target,key) {
      if(key==="savepoint") return (work:(inner:Db)=>Promise<unknown>)=>target.savepoint(inner=>work(failSelectedSql(inner,needle)));
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    },
  }) as unknown as Db;
}
afterAll(async()=>{await db?.end();if(url)await appSql.end();});
suite("Darwin recheck committed settlement (#2072)",()=>{
  it.each(["restore","reject"] as const)("attests ordinary %s with actual RETURNING and valid ledger/source context",async state=>{
    await rollback(state,async(tx,f)=>{
      const result=await check(tx,f);
      expect(result.execution).toMatchObject({state:"complete",selected:1,assessed:1,settled:1,unresolved:0,eventId:expect.any(Number)});
      expect(state==="restore"?result.restored:result.rejected.map(r=>r.feeVerifiedId)).toEqual([f.verifiedId]);
      expect(await attemptCount(tx,f)).toBe(1);
      const [event]=await tx`SELECT detail FROM agent_run_events WHERE id=${result.execution!.eventId!}`;
      expect(event.detail.witnesses[0]).toMatchObject({feeVerifiedId:f.verifiedId,attemptId:expect.any(Number)});
      expect((await tx`SELECT review_status FROM verified_fee_observations WHERE fee_verified_id=${f.verifiedId}`)[0].review_status).toBe(state==="restore"?"verified":"rejected");
    });
  });
  it.each(["restore","reject"] as const)("rolls back no-op %s and leaves its normal input retryable",async state=>{
    await rollback(state,async(tx,f)=>{
      await tx.savepoint(async sub=>{
        await failWrite(sub,f,"verified_fee_observations",`NEW.fee_verified_id=${f.verifiedId}`);
        const result=await check(sub,f);
        expect(result.restored).toEqual([]);expect(result.rejected).toEqual([]);
        expect(result.execution).toMatchObject({state:"partial",unresolved:1,settled:0});
        expect(await attemptCount(sub,f)).toBe(0);
        throw new Error("remove failure trigger");
      }).catch(error=>{if(error.message!=="remove failure trigger")throw error;});
      const retry=await check(tx,f);expect(retry.execution?.settled).toBe(1);expect(await attemptCount(tx,f)).toBe(1);
      const repeat=await check(tx,f);expect(repeat.execution?.selected).toBe(0);expect(await attemptCount(tx,f)).toBe(1);
    });
  });
  it("confirmation, archive, verified rejection, audit and attempt commit together",async()=>{
    await rollback("live",async(tx,f)=>{
      const result=await check(tx,f);expect(result.takenDown).toEqual([f.publishedId]);
      expect((await tx`SELECT kind FROM pipeline_feedback WHERE dedupe_key=${secondLookDedupeKey(DARWIN_RECHECK_CHECK,f.publishedId!)}`)[0].kind).toBe("takedown_confirmed");
      expect((await tx`SELECT rolled_back_at FROM published_fee_records WHERE fee_published_id=${f.publishedId}`)[0].rolled_back_at).not.toBe(null);
      expect(result.execution?.settled).toBe(1);expect(await attemptCount(tx,f)).toBe(1);
    });
  });
  it.each(["published_fee_records","pipeline_feedback","pipeline_attempts"])("rolls back a %s failure with no confirmation/attempt/teaching left",async table=>{
    await rollback("live",async(tx,f)=>{
      const condition=table==="published_fee_records"?`NEW.fee_published_id=${f.publishedId}`:table==="pipeline_feedback"?`NEW.agent_run_id=${f.runId}`:`NEW.agent_run_id=${f.runId} AND NEW.strategy='verify.recheck'`;
      await failWrite(tx,f,table,condition,table==="published_fee_records"?"throw":"skip");
      const result=await check(tx,f);expect(result.takenDown).toEqual([]);expect(result.execution).toMatchObject({state:"partial",unresolved:1,settled:0});
      expect((await tx`SELECT kind FROM pipeline_feedback WHERE dedupe_key=${secondLookDedupeKey(DARWIN_RECHECK_CHECK,f.publishedId!)}`)[0].kind).toBe("takedown_pending");
      expect((await tx`SELECT count(*)::int AS n FROM pipeline_feedback WHERE agent_run_id=${f.runId} AND kind='flag_confirmed'`)[0].n).toBe(0);
      expect(await attemptCount(tx,f)).toBe(0);
    });
  });
  it("producer witness short-write rolls back all recheck but preserves earlier ordinary work",async()=>{
    await rollback("restore",async(tx,f)=>{
      await tx`UPDATE raw_fee_observations SET conditions='earlier ordinary verification marker' WHERE fee_raw_id=${f.rawId}`;
      await failWrite(tx,f,"agent_run_events",`NEW.agent_run_id=${f.runId} AND NEW.event_type='darwin.recheck.assessed'`);
      const result=await check(tx,f);expect(result.execution).toMatchObject({state:"unavailable",eventId:null,reasonCode:"producer_witness_failed"});
      expect(result.restored).toEqual([]);expect(await attemptCount(tx,f)).toBe(0);
      expect((await tx`SELECT review_status FROM verified_fee_observations WHERE fee_verified_id=${f.verifiedId}`)[0].review_status).toBe("rejected");
      expect((await tx`SELECT conditions FROM raw_fee_observations WHERE fee_raw_id=${f.rawId}`)[0].conditions).toBe("earlier ordinary verification marker");
    });
  });
  it("missing completed source stays unresolved without a clear/restore/terminal attempt",async()=>{
    await rollback("restore",async(tx,f)=>{
      await tx`UPDATE agent_source_texts SET status='failed' WHERE id=${f.textId}`;
      const result=await check(tx,f);expect(result.execution).toMatchObject({unresolved:1,settled:0,phases:{source:"partial"}});
      expect(result.restored).toEqual([]);expect(await attemptCount(tx,f)).toBe(0);
    });
  });
  it("invalid/missing ledger context and root autocommit decline before strict writes",async()=>{
    await rollback("restore",async(tx,f)=>{
      for(const options of [{runId:f.runId},{runId:f.runId,stepId:f.stepId+999999},{runId:0,stepId:f.stepId}]) {
        const result=await recheckVerifiedFees(tx as unknown as Db,options);expect(result.execution).toMatchObject({state:"unavailable",eventId:null,reasonCode:"invalid_run_context"});
      }
      const root=await recheckVerifiedFees(db as unknown as Db,{runId:f.runId,stepId:f.stepId});expect(root.execution?.reasonCode).toBe("transaction_unavailable");
      expect(await attemptCount(tx,f)).toBe(0);
    });
  });
  it("unavailable custom client without transaction primitive is never invoked",async()=>{
    let calls=0;const custom=()=>{calls++;throw new Error("must not execute");};
    expect((await recheckVerifiedFees(custom as unknown as Db,{runId:1,stepId:1})).execution?.reasonCode).toBe("transaction_unavailable");expect(calls).toBe(0);
  });
  it("an enclosing transaction rollback removes effect, attempt, feedback and event",async()=>{
    await committed("restore",async f=>{
      let eventId:number|null=null;const stop=new Error("outer rollback");
      await db!.begin(async tx=>{const result=await check(tx,f);eventId=result.execution!.eventId;expect(result.restored).toEqual([f.verifiedId]);throw stop;}).catch(error=>{if(error!==stop)throw error;});
      expect((await db!`SELECT review_status FROM verified_fee_observations WHERE fee_verified_id=${f.verifiedId}`)[0].review_status).toBe("rejected");
      expect((await db!`SELECT count(*)::int AS n FROM agent_run_events WHERE id=${eventId}`)[0].n).toBe(0);
      expect((await db!`SELECT count(*)::int AS n FROM pipeline_attempts WHERE agent_run_id=${f.runId} AND strategy='verify.recheck'`)[0].n).toBe(0);
    });
  });
  it("committed producer witness remains recoverable when a later finish transaction fails",async()=>{
    await committed("restore",async f=>{
      const result=await db!.begin(tx=>check(tx,f));const eventId=result.execution!.eventId;
      await expect(db!.begin(async tx=>{
        await failWrite(tx,f,"agent_run_events",`NEW.agent_run_id=${f.runId} AND NEW.event_type='step.finished'`,"throw");
        await tx`INSERT INTO agent_run_events (agent_run_id,step_id,event_type,status,message,detail) VALUES (${f.runId},${f.stepId},'step.finished','completed','later finish', '{}'::jsonb)`;
      })).rejects.toThrow("fixture write failure");
      expect((await db!`SELECT review_status FROM verified_fee_observations WHERE fee_verified_id=${f.verifiedId}`)[0].review_status).toBe("verified");
      const [event]=await db!`SELECT detail FROM agent_run_events WHERE id=${eventId}`;
      expect(event.detail.execution.batchKey).toBe(result.execution!.batchKey);
      expect(event.detail.witnesses).toHaveLength(1);
    });
  });
  it.each(["raw_product","verified_lineage","source_text"])("defers actual two-connection %s drift after selection",async kind=>{
    await committed("restore",async f=>{
      await db!.begin(async tx=>{
        const guarded=afterSourceSelection(tx,async()=>{
          if(kind==="raw_product") await db!`UPDATE raw_fee_observations SET product_name='Beta Account' WHERE fee_raw_id=${f.rawId}`;
          if(kind==="source_text") await db!`UPDATE agent_source_texts SET normalized_text='Bill Pay | $99',text_hash=${hash('Bill Pay | $99')} WHERE id=${f.textId}`;
          if(kind==="verified_lineage") {
            const [raw]=await db!`INSERT INTO raw_fee_observations (institution_id,source_document_id,source_url,fee_name,amount,agent_event_id,outlier_flags)
              SELECT institution_id,source_document_id,source_url,'Replacement raw',0,agent_event_id,'[]'::jsonb FROM raw_fee_observations WHERE fee_raw_id=${f.rawId} RETURNING fee_raw_id`;
            await db!`UPDATE verified_fee_observations SET fee_raw_id=${raw.fee_raw_id} WHERE fee_verified_id=${f.verifiedId}`;
          }
        });
        const result=await recheckVerifiedFees(guarded,{runId:f.runId,stepId:f.stepId});
        expect(result.restored).toEqual([]);expect(result.execution).toMatchObject({unresolved:1,settled:0});expect(await attemptCount(tx,f)).toBe(0);
      });
    });
  });
  it("NOWAIT defers a real second-session raw lock, then ordinary stable retry succeeds",async()=>{
    await committed("restore",async f=>{
      let locked!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{locked=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
      const blocker=db!.begin(async tx=>{await tx`UPDATE raw_fee_observations SET product_name='Beta Account' WHERE fee_raw_id=${f.rawId}`;locked();await gate;});
      await ready;
      try {
        const result=await db!.begin(tx=>check(tx,f));expect(result.execution).toMatchObject({unresolved:1,settled:0});expect(result.restored).toEqual([]);
      } finally {release();await blocker;}
      const retry=await db!.begin(tx=>check(tx,f));expect(retry.restored).toEqual([f.verifiedId]);
    });
  });

  it("a first flag is a durable pending assessment, not a fee takedown",async()=>{
    await rollback("live",async(tx,f)=>{
      await tx`DELETE FROM pipeline_feedback WHERE fee_published_id=${f.publishedId}`;
      const result=await check(tx,f);expect(result.flagged).toBe(1);expect(result.takenDown).toEqual([]);expect(result.execution?.settled).toBe(1);
      expect((await tx`SELECT kind,weight FROM pipeline_feedback WHERE dedupe_key=${secondLookDedupeKey(DARWIN_RECHECK_CHECK,f.publishedId!)}`)[0]).toMatchObject({kind:"takedown_pending",weight:0});
    });
  });
  it.each(["too_recent","same_run"])("preserves the %s second-look gate",async reason=>{
    await rollback("live",async(tx,f)=>{
      await tx`UPDATE pipeline_feedback SET evidence=evidence||jsonb_build_object('flag_run_id',${reason==="same_run"?f.runId:f.runId-1}::int,'flagged_at',NOW()-make_interval(hours=>${reason==="same_run"?13:1}::int)) WHERE fee_published_id=${f.publishedId}`;
      const result=await check(tx,f);expect(result.waiting).toBe(1);expect(result.takenDown).toEqual([]);expect(await attemptCount(tx,f)).toBe(1);
    });
  });
  it("a source-grounded pass clears pending state and retains the existing teaching weights",async()=>{
    await rollback("live",async(tx,f)=>{
      await tx`UPDATE raw_fee_observations SET source_url='https://recheck.example/fees',extraction_note='excerpt="Stop Payment | No Charge"' WHERE fee_raw_id=${f.rawId}`;
      await tx`UPDATE agent_source_texts SET normalized_text='Stop Payment | No Charge',text_hash=${hash('Stop Payment | No Charge')} WHERE id=${f.textId}`;
      const result=await check(tx,f);expect(result.cleared).toBe(1);expect(result.takenDown).toEqual([]);
      expect((await tx`SELECT kind,weight FROM pipeline_feedback WHERE dedupe_key=${secondLookDedupeKey(DARWIN_RECHECK_CHECK,f.publishedId!)}`)[0]).toMatchObject({kind:"takedown_cleared",weight:1});
      expect((await tx`SELECT weight FROM pipeline_feedback WHERE fee_published_id=${f.publishedId} AND kind='flag_cleared'`)[0].weight).toBe(0);
    });
  });
  it("a due narrow-code row now failing under another reason remains pending without a new terminal attempt",async()=>{
    await rollback("live",async(tx,f)=>{
      const text='Bill Pay - FREE with E-Statements and Debit Card | $6.95 per Month';
      await tx`UPDATE raw_fee_observations SET source_url='https://recheck.example/fees',fee_name='Bill Pay',extraction_note='excerpt="Bill Pay - FREE"' WHERE fee_raw_id=${f.rawId}`;
      await tx`UPDATE verified_fee_observations SET fee_name='Bill Pay',canonical_fee_key='bill_pay' WHERE fee_verified_id=${f.verifiedId}`;
      await tx`UPDATE published_fee_records SET fee_name='Bill Pay',canonical_fee_key='bill_pay' WHERE fee_published_id=${f.publishedId}`;
      await tx`UPDATE agent_source_texts SET normalized_text=${text},text_hash=${hash(text)} WHERE id=${f.textId}`;
      await tx`INSERT INTO pipeline_attempts (institution_id,stage,strategy,strategy_version,input_fingerprint,outcome,yield_count,cost_microusd,agent_run_id,detail) VALUES (${f.institutionId},'verify','verify.recheck',5,${`verified:${f.verifiedId}`},'evidence_mismatch',0,0,${f.runId},'{}'::jsonb)`;
      const result=await check(tx,f);expect(result.secondLookOtherCode).toBe(1);expect(result.takenDown).toEqual([]);expect(await attemptCount(tx,f)).toBe(1);
      expect((await tx`SELECT kind FROM pipeline_feedback WHERE dedupe_key=${secondLookDedupeKey(DARWIN_RECHECK_CHECK,f.publishedId!)}`)[0].kind).toBe("takedown_pending");
    });
  });
  it("native primary selection failure has an unavailable phase, not a successful-empty batch",async()=>{
    await rollback("restore",async(tx,f)=>{
      await tx`CREATE TEMP VIEW verified_fee_observations AS SELECT v.* FROM public.verified_fee_observations v WHERE 1/0=0`;
      const result=await check(tx,f);expect(result.execution).toMatchObject({state:"unavailable",selected:null,eventId:expect.any(Number),phases:{primary:"unavailable"}});
      expect(result.restored).toEqual([]);expect(await attemptCount(tx,f)).toBe(0);
    });
  });
  it("successful empty selection is known zero with a persisted witness",async()=>{
    await rollback("restore",async(tx,f)=>{
      await tx`INSERT INTO pipeline_attempts (institution_id,stage,strategy,strategy_version,input_fingerprint,outcome,yield_count,cost_microusd,agent_run_id,detail) VALUES (${f.institutionId},'verify','verify.recheck',5,${`verified:${f.verifiedId}`},'ok',1,0,${f.runId},'{}'::jsonb)`;
      const result=await check(tx,f);expect(result.execution).toMatchObject({state:"complete",selected:0,assessed:0,settled:0,unresolved:0,eventId:expect.any(Number)});
    });
  });
  it("quarantine prevents a live fee settlement",async()=>{
    await rollback("live",async(tx,f)=>{
      await tx`UPDATE published_fee_records SET quarantined_at=NOW(),quarantine_reason='fixture hold' WHERE fee_published_id=${f.publishedId}`;
      const result=await check(tx,f);expect(result.execution?.unresolved).toBe(1);expect(result.takenDown).toEqual([]);expect(await attemptCount(tx,f)).toBe(0);
    });
  });

  it("an active correction is kept rather than judged from its old raw lineage",async()=>{
    await rollback("live",async(tx,f)=>{
      await tx`INSERT INTO published_fee_corrections (fee_chain_id,version,action,status,institution_id,previous_fee_published_id,fee_published_id,before_canonical_fee_key,before_fee_name,before_amount,canonical_fee_key,fee_name,amount,reason,actor_user_id,actor_name,idempotency_key,source_document_id)
        SELECT fee_published_id,1,'correct','current',institution_id,fee_published_id,fee_published_id,canonical_fee_key,fee_name,amount,canonical_fee_key,fee_name,amount,'fixture correction',1,'fixture',${randomUUID()},${f.docId} FROM published_fee_records WHERE fee_published_id=${f.publishedId}`;
      const result=await check(tx,f);expect(result.takenDown).toEqual([]);expect(result.execution?.unresolved).toBe(1);expect(await attemptCount(tx,f)).toBe(0);
    });
  });

  it("a later primary-selector SQL error discards earlier selected rows without effects",async()=>{
    await rollback("restore",async(tx,f)=>{
      const result=await recheckVerifiedFees(failSelectedSql(tx,"JOIN LATERAL"),{runId:f.runId,stepId:f.stepId,olderLive:true});
      expect(result.execution).toMatchObject({state:"unavailable",selected:null,assessed:0,settled:0,unresolved:0,phases:{primary:"unavailable"}});
      expect(result.restored).toEqual([]);expect(await attemptCount(tx,f)).toBe(0);
      expect((await tx`SELECT review_status FROM verified_fee_observations WHERE fee_verified_id=${f.verifiedId}`)[0].review_status).toBe("rejected");
    });
  });

  it.each([0,1])("keeps older-live off with explicit run modulo4=%s cadence disposition",async modulo=>{
    runCounter+=(modulo-runCounter%4+4)%4;
    await rollback("live",async(tx,f)=>{
      await tx`DELETE FROM pipeline_feedback WHERE fee_published_id=${f.publishedId}`;
      await tx`UPDATE pipeline_attempts SET strategy_version=2 WHERE agent_run_id=${f.runId} AND strategy='verify.rules'`;
      const result=await check(tx,f);expect(result.execution?.selected).toBe(0);expect(result.takenDown).toEqual([]);expect(await attemptCount(tx,f)).toBe(0);
      expect(result.execution?.phases.olderShadow).toBe(modulo===0?"reported_unknown":"cadence_skip");
      if(modulo===0) expect(result.olderLive).toMatchObject({read:1,wouldFail:{tier_perk_zero:1}}); else expect(result.olderLive).toBeUndefined();
    });
  });
  it("all-codes-off due path reports legacy would outcomes but never archives or changes attempts",async()=>{
    await rollback("live",async(tx,f)=>{
      await tx`INSERT INTO pipeline_attempts (institution_id,stage,strategy,strategy_version,input_fingerprint,outcome,yield_count,cost_microusd,agent_run_id,detail) VALUES (${f.institutionId},'verify','verify.recheck',5,${`verified:${f.verifiedId}`},'evidence_mismatch',0,0,${f.runId},'{}'::jsonb)`;
      const result=await recheckVerifiedFees(tx as unknown as Db,{runId:f.runId,stepId:f.stepId,secondLookCodes:[]});
      expect(result.execution).toMatchObject({selected:0,phases:{due:"not_run",dueShadow:"reported_unknown"}});
      expect(result.dueSecondLooks).toMatchObject({due:1,wouldConfirm:{tier_perk_zero:1}});expect(result.takenDown).toEqual([]);expect(await attemptCount(tx,f)).toBe(1);
    });
  });

  it("explicit older-live option preserves the bounded first-flag path without changing its default",async()=>{
    await rollback("live",async(tx,f)=>{
      await tx`DELETE FROM pipeline_feedback WHERE fee_published_id=${f.publishedId}`;
      await tx`UPDATE pipeline_attempts SET strategy_version=2 WHERE agent_run_id=${f.runId} AND strategy='verify.rules'`;
      const result=await recheckVerifiedFees(tx as unknown as Db,{runId:f.runId,stepId:f.stepId,olderLive:true});
      expect(result.flagged).toBe(1);expect(result.takenDown).toEqual([]);expect(result.olderLive).toBeUndefined();expect(await attemptCount(tx,f)).toBe(1);
    });
  });
  it("existing explicit full-second-look option keeps the normal confirmation gate",async()=>{
    await rollback("live",async(tx,f)=>{
      const result=await recheckVerifiedFees(tx as unknown as Db,{runId:f.runId,stepId:f.stepId,secondLooks:true});
      expect(result.takenDown).toEqual([f.publishedId]);expect(result.dueSecondLooks).toBeUndefined();
    });
  });

});
