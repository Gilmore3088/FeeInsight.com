import { createHash } from "node:crypto";
import type { sql } from "@/lib/data-store/connection";
import { claimLiveSourceCapture,settleLiveSourceCapture } from "@/lib/data-store/live-source-capture";
import type { LiveAuditContext } from "@/lib/data-store/live-source-audit";
import { getDocumentVault,type DocumentVault,isVaultKey } from "../document-vault";
import { createFeeSourceFetch,FeeSourceFetchError } from "../fee-source-fetch";
import { crawlerUserAgent } from "../crawler-identity";
import { auditAbortable,readLiveAuditBytes } from "../deming/live-source-observer";
import { LIVE_SOURCE_AUDIT as LIMITS } from "../deming/live-source-audit";
const fetchSource=createFeeSourceFetch({timeoutMs:LIMITS.requestMs,maxBytes:LIMITS.responseBytes});

/** Magellan's consumed diagnostic side-copy path. No profile, key, current-copy or fee mutation. */
export async function runLiveSourceCapture(options:{db:typeof sql;context:LiveAuditContext;requestId:number;
  fetchImpl?:typeof fetch;vault?:DocumentVault;signal?:AbortSignal}):Promise<{claimed:boolean;persisted:boolean;reason:string}>{
  const lease=await claimLiveSourceCapture(options.db,options.context,options.requestId);
  if(!lease)return {claimed:false,persisted:false,reason:"not_due_or_claimed"};
  const {request,claim}=lease;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error("live_capture_budget")),Math.min(LIMITS.workMs,Math.max(1,Date.parse(claim.leaseUntil)-Date.now()-LIMITS.settleMs)));
  const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
  let outcome:Parameters<typeof settleLiveSourceCapture>[4]={state:"retry",reason:"capture_transport_or_storage_failure"};
  try{
    const vault=options.vault??getDocumentVault();
    if(!lease.originCurrent)outcome={state:"stale",reason:"capture_origin_identity_changed"};
    else if(!vault.configured)outcome={state:"blocked",reason:"capture_vault_not_configured"};
    else{
      const http=new AbortController(),httpTimer=setTimeout(()=>http.abort(new Error("live_capture_http_budget")),LIMITS.requestMs);
      let response:Response,bytes:Uint8Array;
      try{
        const httpSignal=AbortSignal.any([signal,http.signal]);
        response=await auditAbortable((options.fetchImpl??fetchSource)(request.url,{signal:httpSignal,headers:{"User-Agent":crawlerUserAgent("Magellan"),Accept:"text/html,application/pdf,text/plain"}}),httpSignal);
        bytes=await readLiveAuditBytes(response,httpSignal);
      }finally{clearTimeout(httpTimer);}
      if(response.status!==200)outcome={state:response.status>=500||response.status===429?"retry":"stale",reason:"capture_http_failure"};
      else if(bytes.length>LIMITS.responseBytes)outcome={state:"blocked",reason:"capture_byte_cap"};
      else if((response.url||request.url)!==request.url||createHash("sha256").update(bytes).digest("hex")!==request.contentHash)outcome={state:"stale",reason:"capture_observed_edition_changed"};
      else{
        const contentType=response.headers.get("content-type")?.slice(0,500)??null;
        if(!/pdf|html|^text\/plain\b/i.test(contentType??"")&&Buffer.from(bytes.subarray(0,5)).toString()!=="%PDF-")outcome={state:"blocked",reason:"capture_type_unreadable"};
        else{
          const storage=new AbortController(),storageTimer=setTimeout(()=>storage.abort(new Error("live_capture_storage_budget")),20_000);
          try{
            const storageSignal=AbortSignal.any([signal,storage.signal]);
            const receipt=await auditAbortable(vault.store(bytes,request.contentHash,contentType,{signal:storageSignal}),storageSignal);
            if((receipt.status==="stored"||receipt.status==="already_stored")&&isVaultKey(receipt.key)&&receipt.key===`${request.contentHash.slice(0,2)}/${request.contentHash}`)outcome={state:"captured",reason:"exact_observed_bytes_stored",document:{
              key:receipt.key,contentType,byteSize:bytes.byteLength,etag:response.headers.get("etag")?.slice(0,500)??null,lastModified:response.headers.get("last-modified")?.slice(0,500)??null}};
          }finally{clearTimeout(storageTimer);}
        }
      }
    }
  }catch(error){if(error instanceof FeeSourceFetchError&&!/timeout|network|dns_lookup_failed/i.test(error.code))outcome={state:"blocked",reason:"capture_destination_or_response_policy"};}
  finally{clearTimeout(timer);}
  const persisted=await settleLiveSourceCapture(options.db,options.context,request,claim,outcome);
  return {claimed:true,persisted,reason:outcome.reason};
}
