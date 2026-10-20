import { z } from "zod";
import {
  LIVE_SOURCE_AUDIT as LIMITS, LIVE_SOURCE_AUDIT_SERIES, auditHash, boundedAuditJson,
  liveAuditUnknown, type LiveAuditDraw, type LiveAuditObservation,
} from "./live-source-audit";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.iso.datetime();
const protocol = { protocol: z.literal(1), series: z.literal(LIVE_SOURCE_AUDIT_SERIES), drawId: id };
export const liveAuditObservationShape = z.object({
  feeId:id,fingerprint:hash,status:z.enum(["supported","mismatch","unknown"]),reason:z.string().min(1).max(100),
  dimensions:z.array(z.string().min(1).max(30)).max(10),observedAt:time,expiresAt:time,
  requestedUrl:z.string().max(LIMITS.urlBytes).nullable(),finalUrl:z.string().max(LIMITS.urlBytes).nullable(),
  contentHash:hash.nullable(),textHash:hash.nullable(),sourceLine:z.string().max(1000).nullable(),graphHash:hash.nullable(),
});
export const liveAuditClaimShape = z.object({ ...protocol, fromGroup:z.number().int().nonnegative(),
  throughGroup:z.number().int().nonnegative(),ownerRunId:id,ownerStepId:id,leaseUntil:time,
});
export type LiveAuditClaim = z.infer<typeof liveAuditClaimShape> & { eventId:number };
export const liveAuditChunkShape = z.object({ ...protocol, claimId:id, fromGroup:z.number().int().nonnegative(),
  nextGroup:z.number().int().nonnegative(),observations:z.array(liveAuditObservationShape).max(LIMITS.sample),
  graphBytes:z.number().int().nonnegative().max(LIMITS.graphsBytes),
  graphHashes:z.array(hash).max(LIMITS.groupsPerChunk),
  graphs:z.array(z.record(z.string(),z.unknown())).max(LIMITS.groupsPerChunk),
  captureRequestIds:z.array(id).max(LIMITS.sample),
});
export type LiveAuditChunk = z.infer<typeof liveAuditChunkShape>;
export interface LiveAuditProgress {
  valid:boolean;reason:string|null;cursor:number;graphBytes:number;
  observations:LiveAuditObservation[];chunks:Array<{id:number;hash:string}>;captureRequestIds:number[];
  observationOrigins?:Record<number,number>;
}
export interface LiveAuditSummary {
  protocol:1;series:string;drawId:number;day:string;asOf:string;componentAsOf:string;deadline:string;frameFingerprint:string;
  state:"partial"|"complete"|"expired"|"no_measurement"|"unavailable";
  reason:string|null;population:number|null;selected:number;attempted:number;supported:number;mismatch:number;unknown:number;unattempted:number;
  institutions:number;support:number|null;envelope:{low:number;high:number}|null;byReason:Record<string,number>;byDimension:Record<string,number>;
  capture:{requested:number;pending:number;captured:number;failed:number;blocked:number;oldestPendingAt:string|null};
  archiveState:"pending"|"archived"|"provenance_unavailable";
}

/** Unknown/malformed latest progress invalidates the operation; older successes cannot fill it. */
export function summarizeLiveAudit(drawId:number,draw:LiveAuditDraw,progress:LiveAuditProgress,now:Date):LiveAuditSummary {
  const expired=now.getTime()>=Date.parse(draw.deadline);
  const unavailable=draw.state!=="ready"||!progress.valid;
  const selected=draw.rows.length;
  const byId=new Map(progress.observations.map((o)=>[o.feeId,o]));
  const observations=draw.rows.flatMap((fee)=>{
    const observed=unavailable?null:byId.get(fee.id);
    if(observed)return [observed];
    return expired||unavailable?[liveAuditUnknown(fee,now.toISOString(),unavailable?(progress.reason??draw.reason??"unavailable"):"not_attempted_within_window")]:[];
  });
  const count=(status:LiveAuditObservation["status"])=>observations.filter((o)=>o.status===status).length;
  const byReason:Record<string,number>={},byDimension:Record<string,number>={};
  for(const o of observations){byReason[o.reason]=(byReason[o.reason]??0)+1;for(const dimension of o.dimensions)byDimension[dimension]=(byDimension[dimension]??0)+1;}
  const supported=unavailable?0:count("supported"),mismatch=unavailable?0:count("mismatch"),unknown=unavailable?selected:count("unknown");
  const unattempted=Math.max(0,selected-supported-mismatch-unknown);
  return {protocol:1,series:draw.series,drawId,day:draw.day,asOf:draw.asOf,componentAsOf:now.toISOString(),deadline:draw.deadline,
    frameFingerprint:draw.frameFingerprint,state:unavailable?"unavailable":selected===0?"no_measurement":expired?"expired":unattempted?"partial":"complete",
    reason:unavailable?(progress.reason??draw.reason??"unavailable"):null,population:draw.populationCount,selected,
    attempted:unavailable?0:progress.observations.length,supported,mismatch,unknown,unattempted,institutions:draw.groups.length,
    support:!unavailable&&!expired&&supported+mismatch>0?supported/(supported+mismatch):null,
    envelope:!unavailable&&!expired&&selected>0?{low:supported/selected,high:(supported+unknown+unattempted)/selected}:null,
    byReason,byDimension,capture:{requested:progress.captureRequestIds.length,pending:progress.captureRequestIds.length,captured:0,failed:0,blocked:0,oldestPendingAt:null},archiveState:"pending"};
}

