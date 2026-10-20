// @vitest-environment node
import { describe,it,expect } from "vitest";
import { auditHash,boundedAuditJson,freezeLiveAuditFee,makeLiveAuditDraw,liveAuditPolicyFingerprint,liveAuditUnknown,LIVE_SOURCE_AUDIT as LIMITS,type LiveAuditCatalogRow,type LiveAuditPolicy } from "./live-source-audit";
import { compactLiveAuditArchive,validateLiveAuditComponent,summarizeLiveAudit,type LiveAuditProgress,type LiveAuditComponent } from "./live-source-audit-records";
const at="2026-10-19T12:00:00.000Z",now=new Date("2026-10-19T12:01:00.000Z");
function fixture(n=1){
  const rows=Array.from({length:n},(_,i)=>{const id=i+1;return freezeLiveAuditFee({id,fee_published_id:id,fee_verified_id:id,fee_raw_id:id,institution_id:id,source_document_id:id,
    canonical_fee_key:"overdraft",fee_name:"Overdraft Fee",amount:35,amount_kind:"flat",account_product_type:null,frequency:"per_item",conditions:null,waiver_text:null,rate_basis:null,fee_audience:"consumer"} as LiveAuditCatalogRow,
    {id,institutionId:id,url:`https://institution${id}.invalid/fees`,contentHash:"a".repeat(64),r2Key:null,status:"success",supersededById:null},null);});
  const groups=rows.map(fee=>{const policy:LiveAuditPolicy={institutionId:fee.institutionId,websiteUrl:`https://institution${fee.id}.invalid/`,feeScheduleUrl:fee.source.url,canonicalSourceUrl:fee.source.url,
    sourceKind:"pdf",readStrategy:"pdf_text",correctionVersion:0,lockedByCorrection:false,lastSourceHash:fee.source.contentHash,lastSuccessfulSourceDocumentId:fee.source.id,doNotRetry:[],rejectedSourceUrls:[]};
    return {institutionId:fee.institutionId,policy,policyFingerprint:liveAuditPolicyFingerprint(policy),feeIds:[fee.id],sources:[fee.source]};});
  const draw=makeLiveAuditDraw({day:at.slice(0,10),asOf:at,seed:"a".repeat(64),populationIds:rows.map(f=>f.id),rows,groups});
  const observations=draw.rows.map(f=>({...liveAuditUnknown(f,at,"own_current_fee_supported"),status:"supported" as const,
    requestedUrl:f.source.url,finalUrl:f.source.url,contentHash:"b".repeat(64),textHash:"c".repeat(64),graphHash:auditHash([f.id]),sourceLine:"Overdraft Fee $35 per item"}));
  const progress:LiveAuditProgress={valid:true,reason:null,cursor:groups.length,graphBytes:0,observations,chunks:Array.from({length:Math.ceil(n/LIMITS.groupsPerChunk)},(_,i)=>({id:i+2,hash:auditHash([i])})),captureRequestIds:[]};
  const summary={...summarizeLiveAudit(1,draw,progress,now),archiveState:"archived" as const};
  const archive=compactLiveAuditArchive(1,draw,progress,now,summary);
  return {draw,progress,component:{summary,archive,archiveEventId:10000} satisfies LiveAuditComponent};
}
function rehash(c:LiveAuditComponent){const a=c.archive!;const raw={...a} as Record<string,unknown>;delete raw.fingerprint;a.fingerprint=auditHash(raw);return c;}

