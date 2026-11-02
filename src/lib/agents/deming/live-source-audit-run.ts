import type { sql } from "@/lib/data-store/connection";
import { claimLiveAuditChunk,settleLiveAuditChunk,type LiveAuditContext } from "@/lib/data-store/live-source-audit";
import { LIVE_SOURCE_AUDIT as LIMITS,boundedAuditJson,evaluateLiveAuditFee,liveAuditFeeUrls,liveAuditGraphMetadata,liveAuditUnknown,type LiveAuditObservation } from "./live-source-audit";
import { requestLiveSourceCaptures } from "@/lib/data-store/live-source-capture";
import { LiveAuditSqlBudgetError } from "@/lib/data-store/live-source-sql";
import { auditAbortable,observeLiveAuditGroup } from "./live-source-observer";
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
}

/** Pure: the fees a re-fetch cannot help, by published id. */
export function unsupportedSameBytes(observations:LiveAuditObservation[],rows:{id:number;source:{contentHash:string|null}}[]):number[]{
  const byId=new Map(rows.map(r=>[r.id,r]));
  return observations.filter(o=>(o.status==="mismatch"||o.status==="not_found")&&o.contentHash!==null
    &&o.contentHash===byId.get(o.feeId)?.source.contentHash).map(o=>o.feeId);
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
  const results=new Map<number,{observations:LiveAuditObservation[];graph:Record<string,unknown>|null}>();
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
          results.set(index,{observations:fees.map(f=>evaluateLiveAuditFee(f,group,graph,at)),graph:liveAuditGraphMetadata(graph)});
        }catch{if(controller.signal.aborted)cut.add(index);results.set(index,{observations:fees.map(f=>liveAuditUnknown(f,new Date().toISOString(),"live_observation_failed")),graph:null});}
      }
    }));
    if(next===claim.fromGroup)return {claimed:true,persisted:false,groups:0,reason:"cancelled_before_work"};
    // A bank still being read when the work budget ran out is not an observation of that bank: the
    // cursor stops before the first such group so the next chunk reads it again. Only the chunk's
    // first group is recorded as unknown when cut, so a bank that never fits cannot stall the draw.
    const firstCut=[...cut].filter(i=>i>claim.fromGroup).sort((a,b)=>a-b)[0];
    if(firstCut!==undefined){next=firstCut;for(const index of [...results.keys()])if(index>=next)results.delete(index);}
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
    let captureRequestIds:number[]=[];
    try{captureRequestIds=await requestLiveSourceCaptures(options.db,options.context,origin.id,{origin},Date.now()+LIMITS.settleMs);}
    catch(error){if(!(error instanceof LiveAuditSqlBudgetError))throw error;}
    return {claimed:true,persisted:true,groups:next-claim.fromGroup,reason:null,captureRequestIds,verdicts,
      unsupportedSameBytes:unsupportedSameBytes(observations,draw.rows)};
  }finally{clearTimeout(timer);}
}