/** Immutable compact evidence; full bodies/graphs beyond normal retention are not claimed retained. */
export interface LiveAuditArchive {
  protocol:1;series:string;drawId:number;summary:LiveAuditSummary;
  reasonCodes:string[];
  outcomes:Array<[number,string,"s"|"m"|"u",number,number,string,number]>;
  origins:{ids:number[];fingerprint:string};graphHashes:string[];captureRequestIds:number[];
  fingerprint:string;
}
export function compactLiveAuditArchive(drawId:number,draw:LiveAuditDraw,progress:LiveAuditProgress,now:Date,override?:LiveAuditSummary):LiveAuditArchive {
  const summary=override??summarizeLiveAudit(drawId,draw,progress,now);
  if(summary.state==="partial")throw new Error("live_audit_final_still_partial");
  if(progress.chunks.length>LIMITS.sample||progress.chunks.length>progress.cursor||progress.chunks.length<Math.ceil(progress.cursor/LIMITS.groupsPerChunk)
    ||progress.chunks.some((c,i)=>!id.safeParse(c.id).success||c.id<=drawId||!hash.safeParse(c.hash).success||i>0&&c.id<=progress.chunks[i-1].id))throw new Error("live_audit_origin_manifest");
  const byId=new Map(progress.observations.map((o)=>[o.feeId,o]));
  const reasonCodes:string[]=[];
  const outcomes:LiveAuditArchive["outcomes"]=draw.rows.map((fee)=>{
    const o=(summary.state==="unavailable"?null:byId.get(fee.id))??liveAuditUnknown(fee,now.toISOString(),summary.state==="unavailable"?summary.reason??"unavailable":"not_attempted_within_window");
    if(!reasonCodes.includes(o.reason))reasonCodes.push(o.reason);
    return [fee.id,fee.fingerprint,o.status==="supported"?"s":o.status==="mismatch"?"m":"u",reasonCodes.indexOf(o.reason),Math.floor(Date.parse(o.observedAt)/1000),auditHash(o),
      o.dimensions.reduce((mask,key)=>mask|(1<<LIVE_AUDIT_DIMENSIONS.indexOf(key as typeof LIVE_AUDIT_DIMENSIONS[number])),0)];
  });
  const raw={protocol:1 as const,series:draw.series,drawId,summary,reasonCodes,outcomes,origins:{ids:progress.chunks.map(c=>c.id),fingerprint:auditHash(progress.chunks)},
    graphHashes:[...new Set(progress.observations.flatMap((o)=>o.graphHash?[o.graphHash]:[]))],captureRequestIds:progress.captureRequestIds};
  const archive={...raw,fingerprint:auditHash(raw)};
  boundedAuditJson(archive,LIMITS.archiveBytes);return archive;
}

export function validLiveAuditObservation(o:LiveAuditObservation,draw:LiveAuditDraw,createdAt:string):boolean {
  const fee=draw.rows.find((r)=>r.id===o.feeId);const at=Date.parse(o.observedAt),expires=Date.parse(o.expiresAt),created=Date.parse(createdAt);
  if(!fee||fee.fingerprint!==o.fingerprint||at<Date.parse(draw.asOf)||at>Date.parse(draw.deadline)||at>created+1000
    ||expires<=at||expires-at>LIMITS.windowMs)return false;
  if(o.status==="unknown")return o.dimensions.length===0;
  if(!o.contentHash||!o.textHash||!o.graphHash||!o.requestedUrl||!o.finalUrl||!o.sourceLine)return false;
  return o.status==="supported"?o.dimensions.length===0&&o.reason==="own_current_fee_supported":o.dimensions.length>0&&o.reason==="positive_current_contradiction";
}

export const liveAuditCaptureRequestShape=z.object({...protocol,chunkId:id,feeId:id,feeFingerprint:hash,institutionId:id,policyFingerprint:hash,
  identity:hash,url:z.url().max(LIMITS.urlBytes),contentHash:hash,textHash:hash,observedAt:time,expiresAt:time,
  episode:z.number().int().min(1).max(LIMITS.captureEpisodesPerWeek),previousRequestId:id.nullable()});
