// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe,it,expect,vi } from "vitest";
import { observeLiveAuditGroup,readLiveAuditBytes } from "./live-source-observer";
import { auditHash,LIVE_SOURCE_AUDIT as LIMITS,type LiveAuditPolicy } from "./live-source-audit";
const website="https://fixture.invalid/",url=website+"consumer-fees.pdf";
const policy:LiveAuditPolicy={institutionId:1,websiteUrl:website,feeScheduleUrl:website+"old-2024.pdf",canonicalSourceUrl:null,sourceKind:"pdf",readStrategy:"pdf_text",correctionVersion:0,lockedByCorrection:false,lastSourceHash:null,lastSuccessfulSourceDocumentId:null,doNotRetry:[],rejectedSourceUrls:[]};
const group={institutionId:1,policy,policyFingerprint:auditHash(policy),feeIds:[1],sources:[]};
const plain="Consumer Fee Schedule\nOverdraft Fee $35.00 per item\nStop Payment $30.00 per item\nWire Transfer $20.00 per item";
const response=(body:BodyInit|null,type="text/html",status=200,finalUrl?:string)=>{const r=new Response(body,{status,headers:{"content-type":type,etag:"fixture-etag","last-modified":"Mon, 19 Oct 2026 10:00:00 GMT"}});if(finalUrl)Object.defineProperty(r,"url",{value:finalUrl});return r;};
const observe=(fetchImpl:typeof fetch,extra:Partial<Parameters<typeof observeLiveAuditGroup>[1]>={})=>observeLiveAuditGroup(group,{signal:new AbortController().signal,urls:[url],fetchImpl,...extra});

