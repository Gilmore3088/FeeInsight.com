// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe,it,expect,vi } from "vitest";
import { observeLiveAuditGroup,readLiveAuditBytes } from "./live-source-observer";
import { auditHash,LIVE_SOURCE_AUDIT as LIMITS,type LiveAuditPolicy } from "./live-source-audit";
const website="https://fixture.invalid/",url=website+"consumer-fees.pdf";
const policy:LiveAuditPolicy={institutionId:1,websiteUrl:website,feeScheduleUrl:website+"old-2024.pdf",canonicalSourceUrl:null,sourceKind:"pdf",readStrategy:"pdf_text",correctionVersion:0,lockedByCorrection:false,lastSourceHash:null,lastSuccessfulSourceDocumentId:null,doNotRetry:[],rejectedSourceUrls:[]};
const group={institutionId:1,policy,policyFingerprint:auditHash(policy),feeIds:[1],sources:[]};
const home='<html><main><a href="/consumer-fees.pdf">Consumer Fee Schedule</a></main></html>';
const plain="Consumer Fee Schedule\nOverdraft Fee $35.00 per item\nStop Payment $30.00 per item\nWire Transfer $20.00 per item";
const response=(body:BodyInit|null,type="text/html",status=200,finalUrl?:string)=>{const r=new Response(body,{status,headers:{"content-type":type,etag:"fixture-etag","last-modified":"Mon, 19 Oct 2026 10:00:00 GMT"}});if(finalUrl)Object.defineProperty(r,"url",{value:finalUrl});return r;};

describe("bounded fresh official-source observer",()=>{
  it("follows only actual homepage edges and preserves final URL/header/byte/text provenance",async()=>{
    const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>String(input)===website?response(home):response(plain,"text/plain",200,url));
    const graph=await observeLiveAuditGroup(group,{signal:new AbortController().signal,fetchImpl});
    expect(graph).toMatchObject({entryUrl:website,complete:true,candidateUrls:[url]});expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(c=>String(c[0]))).not.toContain(policy.feeScheduleUrl);
    expect(graph.pages[1]).toMatchObject({requestedUrl:url,finalUrl:url,etag:"fixture-etag",text:plain});
    expect(graph.pages[1].contentHash).toMatch(/^[a-f0-9]{64}$/);expect(graph.pages[1].textHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("keeps the frozen homepage identity through a legitimate redirect",async()=>{
    const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>String(input)===website?response(home,"text/html",200,"https://www.fixture.invalid/"):response(plain,"text/plain"));
    const graph=await observeLiveAuditGroup(group,{signal:new AbortController().signal,fetchImpl});
    expect(graph.entryUrl).toBe(website);expect(graph.pages[0].finalUrl).toBe("https://www.fixture.invalid/");
    expect(graph.candidateUrls).toContain("https://www.fixture.invalid/consumer-fees.pdf");
  });
  it("does not turn a conditional 304 into stored text support",async()=>{
    const fetchImpl=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
      return String(input)===website?response(home):response(null,"application/pdf",304);
    });
    const graph=await observeLiveAuditGroup(group,{signal:new AbortController().signal,fetchImpl});
    expect(graph.complete).toBe(false);expect(graph.pages.at(-1)?.text).toBe("");
  });
  it("parses ordinary PDF bytes through the actual bounded parser without a network request",async()=>{
    const pdf=await readFile(new URL("../rosetta/test-fixtures/northern-trust-fees.pdf",import.meta.url));
    const graph=await observeLiveAuditGroup(group,{signal:new AbortController().signal,
      fetchImpl:vi.fn(async(input:RequestInfo|URL)=>String(input)===website?response(home):response(pdf,"application/pdf"))});
    expect(graph.complete).toBe(true);expect(graph.pages[1].text.length).toBeGreaterThan(100);expect(graph.pages[1].contentType).toBe("application/pdf");
  });
  it("passes page/item/text/time/cancel limits to conversion and bounds an ignored parser promise",async()=>{
    const controller=new AbortController(),pdfText=vi.fn(async(_bytes:Uint8Array,options?:{signal?:AbortSignal})=>{
      expect(options).toMatchObject({timeoutMs:8000,maxPages:30,maxItems:100000,maxTextChars:1000000});
      setTimeout(()=>controller.abort(),5);return new Promise<{text:string;totalPages:number}>(()=>undefined);
    });
    const graph=await observeLiveAuditGroup(group,{signal:controller.signal,pdfText,
      fetchImpl:vi.fn(async(input:RequestInfo|URL)=>String(input)===website?response(home):response("%PDF-synthetic","application/pdf"))});
    expect(graph.complete).toBe(false);expect(graph.reason).toBe("live_timeout_or_cancelled");
  });
  it("bounds stalled fetches and already-cancelled operations",async()=>{
    const fetchImpl=vi.fn(()=>new Promise<Response>(()=>undefined));
    const initial=await observeLiveAuditGroup(group,{signal:AbortSignal.abort(),fetchImpl});expect(initial.complete).toBe(false);expect(fetchImpl).not.toHaveBeenCalled();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5);
    expect((await observeLiveAuditGroup(group,{signal:controller.signal,fetchImpl})).complete).toBe(false);clearTimeout(timer);
  });
  it("marks truncated graph discovery and opaque candidates unknown",async()=>{
    const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>String(input)===website?response(home):response("opaque bytes","application/octet-stream"));
    expect((await observeLiveAuditGroup(group,{signal:new AbortController().signal,fetchImpl})).complete).toBe(false);
    const links=Array.from({length:161},(_,i)=>`<a href="/fee-schedule-${i}.pdf">Consumer Fee Schedule ${i}</a>`).join("");
    const graph=await observeLiveAuditGroup(group,{signal:new AbortController().signal,fetchImpl:vi.fn(async()=>response(`<main>${links}</main>`))});
    expect(graph.complete).toBe(false);expect(graph.reason).toMatch(/cap/);
  });
  it("counts distinct links over the whole institution graph and caps actual metadata JSON",async()=>{
    const links=(offset:number)=>Array.from({length:90},(_,i)=>`<a href="/consumer-fees-${i+offset}.pdf">Consumer Fee Schedule ${i+offset}</a>`).join("");
    const graph=await observeLiveAuditGroup(group,{signal:new AbortController().signal,fetchImpl:vi.fn(async(input:RequestInfo|URL)=>response(`<main>${links(String(input)===website?0:90)}</main>`))});
    expect(graph.complete).toBe(false);expect(graph.reason).toMatch(/cap|limit/);
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