describe("live-source retained/current component arithmetic",()=>{
  it("retains a consistent supported draw and 500 bounded outcomes without row payloads",()=>{
    for(const n of [1,500]){const {component}=fixture(n);expect(validateLiveAuditComponent(component)).not.toBeNull();
      expect(Buffer.byteLength(boundedAuditJson(component.archive,LIMITS.archiveBytes))).toBeLessThanOrEqual(LIMITS.archiveBytes);}
  });
  it("retains 500 ordered immutable origin IDs plus their manifest digest and rejects invalid origin input",()=>{
    const {draw,progress}=fixture(500);progress.chunks=Array.from({length:500},(_,i)=>({id:i+2,hash:auditHash([i])}));
    const summary={...summarizeLiveAudit(1,draw,progress,now),archiveState:"archived" as const};
    const archive=compactLiveAuditArchive(1,draw,progress,now,summary);
    expect(archive.origins).toEqual({ids:progress.chunks.map(c=>c.id),fingerprint:auditHash(progress.chunks)});
    expect(validateLiveAuditComponent({summary,archive,archiveEventId:10000})).not.toBeNull();
    for(const changed of [progress.chunks.map((c,i)=>i===1?progress.chunks[0]:c),[...progress.chunks].reverse(),progress.chunks.map((c,i)=>i===1?{...c,hash:"invalid"}:c)]){
      expect(()=>compactLiveAuditArchive(1,draw,{...progress,chunks:changed},now)).toThrow(/manifest/);
    }
  });

  it("fails the whole compact archive byte cap rather than dropping expensive outcomes",()=>{
    const {draw,progress}=fixture(500);
    progress.observations=progress.observations.map((o,i)=>({...o,status:"unknown",sourceLine:null,reason:`unknown_${i}_`+"x".repeat(85)}));
    expect(()=>compactLiveAuditArchive(1,draw,progress,now)).toThrow("live_audit_payload_limit");
    expect(progress.observations).toHaveLength(500);
  });

  it.each(["status","reason","dimensions","counts","captureIds","origin","protocol","graph"])("rejects a self-checksummed %s inconsistency",field=>{
    const {component:c}=fixture();const a=c.archive!;
    if(field==="status")a.outcomes[0][2]="m";
    if(field==="reason")a.reasonCodes[0]="positive_current_contradiction";
    if(field==="dimensions")a.outcomes[0][6]=1;
    if(field==="counts"){c.summary.supported=0;c.summary.unknown=1;c.summary.support=null;c.summary.envelope={low:0,high:1};c.summary.byReason={fixture_unknown:1};}
    if(field==="captureIds")a.captureRequestIds=[4];
    if(field==="origin")a.origins.ids.push(a.origins.ids[0]);
    if(field==="protocol")a.protocol=2 as 1;
    if(field==="graph")a.graphHashes=["not-a-hash"];
    expect(validateLiveAuditComponent(rehash(c))).toBeNull();
  });
  it("validates a positive contradiction with exact matching dimension/reason totals",()=>{
    const {draw,progress}=fixture();progress.observations[0]={...progress.observations[0],status:"mismatch",reason:"positive_current_contradiction",dimensions:["amount"]};
    const summary={...summarizeLiveAudit(1,draw,progress,now),archiveState:"archived" as const};
    const c={summary,archive:compactLiveAuditArchive(1,draw,progress,now,summary),archiveEventId:3};
    expect(validateLiveAuditComponent(c)).not.toBeNull();
    c.summary.byDimension={category:1};expect(validateLiveAuditComponent(rehash(c))).toBeNull();
  });
  it("keeps partial, no-measurement, expired and malformed-latest states honest",()=>{
    const {draw,progress}=fixture();
    const partial=summarizeLiveAudit(1,draw,{...progress,cursor:0,observations:[]},now);
    expect(partial).toMatchObject({state:"partial",supported:0,unattempted:1,support:null,envelope:{low:0,high:1}});
    expect(()=>compactLiveAuditArchive(1,draw,{...progress,observations:[]},now)).toThrow(/partial/);
    const expired=summarizeLiveAudit(1,draw,{...progress,observations:[]},new Date("2026-10-20T12:01:00Z"));
    expect(expired).toMatchObject({state:"expired",supported:0,unknown:1,support:null,envelope:null});
    const invalid=summarizeLiveAudit(1,draw,{...progress,valid:false,reason:"latest_receipt_malformed"},now);
    expect(invalid).toMatchObject({state:"unavailable",supported:0,unknown:1,attempted:0,support:null});
    expect(validateLiveAuditComponent({summary:invalid,archive:null,archiveEventId:null})).not.toBeNull();
    const empty=fixture(0);expect(empty.component.summary).toMatchObject({state:"no_measurement",support:null,envelope:null});
  });
});