export type LiveAuditCaptureRequest=z.infer<typeof liveAuditCaptureRequestShape> & {eventId:number;createdAt:string};
export const liveAuditCaptureClaimShape=z.object({...protocol,requestId:id,attempt:z.number().int().min(1).max(LIMITS.captureAttempts),
  ownerRunId:id,ownerStepId:id,leaseUntil:time});
export type LiveAuditCaptureClaim=z.infer<typeof liveAuditCaptureClaimShape>&{eventId:number};
export const liveAuditCaptureDispositionShape=z.object({...protocol,requestId:id,claimId:id.nullable(),attempt:z.number().int().nonnegative().max(LIMITS.captureAttempts),
  state:z.enum(["retry","captured","failed","blocked","stale"]),reason:z.string().min(1).max(100),at:time,retryAt:time.nullable(),sourceDocumentId:id.nullable()});
export type LiveAuditCaptureDisposition=z.infer<typeof liveAuditCaptureDispositionShape>;

export interface LiveAuditComponent {summary:LiveAuditSummary;archive:LiveAuditArchive|null;archiveEventId:number|null}
export const LIVE_AUDIT_DIMENSIONS=["amount","category","frequency","conditions","waiver","name","audience","product","basis","source"] as const;
const integer=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
/** One validator for current, retained history, admin and mail. Unknown versions never inherit a percentage. */
export function validateLiveAuditComponent(raw:unknown):LiveAuditComponent|null{
  try{
    boundedAuditJson(raw,LIMITS.archiveBytes+8192);
    if(!raw||typeof raw!=="object")return null;
    const c=raw as LiveAuditComponent,s=c.summary;
    if(!s||s.protocol!==1||s.series!==LIVE_SOURCE_AUDIT_SERIES||!id.safeParse(s.drawId).success||!time.safeParse(s.asOf).success
      ||!time.safeParse(s.componentAsOf).success||!time.safeParse(s.deadline).success||!hash.safeParse(s.frameFingerprint).success
      ||!/^\d{4}-\d{2}-\d{2}$/.test(s.day)||!["partial","complete","expired","no_measurement","unavailable"].includes(s.state))return null;
    if(![s.selected,s.attempted,s.supported,s.mismatch,s.unknown,s.unattempted,s.institutions,...Object.values(s.byReason),...Object.values(s.byDimension),
      s.capture.requested,s.capture.pending,s.capture.captured,s.capture.failed,s.capture.blocked].every(integer))return null;
    if(s.selected>LIMITS.sample||s.attempted>s.selected||s.supported+s.mismatch+s.unknown+s.unattempted!==s.selected||s.institutions>s.selected
      ||s.capture.pending+s.capture.captured+s.capture.failed+s.capture.blocked!==s.capture.requested)return null;
    if(s.population!==null&&(!integer(s.population)||s.population<s.selected)||s.attempted<s.supported+s.mismatch
      ||Object.values(s.byReason).reduce((n,v)=>n+v,0)!==s.selected-s.unattempted
      ||Object.values(s.byDimension).some(v=>v>s.mismatch)
      ||(s.byReason.own_current_fee_supported??0)!==s.supported||(s.byReason.positive_current_contradiction??0)!==s.mismatch
      ||(s.capture.pending===0?s.capture.oldestPendingAt!==null:!time.safeParse(s.capture.oldestPendingAt).success))return null;
    if(Date.parse(s.deadline)-Date.parse(s.asOf)!==LIMITS.windowMs||s.day!==s.asOf.slice(0,10)||Date.parse(s.componentAsOf)<Date.parse(s.asOf))return null;
    const support=s.supported+s.mismatch?s.supported/(s.supported+s.mismatch):null;
    if(s.state==="unavailable"&&(s.supported||s.mismatch||s.support!==null||s.envelope!==null))return null;
    if(!["unavailable","expired"].includes(s.state)&&s.support!==support)return null;
    if(s.state==="expired"&&(s.support!==null||s.envelope!==null))return null;
    if(s.state==="no_measurement"&&(s.selected!==0||s.support!==null||s.envelope!==null))return null;
    if(!["unavailable","expired"].includes(s.state)&&s.selected&&(s.envelope?.low!==s.supported/s.selected||s.envelope?.high!==(s.supported+s.unknown+s.unattempted)/s.selected))return null;
    if(s.state==="complete"&&s.unattempted!==0||s.state==="partial"&&s.unattempted===0)return null;
    if(!["pending","archived","provenance_unavailable"].includes(s.archiveState)||s.archiveState==="archived"&&!c.archive
      ||c.archive&&s.archiveState!=="archived"||s.archiveState==="provenance_unavailable"&&s.state!=="unavailable")return null;
    if(c.archive){
      const {fingerprint,...body}=c.archive;
      if(!hash.safeParse(fingerprint).success||auditHash(body)!==fingerprint||c.archive.drawId!==s.drawId||auditHash(c.archive.summary)!==auditHash(s)
        ||c.archive.series!==s.series||!Array.isArray(c.archive.outcomes)||c.archive.outcomes.length!==s.selected
        ||new Set(c.archive.outcomes.map(o=>o[0])).size!==s.selected)return null;
      const a=c.archive;
      if(a.protocol!==1||!Array.isArray(a.reasonCodes)||a.reasonCodes.length>LIMITS.sample||new Set(a.reasonCodes).size!==a.reasonCodes.length
        ||a.reasonCodes.some(r=>typeof r!=="string"||!r||r.length>100)||s.state==="partial"||s.unattempted!==0)return null;
      const byReason:Record<string,number>={},byDimension:Record<string,number>={};let supported=0,mismatch=0,unknown=0;
      for(const o of a.outcomes){
        if(!Array.isArray(o)||o.length!==7||!id.safeParse(o[0]).success||!hash.safeParse(o[1]).success||!['s','m','u'].includes(o[2])
          ||!integer(o[3])||o[3]>=a.reasonCodes.length||!integer(o[4])||o[4]<Math.floor(Date.parse(s.asOf)/1000)
          ||o[4]>Math.floor(Date.parse(s.componentAsOf)/1000)||!hash.safeParse(o[5]).success||!integer(o[6])||o[6]>=(1<<LIVE_AUDIT_DIMENSIONS.length))return null;
        const reason=a.reasonCodes[o[3]];
        if(o[2]==="s"){if(reason!=="own_current_fee_supported"||o[6]!==0)return null;supported++;}
        else if(o[2]==="m"){if(reason!=="positive_current_contradiction"||o[6]===0)return null;mismatch++;}
        else{if(["own_current_fee_supported","positive_current_contradiction"].includes(reason)||o[6]!==0)return null;unknown++;}
        if(o[2]!=="u"&&o[4]>Math.floor(Date.parse(s.deadline)/1000))return null;
        byReason[reason]=(byReason[reason]??0)+1;
        LIVE_AUDIT_DIMENSIONS.forEach((dimension,index)=>{if(o[6]&(1<<index))byDimension[dimension]=(byDimension[dimension]??0)+1;});
      }
      if(supported!==s.supported||mismatch!==s.mismatch||unknown!==s.unknown||auditHash(byReason)!==auditHash(s.byReason)||auditHash(byDimension)!==auditHash(s.byDimension))return null;
      if(!a.origins||!Array.isArray(a.origins.ids)||a.origins.ids.length>LIMITS.sample||!hash.safeParse(a.origins.fingerprint).success
        ||new Set(a.origins.ids).size!==a.origins.ids.length||a.origins.ids.some((v,i)=>!id.safeParse(v).success||v<=s.drawId||i>0&&v<=a.origins.ids[i-1])
        ||s.state==="complete"&&a.origins.ids.length<Math.ceil(s.institutions/LIMITS.groupsPerChunk))return null;
      if(!Array.isArray(a.graphHashes)||a.graphHashes.length>LIMITS.sample||new Set(a.graphHashes).size!==a.graphHashes.length||a.graphHashes.some(h=>!hash.safeParse(h).success))return null;
      if(!Array.isArray(a.captureRequestIds)||a.captureRequestIds.length!==s.capture.requested||new Set(a.captureRequestIds).size!==a.captureRequestIds.length
        ||a.captureRequestIds.some(v=>!id.safeParse(v).success))return null;
      if(c.archiveEventId===null||c.archiveEventId<=Math.max(s.drawId,...a.origins.ids,...a.captureRequestIds))return null;
    }else if(c.archiveEventId!==null)return null;
    if(c.archiveEventId!==null&&!id.safeParse(c.archiveEventId).success)return null;
    return c;
  }catch{return null;}
}

export function liveAuditBrief(component:LiveAuditComponent|null):string{
  const validated=validateLiveAuditComponent(component);
  if(!validated)return "Live-source diagnostic: unavailable (no validated current series). Weekly 50-institution launch review remains separate.";
  const s=validated.summary;
  return `Live-source diagnostic ${s.day} (${s.state}): ${s.supported} supported, ${s.mismatch} positively contradicted, ${s.unknown} unknown, ${s.unattempted} unattempted of ${s.selected}; ${s.attempted} attempted. ${s.capture.pending} captures pending. Shared source validator; no missing-fee recall or launch certification. Launch measurement remains the weekly 50 whole institutions.`;
}
