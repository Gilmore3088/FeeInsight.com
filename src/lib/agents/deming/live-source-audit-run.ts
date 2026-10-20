import type { sql } from "@/lib/data-store/connection";
import { claimLiveAuditChunk,settleLiveAuditChunk,type LiveAuditContext } from "@/lib/data-store/live-source-audit";
import { LIVE_SOURCE_AUDIT as LIMITS,boundedAuditJson,evaluateLiveAuditFee,liveAuditGraphMetadata,liveAuditUnknown,type LiveAuditObservation } from "./live-source-audit";
import { requestLiveSourceCaptures } from "@/lib/data-store/live-source-capture";
import { auditAbortable,observeLiveAuditGroup } from "./live-source-observer";

/** One finite chunk of the immutable institutional order. Never redraws or fetches in a reader. */
export async function runLiveAuditChunk(options:{db:typeof sql;context:LiveAuditContext;drawId:number;fetchImpl?:typeof fetch;
  observe?:typeof observeLiveAuditGroup;signal?:AbortSignal}):Promise<{claimed:boolean;persisted:boolean;groups:number;reason:string|null;captureRequestIds?:number[]}>{
  const lease=await claimLiveAuditChunk(options);if(!lease)return {claimed:false,persisted:false,groups:0,reason:"not_due_or_claimed"};
  const {origin,claim}=lease,draw=origin.detail!;
  const workDeadline=Date.now()+LIMITS.workMs;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error("live_audit_work_budget")),LIMITS.workMs);
  const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
  let next=claim.fromGroup;
  const results=new Map<number,{observations:LiveAuditObservation[];graph:Record<string,unknown>|null}>();
  try{
    await Promise.all(Array.from({length:LIMITS.workers},async()=>{
      while(!signal.aborted&&next<claim.throughGroup){
        const index=next++,group=draw.groups[index],fees=draw.rows.filter(f=>group.feeIds.includes(f.id));
        try{
          const graph=await auditAbortable((options.observe??observeLiveAuditGroup)(group,{signal,fetchImpl:options.fetchImpl}),signal);
          const at=new Date().toISOString();
          results.set(index,{observations:fees.map(f=>evaluateLiveAuditFee(f,group,graph,at)),graph:liveAuditGraphMetadata(graph)});
        }catch{results.set(index,{observations:fees.map(f=>liveAuditUnknown(f,new Date().toISOString(),"live_observation_failed")),graph:null});}
      }
    }));
    if(next===claim.fromGroup)return {claimed:true,persisted:false,groups:0,reason:"cancelled_before_work"};
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
    let captureRequestIds:number[]=[];
    const id=await settleLiveAuditChunk({db:options.db,context:options.context,origin,claim,nextGroup:next,observations,graphs,
      deadline:Math.min(workDeadline,Date.now())+LIMITS.settleMs,
      afterInsert:async tx=>{captureRequestIds=await requestLiveSourceCaptures(tx,options.context,origin.id);}});
    return {claimed:true,persisted:id!==null,groups:next-claim.fromGroup,reason:id?null:"claim_or_identity_no_longer_current",captureRequestIds};
  }finally{clearTimeout(timer);}
}