describe("fresh copy of each fee's own page",()=>{
  it("fetches only the fees' own addresses, once each, and keeps final URL/header/byte/text provenance",async()=>{
    const fetchImpl=vi.fn(async()=>response(plain,"text/plain",200,url));
    const graph=await observeLiveAuditGroup(group,{signal:new AbortController().signal,urls:[url,`${url}#page=2`],fetchImpl});
    expect(fetchImpl).toHaveBeenCalledTimes(1);expect(fetchImpl.mock.calls.map(c=>String((c as unknown[])[0]))).toEqual([url]);
    expect(graph).toMatchObject({entryUrl:url,complete:true,candidateUrls:[url],failed:[]});
    expect(graph.pages[0]).toMatchObject({requestedUrl:url,finalUrl:url,etag:"fixture-etag",text:plain,links:[]});
    expect(graph.pages[0].contentHash).toMatch(/^[a-f0-9]{64}$/);expect(graph.pages[0].textHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("reads HTML with the reader Rosetta stores HTML with, and stores no links",async()=>{
    const html=`<html><body><nav><a href="/x">Menu</a></nav><table><tr><td>Overdraft Fee</td><td>$35.00 per item</td></tr></table></body></html>`;
    const graph=await observe(vi.fn(async()=>response(html)));
    expect(graph.complete).toBe(true);expect(graph.pages[0].text).toMatch(/Overdraft Fee[^\n]*\$35\.00/);expect(graph.pages[0].links).toEqual([]);
  });
  it("records a redirect's final address",async()=>{
    const graph=await observe(vi.fn(async()=>response(plain,"text/plain",200,"https://www.fixture.invalid/consumer-fees.pdf")));
    expect(graph.pages[0]).toMatchObject({requestedUrl:url,finalUrl:"https://www.fixture.invalid/consumer-fees.pdf"});
  });
  it("does not turn a conditional 304 into stored text support",async()=>{
    const fetchImpl=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
      return response(null,"application/pdf",304);
    });
    const graph=await observe(fetchImpl);
    expect(graph.complete).toBe(false);expect(graph.pages[0]).toMatchObject({status:304,text:""});
  });
  it("parses ordinary PDF bytes through the actual bounded parser without a network request",async()=>{
    const pdf=await readFile(new URL("../rosetta/test-fixtures/northern-trust-fees.pdf",import.meta.url));
    const graph=await observe(vi.fn(async()=>response(pdf,"application/pdf")));
    expect(graph.complete).toBe(true);expect(graph.pages[0].text.length).toBeGreaterThan(100);expect(graph.pages[0].contentType).toBe("application/pdf");
  });
  it("passes page/item/text/time/cancel limits to conversion and bounds an ignored parser promise",async()=>{
    const controller=new AbortController(),pdfText=vi.fn(async(_bytes:Uint8Array,options?:{signal?:AbortSignal})=>{
      expect(options).toMatchObject({timeoutMs:8000,maxPages:30,maxItems:100000,maxTextChars:1000000});
      setTimeout(()=>controller.abort(),5);return new Promise<{text:string;totalPages:number}>(()=>undefined);
    });
    const graph=await observeLiveAuditGroup(group,{signal:controller.signal,urls:[url],pdfText,fetchImpl:vi.fn(async()=>response("%PDF-synthetic","application/pdf"))});
    expect(graph.complete).toBe(false);expect(graph.reason).toBe("live_timeout_or_cancelled");expect(graph.failed).toEqual([{url,reason:"live_timeout_or_cancelled"}]);
  });
  it("bounds stalled fetches and already-cancelled operations",async()=>{
    const fetchImpl=vi.fn(()=>new Promise<Response>(()=>undefined));
    const initial=await observeLiveAuditGroup(group,{signal:AbortSignal.abort(),urls:[url],fetchImpl});expect(initial.complete).toBe(false);expect(fetchImpl).not.toHaveBeenCalled();
    expect(initial.failed).toEqual([{url,reason:"live_total_budget"}]);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5);
    expect((await observeLiveAuditGroup(group,{signal:controller.signal,urls:[url],fetchImpl})).complete).toBe(false);clearTimeout(timer);
  });
  it("records why a fetch failed instead of a bare unknown",async()=>{
    const dns=await observe(vi.fn(async()=>{throw new Error("getaddrinfo ENOTFOUND fixture.invalid");}));
    expect(dns.failed).toEqual([{url,reason:"live_fetch_enotfound"}]);
    const opaque=await observe(vi.fn(async()=>response("opaque bytes","application/octet-stream")));
    expect(opaque.failed).toEqual([{url,reason:"live_type_unreadable"}]);
    const none=await observeLiveAuditGroup(group,{signal:new AbortController().signal,urls:[],fetchImpl:vi.fn()});
    expect(none).toMatchObject({complete:false,reason:"fee_document_url_missing",pages:[]});
  });
  it("stops at the page cap and names the addresses it did not fetch",async()=>{
    const urls=Array.from({length:LIMITS.pages+1},(_,i)=>`${website}fees-${i}.pdf`);
    const graph=await observeLiveAuditGroup(group,{signal:new AbortController().signal,urls,fetchImpl:vi.fn(async()=>response(plain,"text/plain"))});
    expect(graph.pages).toHaveLength(LIMITS.pages);expect(graph.failed).toEqual([{url:urls[LIMITS.pages],reason:"live_page_cap"}]);
  });
});

describe("streaming body and cancellation boundary",()=>{
  it("rejects a declared oversized body before reading/allocating it",async()=>{
    const cancel=vi.fn(),body=new ReadableStream({cancel});
    await expect(readLiveAuditBytes(new Response(body,{headers:{"content-length":String(LIMITS.responseBytes+1)}}),new AbortController().signal)).rejects.toThrow(/cap/);
    expect(cancel).toHaveBeenCalled();
  });
  it("rejects a streaming overrun before concatenation and cancels a stalled body",async()=>{
    const cancel=vi.fn();let i=0;
    const body=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(i++===0?new Uint8Array(LIMITS.responseBytes):new Uint8Array([1]));},cancel});
    await expect(readLiveAuditBytes(new Response(body),new AbortController().signal)).rejects.toThrow(/cap/);expect(cancel).toHaveBeenCalled();
    const controller=new AbortController(),stalledCancel=vi.fn(),stalled=new ReadableStream<Uint8Array>({cancel:stalledCancel});
    const pending=readLiveAuditBytes(new Response(stalled),controller.signal);controller.abort();await expect(pending).rejects.toBeDefined();expect(stalledCancel).toHaveBeenCalled();
  });
});
