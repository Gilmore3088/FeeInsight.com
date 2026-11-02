import type { sql } from "@/lib/data-store/connection";
import { claimLiveAuditChunk,readStoredTextChars,readStoredTexts,settleLiveAuditChunk,type LiveAuditContext } from "@/lib/data-store/live-source-audit";
import { LIVE_SOURCE_AUDIT as LIMITS,boundedAuditJson,evaluateLiveAuditFee,liveAuditFeeUrl,liveAuditFeeUrls,liveAuditUrlKey,liveAuditGraphMetadata,liveAuditUnknown,
  type LiveAuditFee,type LiveAuditGraph,type LiveAuditGroup,type LiveAuditObservation } from "./live-source-audit";
import { requestLiveSourceCaptures } from "@/lib/data-store/live-source-capture";
import { auditAbortable,observeLiveAuditGroup } from "./live-source-observer";
import { LiveAuditSqlBudgetError } from "@/lib/data-store/live-source-sql";
import { recordStepWarning } from "@/lib/agents/hamilton/step-warning";
export interface LiveAuditChunkResult {
  claimed:boolean;persisted:boolean;groups:number;reason:string|null;captureRequestIds?:number[];
  /** This chunk's verdicts by status, so the step's own receipt shows the score's inputs. */
  verdicts?:Record<LiveAuditObservation["status"],number>;
  /**
   * Fees the live page did not support although it served the same bytes as the fee's stored copy:
   * a re-fetch cannot change them (the capture asks only when bytes changed). Darwin's live re-check
   * reads the stored copy with today's rules; this count says whether a further channel is needed.
   */
  unsupportedSameBytes?:number[];
  /**
   * Fees supported by the stored reading of the very bytes the live page served (the plain reader lost
   * the line), by published id. They are also counted in `verdicts.supported`.
   */
  storedReadingSupported?:number[];
  /** The stored readings for same-bytes fees could not be read, so those fees keep their live-text verdicts. */
  storedReadingReason?:string|null;
  /** Why capture admission did not finish after the save (its budget ran out, or its COMMIT outcome is unknown). */
  captureReason?:string|null;
  /**
   * `failed`: no capture request was written. `unknown`: its COMMIT was sent and its outcome is not
   * known, so requests may exist that `captureRequestIds` does not list. Null when admission finished.
   */
  captureOutcome?:"failed"|"unknown"|null;
  /** The stored copies' text lengths could not be read, so only the 200-character shell floor applied. */
  storedTextReason?:string|null;
}

/**
 * The chunk step's receipt line. When capture admission did not finish it says so instead of giving a
 * request count, since after an unknown COMMIT the count is not known.
 */
export function liveAuditChunkSummary(result:LiveAuditChunkResult):string{
  const v=result.verdicts;
  const verdicts=v?`; ${v.supported} match the live page, ${v.mismatch} contradicted, ${v.not_found} not found on it, ${v.unknown} unknown`:"";
  const captures=result.captureOutcome?`capture admission ${result.captureOutcome}: ${result.captureReason??"no reason recorded"}`
    :`${(result.captureRequestIds??[]).length} exact-document capture requests`;
  const stored=result.storedTextReason?`; stored text lengths not read (${result.storedTextReason}), only the shell floor applied`:"";
  return `Live-source diagnostic: ${result.groups} groups attempted; ${result.persisted?"receipt persisted":"no new receipt"}${verdicts}; ${captures}${stored}.`;
}

/** Pure: the fees a re-fetch cannot help, by published id. */
export function unsupportedSameBytes(observations:LiveAuditObservation[],rows:{id:number;source:{contentHash:string|null}}[]):number[]{
  const byId=new Map(rows.map(r=>[r.id,r]));
  return observations.filter(o=>(o.status==="mismatch"||o.status==="not_found")&&o.contentHash!==null
    &&o.contentHash===byId.get(o.feeId)?.source.contentHash).map(o=>o.feeId);
}

/**
 * Pure: the fees whose live page served their stored copy's own bytes and still came out not found,
 * so the stored reading of those bytes can judge them (at most `storedTexts` documents). A script
 * shell carries no page hash (`liveAuditUnknown`), so it is never re-judged: identical shell bytes do
 * not prove the content it loads is unchanged.
 */
