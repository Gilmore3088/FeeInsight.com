import { createHash } from "node:crypto";
import { createFeeSourceFetch } from "../fee-source-fetch";
import { crawlerUserAgent } from "../crawler-identity";
import { extractHtmlDomText } from "../rosetta/html-dom";
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

/** Why one fetch failed, as a short code recorded on the fee's unknown verdict. */
function fetchFailure(error:unknown,signal:AbortSignal):string{
  if(signal.aborted)return "live_timeout_or_cancelled";
  const message=error instanceof Error?error.message:String(error);
  if(/body_cap|response_limit|text_limit/.test(message))return "live_body_cap";
  if(/url_limit/.test(message))return "live_url_unreadable";
  const code=message.match(/\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|CERT_[A-Z_]+|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\b/)?.[1];
  if(code)return `live_fetch_${code.toLowerCase()}`;
  if(/redirect/i.test(message))return "live_redirect_refused";
  return "live_fetch_failed";
}

/**
 * Fresh requests only, to the addresses the group's fees were read from (`urls`): no stored text,
 * conditional 304 reuse, guessed paths or provider search. Until 2026-11-02 this walked the bank's
 * homepage graph (six pages, 160 links, 32 KiB of graph metadata) and any cap made the whole
 * institution unknown: on Nov 1-2, 47 of 120 groups hit the page cap (38 with no schedule
 * read) and 38 dropped their whole graph at the 32 KiB metadata cap. Each fee's own page is now
 * fetched once; a page that loads is recorded with its bytes' and text's hashes and without its
 * links, and a page that fails is recorded in `failed` with its reason.
 */
export async function observeLiveAuditGroup(_group:LiveAuditGroup,options:{signal:AbortSignal;urls?:string[];fetchImpl?:typeof fetch;
  pdfText?:typeof extractPdfDocumentText;now?:()=>Date}):Promise<LiveAuditGraph>{
  const graph:LiveAuditGraph={entryUrl:null,pages:[],candidateUrls:[],complete:true,reason:null,failed:[]};
  const fail=(url:string,reason:string)=>{graph.complete=false;graph.reason??=reason;graph.failed!.push({url,reason});};
  const urls:string[]=[];
  for(const raw of options.urls??[]){try{const url=key(raw);if(!urls.includes(url))urls.push(url);}catch{graph.complete=false;graph.reason??="live_url_unreadable";}}
  graph.entryUrl=urls[0]??null;
  if(!urls.length){graph.complete=false;graph.reason??="fee_document_url_missing";return graph;}
  for(const requested of urls){
    if(graph.pages.length>=LIMITS.pages){fail(requested,"live_page_cap");continue;}
    if(options.signal.aborted){fail(requested,"live_total_budget");continue;}
    graph.candidateUrls.push(requested);
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
      if(response.status===200){
        if(pdf)text=(await auditAbortable((options.pdfText??extractPdfDocumentText)(bytes,{signal,timeoutMs:LIMITS.requestMs,maxPages:30,maxItems:100_000,maxTextChars:LIMITS.textChars}),signal)).text;
        else if(html)text=extractHtmlDomText(raw!).text; // the reader Rosetta stores HTML with
        else if(/^text\/plain\b/i.test(contentType??""))text=raw!;
        else{fail(requested,"live_type_unreadable");continue;}
      }
      if(signal.aborted)throw signal.reason;
      if(text.length>LIMITS.textChars)throw new Error("text_limit");
      text=text.replaceAll("\u0000","");
      graph.pages.push({requestedUrl:requested,finalUrl,contentHash:hash(bytes),textHash:hash(text),checkedAt:(options.now?.()??new Date()).toISOString(),
        contentType:contentType?.slice(0,500)??null,etag:response.headers.get("etag")?.slice(0,500)??null,lastModified:response.headers.get("last-modified")?.slice(0,500)??null,
        status:response.status,effectiveDate:effectiveDate(text),text,links:[]});
    }catch(error){fail(requested,fetchFailure(error,signal));}
    finally{clearTimeout(timer);}
  }
  if(graph.pages.some(p=>p.status!==200)){graph.complete=false;graph.reason??="live_http_failure";}
  try{boundedAuditJson(liveAuditGraphMetadata(graph),LIMITS.graphBytes);}
  catch{return {entryUrl:graph.entryUrl,pages:[],candidateUrls:[],complete:false,reason:"live_graph_cap",failed:urls.map(url=>({url,reason:"live_graph_cap"}))};}
  return graph;
}
