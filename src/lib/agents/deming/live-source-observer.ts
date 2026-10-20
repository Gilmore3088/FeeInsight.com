import { createHash } from "node:crypto";
import { createFeeSourceFetch } from "../fee-source-fetch";
import { crawlerUserAgent } from "../crawler-identity";
import { feeCandidates,hubPages,pageLinks,sameSite } from "../magellan/finders";
import { mainContentText } from "../magellan/find-validate";
import { extractPdfDocumentText } from "../rosetta/pdf-document-text";
import { effectiveDate } from "../hamilton/schedule-edition";
import { LIVE_SOURCE_AUDIT as LIMITS,boundedAuditJson,liveAuditGraphMetadata,type LiveAuditGroup,type LiveAuditGraph } from "./live-source-audit";

const sourceFetch=createFeeSourceFetch({timeoutMs:LIMITS.requestMs,maxBytes:LIMITS.responseBytes});
const hash=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
export async function auditAbortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted)throw signal.reason??new Error("live_audit_cancelled");
  let abort:()=>void=()=>undefined;
  const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason??new Error("live_audit_cancelled"));signal.addEventListener("abort",abort,{once:true});});
  try{return await Promise.race([work,cancelled]);}finally{signal.removeEventListener("abort",abort);}
}
/** Streaming cap before concatenation, including injected transports; cancellation never waits on an uncooperative body. */
export async function readLiveAuditBytes(response:Response,signal:AbortSignal):Promise<Uint8Array>{
  const length=response.headers.get("content-length");
  if(length&&/^\d+$/.test(length)&&Number(length)>LIMITS.responseBytes){void response.body?.cancel().catch(()=>undefined);throw new Error("live_body_cap");}
  if(!response.body)return new Uint8Array();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  const cancel=()=>{void reader.cancel().catch(()=>undefined);};signal.addEventListener("abort",cancel,{once:true});
  try{
    if(signal.aborted)throw signal.reason;
    while(true){const result=await auditAbortable(reader.read(),signal);if(signal.aborted)throw signal.reason;if(result.done)break;
      size+=result.value.byteLength;if(size>LIMITS.responseBytes)throw new Error("live_body_cap");chunks.push(result.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
  }catch(error){cancel();throw error;}finally{signal.removeEventListener("abort",cancel);reader.releaseLock();}
}
const key=(value:string)=>{const url=new URL(value);url.hash="";if(!/^https?:$/.test(url.protocol)||Buffer.byteLength(url.href)>LIMITS.urlBytes)throw new Error("live_audit_url_limit");return url.href;};

/** Fresh requests only. No stored text, conditional 304 reuse, guessed paths or provider search. */
export async function observeLiveAuditGroup(group:LiveAuditGroup,options:{signal:AbortSignal;fetchImpl?:typeof fetch;
  pdfText?:typeof extractPdfDocumentText;now?:()=>Date}):Promise<LiveAuditGraph>{
  const graph:LiveAuditGraph={entryUrl:null,pages:[],candidateUrls:[],complete:true,reason:null};
  const fail=(reason:string)=>{graph.complete=false;graph.reason??=reason;};
  let website:URL;
  try{website=new URL(key(group.policy.websiteUrl??""));graph.entryUrl=website.href;}catch{fail("official_homepage_unavailable");return graph;}
  const queue=[website.href],seen=new Set<string>();
  while(queue.length&&graph.pages.length<LIMITS.pages&&!options.signal.aborted){
    const requested=queue.shift()!;if(seen.has(requested))continue;seen.add(requested);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error("live_audit_request_timeout")),LIMITS.requestMs);
    const signal=AbortSignal.any([controller.signal,options.signal]);
    try{
      const response=await auditAbortable((options.fetchImpl??sourceFetch)(requested,{signal,headers:{"User-Agent":crawlerUserAgent("Magellan"),Accept:"text/html,application/pdf,text/plain"}}),signal);
      const bytes=await readLiveAuditBytes(response,signal);
      if(bytes.byteLength>LIMITS.responseBytes)throw new Error("response_limit");
      const finalUrl=key(response.url||requested),contentType=response.headers.get("content-type");
      const pdf=Buffer.from(bytes.subarray(0,5)).toString()==="%PDF-",raw=pdf?null:new TextDecoder().decode(bytes);
      const html=!pdf&&(/html/i.test(contentType??"")||/^\s*<!doctype html|^\s*<html\b/i.test(raw??""));
      let text="";
      if(response.status!==200)fail("live_http_failure");
      else if(pdf)text=(await auditAbortable((options.pdfText??extractPdfDocumentText)(bytes,{signal,timeoutMs:LIMITS.requestMs,maxPages:30,maxItems:100_000,maxTextChars:LIMITS.textChars}),signal)).text;
      else if(html)text=mainContentText(raw!);
      else if(/^text\/plain\b/i.test(contentType??""))text=raw!;
      else fail("live_type_unreadable");
      if(signal.aborted)throw signal.reason;
      if(text.length>LIMITS.textChars)throw new Error("text_limit");
      text=text.replaceAll("\u0000","");
      const links=html?pageLinks(raw!,new URL(finalUrl)):[];
      if(links.length>=LIMITS.links)fail("live_link_cap");
      const boundedLinks=links.map(l=>({url:key(l.url),label:l.label.slice(0,300)}));
      const page={requestedUrl:requested,finalUrl,contentHash:hash(bytes),textHash:hash(text),checkedAt:(options.now?.()??new Date()).toISOString(),
        contentType:contentType?.slice(0,500)??null,etag:response.headers.get("etag")?.slice(0,500)??null,lastModified:response.headers.get("last-modified")?.slice(0,500)??null,
        status:response.status,effectiveDate:effectiveDate(text),text,links:boundedLinks};
      graph.pages.push(page);
      if(new Set(graph.pages.flatMap(p=>p.links.map(l=>l.url))).size>LIMITS.links)fail("live_link_cap");
      // Every queued edge was actually observed from the homepage's graph. Linked off-site schedules are allowed;
      // off-site navigation hubs are not recursively treated as the bank's site.
      for(const candidate of feeCandidates(links,"homepage_link",finalUrl)){
        const url=key(candidate.url);if(!graph.candidateUrls.includes(url))graph.candidateUrls.push(url);
        if(!seen.has(url)&&!queue.includes(url))queue.push(url);
      }
      if(sameSite(new URL(finalUrl),website))for(const hub of hubPages(links,website,seen,LIMITS.links)){
        const url=key(hub.url);if(!seen.has(url)&&!queue.includes(url))queue.push(url);
      }
      if(graph.candidateUrls.length>LIMITS.links||queue.length>LIMITS.links)throw new Error("candidate_cap");
      boundedAuditJson(liveAuditGraphMetadata(graph),LIMITS.graphBytes);
    }catch{fail(signal.aborted?"live_timeout_or_cancelled":"live_fetch_parse_or_cap");}
    finally{clearTimeout(timer);}
  }
  if(queue.some(url=>!seen.has(url)))fail(options.signal.aborted?"live_total_budget":"live_page_cap");
  if(options.signal.aborted)fail("live_total_budget");
  try{boundedAuditJson(liveAuditGraphMetadata(graph),LIMITS.graphBytes);}catch{return {entryUrl:graph.entryUrl,pages:[],candidateUrls:[],complete:false,reason:"live_graph_cap"};}
  return graph;
}