export function sameBytesUnjudged(observations:LiveAuditObservation[],rows:LiveAuditFee[]):{fees:LiveAuditFee[];dropped:number}{
  const byId=new Map(rows.map(r=>[r.id,r]));
  const all=observations.flatMap(o=>{const fee=byId.get(o.feeId);
    return fee&&o.contentHash!==null&&o.contentHash===fee.source.contentHash
      &&o.status==="not_found"?[fee]:[];});
  // The cap is on documents (one stored reading each), not fees.
  const documents=new Set<number>(),fees:LiveAuditFee[]=[];
  for(const fee of all){if(!documents.has(fee.source.id)){if(documents.size>=LIMITS.storedTexts)continue;documents.add(fee.source.id);}fees.push(fee);}
  return {fees,dropped:all.length-fees.length};
}

/** Pure: a stored reading judges a fee only when it was read from the very page the audit fetched. */
export function storedReadingIsFetchedPage(fee:LiveAuditFee,readingUrl:string|null):boolean{
  const fetched=liveAuditFeeUrl(fee);return fetched!==null&&liveAuditUrlKey(readingUrl)===fetched;
}

/** One finite chunk of the immutable institutional order. Never redraws or fetches in a reader. */
export async function runLiveAuditChunk(options:{db:typeof sql;context:LiveAuditContext;drawId:number;fetchImpl?:typeof fetch;
  observe?:typeof observeLiveAuditGroup;signal?:AbortSignal;now?:()=>number;workMs?:number}):Promise<LiveAuditChunkResult>{
  const lease=await claimLiveAuditChunk(options);if(!lease)return {claimed:false,persisted:false,groups:0,reason:"not_due_or_claimed"};
  const {origin,claim}=lease,draw=origin.detail!;
  const workMs=options.workMs??LIMITS.workMs,workDeadline=Date.now()+workMs,now=options.now??Date.now,startBy=now()+LIMITS.groupStartMs;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error("live_audit_work_budget")),workMs);
  const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
  let next=claim.fromGroup;
  // The stored copies' text lengths: a live page far thinner than its stored copy is a script shell.
  let storedChars=new Map<number,number>(),storedTextReason:string|null=null;
  const warn=(what:string,error:unknown)=>recordStepWarning(options.db,{runId:options.context.runId,stepId:options.context.stepId,
    check:"live-source-audit",what:`Live-source chunk ${what}`,outcome:"failed",error});
  try{
    const ids=draw.groups.slice(claim.fromGroup,claim.throughGroup).flatMap(g=>draw.rows.filter(f=>g.feeIds.includes(f.id)).map(f=>f.source.id));
    storedChars=await readStoredTextChars(options.db,ids,Date.now()+LIMITS.storedTextMs);
  }catch(error){
    // The chunk still scores, with the 200-character floor alone; the ledger shows why.
    storedTextReason=(await warn("stored text lengths (only the 200-character shell floor applied)",error)).slice(0,200);
  }
  const results=new Map<number,{observations:LiveAuditObservation[];graph:Record<string,unknown>|null;live?:{group:LiveAuditGroup;graph:LiveAuditGraph}}>();
  const cut=new Set<number>();
  try{
    await Promise.all(Array.from({length:LIMITS.workers},async()=>{
      // A group started late would be cut off by the hard budget and count as unknown; leave it
      // for the next chunk instead (the cursor stays forward-only and the tail stays unattempted).
      while(!signal.aborted&&next<claim.throughGroup&&now()<startBy){
        const index=next++,group=draw.groups[index],fees=draw.rows.filter(f=>group.feeIds.includes(f.id));
        try{
          // Each fee's own document address, fetched fresh (2026-11-02; was the homepage graph).
          const graph=await auditAbortable((options.observe??observeLiveAuditGroup)(group,{signal,urls:liveAuditFeeUrls(fees),fetchImpl:options.fetchImpl}),signal);
          const at=new Date().toISOString();
          if(controller.signal.aborted)cut.add(index);
          results.set(index,{observations:fees.map(f=>evaluateLiveAuditFee(f,group,graph,at,{chars:storedChars.get(f.source.id)??null})),graph:liveAuditGraphMetadata(graph),live:{group,graph}});
        }catch{if(controller.signal.aborted)cut.add(index);results.set(index,{observations:fees.map(f=>liveAuditUnknown(f,new Date().toISOString(),"live_observation_failed")),graph:null});}
      }
    }));
    if(next===claim.fromGroup)return {claimed:true,persisted:false,groups:0,reason:"cancelled_before_work"};
    // A bank still being read when the work budget ran out is not an observation of that bank: the
    // cursor stops before the first such group so the next chunk reads it again. Only the chunk's
    // first group is recorded as unknown when cut, so a bank that never fits cannot stall the draw.
    const firstCut=[...cut].filter(i=>i>claim.fromGroup).sort((a,b)=>a-b)[0];
    if(firstCut!==undefined){next=firstCut;for(const index of [...results.keys()])if(index>=next)results.delete(index);}
    // A page that served the stored copy's own bytes but whose plain reading lost the fee's line is
    // judged again on the stored reading of those bytes (one bounded read; on failure the live verdicts stand).
    const storedReadingSupported:number[]=[];let storedReadingReason:string|null=null;
    const {fees:unjudged,dropped}=sameBytesUnjudged([...results.values()].flatMap(r=>r.observations),draw.rows);
    if(dropped)storedReadingReason=(await warn("stored readings for same-bytes fees (over the document cap; live verdicts kept)",new Error(`${dropped} fees not re-judged`))).slice(0,200);
    if(unjudged.length){
      try{
        const unjudgedById=new Map(unjudged.map(f=>[f.id,f]));
        const texts=await readStoredTexts(options.db,unjudged.map(f=>f.source.id),Date.now()+LIMITS.storedTextMs);
        for(const result of results.values()){
          if(!result.live)continue;const {group,graph}=result.live;
          result.observations=result.observations.map(o=>{
            const fee=unjudgedById.get(o.feeId),reading=fee?texts.get(fee.source.id):undefined;
            if(!fee||!reading||!storedReadingIsFetchedPage(fee,reading.url))return o;
            const again=evaluateLiveAuditFee(fee,group,graph,o.observedAt,{chars:storedChars.get(fee.source.id)??null,text:reading.text});
            if(again.status==="supported")storedReadingSupported.push(fee.id);
            return again.status==="supported"?again:o;
          });
        }
      }catch(error){storedReadingReason=(await warn("stored readings for same-bytes fees (live verdicts kept)",error)).slice(0,200);}
    }
    let observations=[...results.entries()].sort(([a],[b])=>a-b).flatMap(([,r])=>r.observations);
    let graphs=[...results.entries()].sort(([a],[b])=>a-b).flatMap(([,r])=>r.graph?[r.graph]:[]);
    try{
      const bytes=graphs.reduce((n,g)=>n+Buffer.byteLength(boundedAuditJson(g,LIMITS.graphBytes)),0);
      if(lease.graphBytes+bytes>LIMITS.graphsBytes)throw new Error("draw_graph_cap");
      boundedAuditJson({observations,graphs},LIMITS.eventBytes-8192);
    }catch{
      // Preserve the selected cohort/cursor and expose unknown; never clip an attestation.
      const ids=new Set(observations.map(o=>o.feeId));
      observations=draw.rows.filter(f=>ids.has(f.id)).map(f=>liveAuditUnknown(f,new Date().toISOString(),"live_evidence_payload_cap"));graphs=[];
    }
    const verdicts={supported:0,mismatch:0,not_found:0,unknown:0};for(const o of observations)verdicts[o.status]++;
    const id=await settleLiveAuditChunk({db:options.db,context:options.context,origin,claim,nextGroup:next,observations,graphs,
      deadline:Math.min(workDeadline,Date.now())+LIMITS.settleMs});
    if(id===null)return {claimed:true,persisted:false,groups:next-claim.fromGroup,reason:"claim_or_identity_no_longer_current",verdicts};
    // After the save, in its own short transaction: a capture admission that runs out of its budget
    // no longer rolls the chunk back with it (it ran inside the save until Nov 2). A fee the live
    // page did not support, served from changed bytes, asks Magellan for a copy of those bytes; the
    // copy then goes through the usual read, extract, verify and publish (the re-fetch/re-read feed).
    let captureRequestIds:number[]=[],captureReason:string|null=null,captureOutcome:"failed"|"unknown"|null=null;
    try{captureRequestIds=await requestLiveSourceCaptures(options.db,options.context,origin.id,{origin},Date.now()+LIMITS.settleMs);}
    // Any failure here (its budget, a statement timeout, which arrives as a plain PostgresError) runs on
    // its own client and leaves the saved chunk saved. It is a step.warning, and the receipt never
    // gives a request count for it: after an unknown COMMIT some requests may have been written.
    catch(error){
      captureOutcome=error instanceof LiveAuditSqlBudgetError&&error.commitOutcome==="unknown"?"unknown":"failed";
      captureReason=(await warn(`capture admission ${captureOutcome}`,error)).slice(0,200);
    }
    return {claimed:true,persisted:true,groups:next-claim.fromGroup,reason:null,captureRequestIds,captureReason,captureOutcome,storedTextReason,verdicts,
      unsupportedSameBytes:unsupportedSameBytes(observations,draw.rows),
      storedReadingSupported:storedReadingSupported.filter(id=>observations.some(o=>o.feeId===id&&o.status==="supported")),storedReadingReason};
  }finally{clearTimeout(timer);}
}
