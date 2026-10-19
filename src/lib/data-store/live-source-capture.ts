import { sql } from "./connection";
import { LIVE_SOURCE_AUDIT as LIMITS,LIVE_SOURCE_AUDIT_SERIES,LIVE_AUDIT_EVENTS as EVENTS,LIVE_AUDIT_STEPS as STEPS,
  auditHash,boundedAuditJson,positiveId } from "@/lib/agents/deming/live-source-audit";
import { liveAuditCaptureRequestShape,liveAuditCaptureClaimShape,liveAuditCaptureDispositionShape,
  type LiveAuditCaptureRequest,type LiveAuditCaptureClaim,type LiveAuditCaptureDisposition } from "@/lib/agents/deming/live-source-audit-records";
import { appendLiveAuditEvent,currentLiveAuditMatches,liveAuditDrawById,liveAuditTransaction,lockLiveAudit,readLiveAuditProgress,
  type LiveAuditContext } from "./live-source-audit";
type DB=typeof sql;
type Row=Record<string,unknown>;
const iso=(v:unknown)=>v instanceof Date?v.toISOString():String(v);
const terminal=(state:string)=>["captured","failed","blocked","stale"].includes(state);

export async function readLiveCaptureRequest(db:DB,id:number):Promise<LiveAuditCaptureRequest|null>{
  if(!positiveId(id))return null;
  const [row]=await db<Row[]>`SELECT e.id,e.created_at,CASE WHEN octet_length(e.detail::text)<=8192 THEN e.detail ELSE NULL END AS detail
    FROM agent_run_events e JOIN agent_run_steps s ON s.id=e.step_id AND s.agent_run_id=e.agent_run_id
    JOIN agent_runs r ON r.id=e.agent_run_id WHERE e.id=${id} AND e.event_type=${EVENTS.capture}
      AND s.step_key=${STEPS.observe} AND s.agent_name='atlas' AND r.agent_name='atlas' AND r.run_kind='workflow'
      AND r.params_json->>'source'='deming.live_source_audit'`;
  const parsed=liveAuditCaptureRequestShape.safeParse(row?.detail);
  return parsed.success?{...parsed.data,eventId:id,createdAt:iso(row.created_at)}:null;
}
/** Newest receipt is a tombstone when malformed or not bound to a real producer/claim. */
export async function readLiveCaptureDispositions(db:DB,requestIds:number[]):Promise<Map<number,LiveAuditCaptureDisposition|null|"invalid">>{
  if(requestIds.length>LIMITS.sample*4||requestIds.some(id=>!positiveId(id))||new Set(requestIds).size!==requestIds.length)throw new Error("live_capture_disposition_inventory");
  if(!requestIds.length)return new Map();
  const rows=await db<Row[]>`WITH latest AS MATERIALIZED(SELECT ids.id AS request_id,d.*,q.detail AS request_detail
    FROM unnest(${requestIds}::bigint[])ids(id) LEFT JOIN agent_run_events q ON q.id=ids.id AND q.event_type=${EVENTS.capture}
    LEFT JOIN LATERAL(SELECT id,step_id,agent_run_id,created_at,detail FROM agent_run_events
      WHERE event_type=${EVENTS.disposition} AND detail->>'requestId'=ids.id::text ORDER BY id DESC LIMIT 1)d ON true),
    limits AS(SELECT COALESCE(sum(COALESCE(octet_length(detail::text),0)+COALESCE(octet_length(request_detail::text),0)),0) AS bytes FROM latest)
    SELECT d.request_id,d.id,d.created_at,CASE WHEN octet_length(d.detail::text)<=8192 AND l.bytes<=4194304 THEN d.detail ELSE NULL END AS detail,
      CASE WHEN octet_length(d.request_detail::text)<=8192 AND l.bytes<=4194304 THEN d.request_detail ELSE NULL END AS request_detail,
      (ds.agent_run_id=d.agent_run_id AND dr.run_kind='workflow' AND dr.params_json->>'source'='deming.live_source_audit'
        AND ((d.detail->'claimId'='null'::jsonb AND ((ds.step_key=${STEPS.archive} AND ds.agent_name='atlas' AND dr.agent_name IN ('atlas','magellan'))
          OR (ds.step_key=${STEPS.capture} AND ds.agent_name='magellan' AND dr.agent_name='magellan')))
        OR (ds.step_key=${STEPS.capture} AND ds.agent_name='magellan' AND dr.agent_name='magellan'
          AND dc.agent_run_id=d.agent_run_id AND dc.step_id=d.step_id AND dc.event_type=${EVENTS.captureClaim}))) AS valid,
      CASE WHEN octet_length(dc.detail::text)<=8192 THEN dc.detail ELSE NULL END AS claim_detail,dc.id AS claim_id,dc.created_at AS claim_created_at,
      dc.agent_run_id AS claim_run_id,dc.step_id AS claim_step_id,
      sd.id AS document_id,sd.institution_id AS document_institution_id,sd.content_hash AS document_hash,sd.document_r2_key AS document_key
    FROM latest d CROSS JOIN limits l LEFT JOIN agent_run_steps ds ON ds.id=d.step_id LEFT JOIN agent_runs dr ON dr.id=d.agent_run_id
    LEFT JOIN agent_run_events dc ON dc.id::text=d.detail->>'claimId'
    LEFT JOIN source_documents sd ON sd.id::text=d.detail->>'sourceDocumentId'`;
  const results=new Map<number,LiveAuditCaptureDisposition|null|"invalid">();
  for(const row of rows){
    const requestId=Number(row.request_id);if(!row.id){results.set(requestId,null);continue;}
    const parsed=liveAuditCaptureDispositionShape.safeParse(row.detail),request=liveAuditCaptureRequestShape.safeParse(row.request_detail);
    let valid=Boolean(row.valid&&parsed.success&&request.success);
    if(parsed.success&&request.success){const d=parsed.data,r=request.data;
      valid=valid&&d.requestId===requestId&&d.drawId===r.drawId&&Date.parse(d.at)<=Date.parse(iso(row.created_at))+1000;
      if(d.claimId===null)valid=valid&&d.state==='failed'&&['capture_episode_expired','capture_attempts_exhausted'].includes(d.reason)&&d.sourceDocumentId===null;
      else{const claim=liveAuditCaptureClaimShape.safeParse(row.claim_detail);
        valid=valid&&claim.success&&Number(row.claim_id)===d.claimId;
        if(claim.success)valid=valid&&claim.data.requestId===requestId&&claim.data.drawId===r.drawId&&claim.data.attempt===d.attempt
          &&claim.data.ownerRunId===Number(row.claim_run_id)&&claim.data.ownerStepId===Number(row.claim_step_id)
          &&Date.parse(d.at)>=Date.parse(iso(row.claim_created_at))&&Date.parse(d.at)<=Date.parse(claim.data.leaseUntil);
      }
      if(d.state==='captured')valid=valid&&d.sourceDocumentId===Number(row.document_id)&&r.institutionId===Number(row.document_institution_id)
        &&r.contentHash===row.document_hash&&row.document_key===`${r.contentHash.slice(0,2)}/${r.contentHash}`;
      else valid=valid&&d.sourceDocumentId===null;
    }
    results.set(requestId,valid&&parsed.success?parsed.data:'invalid');
  }
  return results;
}
export async function latestLiveCaptureDisposition(db:DB,requestId:number):Promise<LiveAuditCaptureDisposition|null|"invalid">{
  return (await readLiveCaptureDispositions(db,[requestId])).get(requestId)??null;
}
async function latestClaim(db:DB,request:LiveAuditCaptureRequest):Promise<LiveAuditCaptureClaim|null|"invalid">{
  const [row]=await db<Row[]>`SELECT e.id,e.created_at,CASE WHEN octet_length(e.detail::text)<=8192 THEN e.detail ELSE NULL END AS detail,
    (s.agent_run_id=e.agent_run_id AND s.step_key=${STEPS.capture} AND s.agent_name='magellan' AND r.agent_name='magellan'
      AND r.run_kind='workflow' AND r.params_json->>'source'='deming.live_source_audit') AS valid,e.agent_run_id,e.step_id
    FROM agent_run_events e LEFT JOIN agent_run_steps s ON s.id=e.step_id LEFT JOIN agent_runs r ON r.id=e.agent_run_id
    WHERE e.event_type=${EVENTS.captureClaim} AND e.detail->>'requestId'=${String(request.eventId)} ORDER BY e.id DESC LIMIT 1`;
  if(!row)return null;const parsed=liveAuditCaptureClaimShape.safeParse(row.detail);
  if(!row.valid||!parsed.success)return 'invalid';const claim=parsed.data;
  return claim.requestId===request.eventId&&claim.drawId===request.drawId&&claim.ownerRunId===Number(row.agent_run_id)&&claim.ownerStepId===Number(row.step_id)
    &&Date.parse(claim.leaseUntil)>Date.parse(iso(row.created_at))&&Date.parse(claim.leaseUntil)<=Date.parse(request.expiresAt)
    &&Date.parse(claim.leaseUntil)<=Date.parse(iso(row.created_at))+LIMITS.leaseMs+1000?{...claim,eventId:Number(row.id)}:'invalid';
}

/** Called only by the real observer after its chunk persists. Admission is serialized per source identity. */
export async function requestLiveSourceCaptures(db:DB,context:LiveAuditContext,drawId:number):Promise<number[]>{
  return liveAuditTransaction(db,async(tx)=>{
  const origin=await liveAuditDrawById(tx,drawId);if(!origin?.valid||!origin.detail)return [];
  const progress=await readLiveAuditProgress(tx,origin);if(!progress.valid)return [];
  const candidates=new Map<string,{observation:typeof progress.observations[number];fee:typeof origin.detail.rows[number];group:typeof origin.detail.groups[number]}>();
  for(const observation of progress.observations){
    if(!observation.contentHash||!observation.textHash||!observation.graphHash||!observation.finalUrl||!observation.requestedUrl
      ||observation.reason==="stored_source_superseded"||observation.reason==="identity_changed_during_observation")continue;
    const fee=origin.detail.rows.find(f=>f.id===observation.feeId)!,group=origin.detail.groups.find(g=>g.institutionId===fee.institutionId)!;
    if(observation.contentHash===fee.source.contentHash)continue;
    const identity=auditHash([fee.institutionId,observation.finalUrl,observation.contentHash,fee.catalog.account_product_type]);
    if(!candidates.has(identity))candidates.set(identity,{observation,fee,group});
  }
  if(!candidates.size)return [];
    // One short admission transaction, not hundreds of per-fee transactions or NOT EXISTS alone.
    await lockLiveAudit(tx,"capture-state");
    const [{now}]=await tx<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const matches=await currentLiveAuditMatches(tx,origin.detail!.rows,origin.detail!.groups);
    const rows=await tx<Row[]>`WITH selected AS MATERIALIZED(SELECT c.id,c.created_at,c.detail,
      octet_length(c.detail::text) AS bytes FROM unnest(${[...candidates.keys()]}::text[]) k(identity)
      CROSS JOIN LATERAL(SELECT id,created_at,detail FROM agent_run_events WHERE event_type=${EVENTS.capture}
        AND detail->>'identity'=k.identity AND created_at>=clock_timestamp()-interval '7 days' ORDER BY id DESC LIMIT 4)c),
      limits AS(SELECT COALESCE(sum(bytes),0) AS bytes FROM selected)
      SELECT e.id,e.created_at,CASE WHEN e.bytes<=8192 AND l.bytes<=4194304 THEN e.detail ELSE NULL END AS detail,
        CASE WHEN octet_length(d.detail::text)<=8192 THEN d.detail ELSE NULL END AS disposition
      FROM selected e CROSS JOIN limits l LEFT JOIN LATERAL(SELECT detail FROM agent_run_events
        WHERE event_type=${EVENTS.disposition} AND detail->>'requestId'=e.id::text ORDER BY id DESC LIMIT 1)d ON true ORDER BY e.id DESC`;
    // A capped/malformed history cannot safely authorize another episode.
    if(rows.some(r=>!liveAuditCaptureRequestShape.safeParse(r.detail).success))return [];
    const dispositions=await readLiveCaptureDispositions(tx,rows.map(r=>Number(r.id)));
    const requests=[];
    for(const [identity,{observation,fee,group}]of candidates){
      if(matches.get(fee.id)!==true||now.getTime()>=Date.parse(observation.expiresAt)||now.getTime()>=Date.parse(origin.detail!.deadline))continue;
      const chunkId=progress.observationOrigins?.[observation.feeId];if(!chunkId)continue;
      const previous=rows.filter(r=>(r.detail as Record<string,unknown>).identity===identity);
      if(previous.length>=LIMITS.captureEpisodesPerWeek)continue;
      let previousRequestId:number|null=null;
      if(previous.length){
        const last=liveAuditCaptureRequestShape.parse(previous[0].detail),disposition=dispositions.get(Number(previous[0].id));
        previousRequestId=Number(previous[0].id);
        if(last.chunkId===chunkId||!disposition||disposition==='invalid'||!terminal(disposition.state)||disposition.state==="captured"
          ||now.getTime()-Date.parse(disposition.at)<LIMITS.captureCooldownMs)continue;
      }
      requests.push({protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId,chunkId:chunkId,feeId:fee.id,feeFingerprint:fee.fingerprint,
        institutionId:fee.institutionId,policyFingerprint:group.policyFingerprint,identity,url:observation.finalUrl,contentHash:observation.contentHash,
        textHash:observation.textHash,observedAt:observation.observedAt,expiresAt:new Date(Math.min(now.getTime()+LIMITS.windowMs,Date.parse(observation.expiresAt))).toISOString(),
        episode:previous.length+1,previousRequestId});
    }
    if(!requests.length)return [];
    const inserted=await tx<Row[]>`INSERT INTO agent_run_events(agent_run_id,step_id,event_type,status,message,detail,created_at)
      SELECT r.id,s.id,${EVENTS.capture},'completed','Bound official-document capture request.',q.value,clock_timestamp()
      FROM agent_runs r JOIN agent_run_steps s ON s.agent_run_id=r.id
      CROSS JOIN jsonb_array_elements(${boundedAuditJson(requests,LIMITS.eventBytes)}::jsonb)q(value)
      WHERE r.id=${context.runId} AND s.id=${context.stepId} AND s.step_key=${STEPS.observe}
        AND r.agent_name='atlas' AND r.run_kind='workflow' AND r.params_json->>'source'='deming.live_source_audit'
        AND r.status='running' AND s.status='running' RETURNING id`;
    if(inserted.length!==requests.length)throw new Error("live_audit_capture_admission_not_persisted");
    return inserted.map(r=>Number(r.id));
  });
}

/** Valid current origin, frozen fee and exact observed edition, with no request-time network. */
export async function liveCaptureOriginCurrent(db:DB,request:LiveAuditCaptureRequest):Promise<boolean>{
  const origin=await liveAuditDrawById(db,request.drawId);if(!origin?.valid||!origin.detail)return false;
  const fee=origin.detail.rows.find(f=>f.id===request.feeId),group=origin.detail.groups.find(g=>g.institutionId===request.institutionId);
  if(!fee||!group||fee.fingerprint!==request.feeFingerprint||group.policyFingerprint!==request.policyFingerprint)return false;
  const progress=await readLiveAuditProgress(db,origin);if(!progress.valid||progress.observationOrigins?.[request.feeId]!==request.chunkId)return false;
  const observed=progress.observations.find(o=>o.feeId===request.feeId);
  if(!observed||observed.contentHash!==request.contentHash||observed.textHash!==request.textHash||observed.finalUrl!==request.url
    ||observed.observedAt!==request.observedAt||Date.parse(request.expiresAt)>Date.parse(observed.expiresAt)
    ||request.identity!==auditHash([fee.institutionId,observed.finalUrl,observed.contentHash,fee.catalog.account_product_type]))return false;
  return (await currentLiveAuditMatches(db,[fee],[group])).get(fee.id)===true;
}

export async function claimLiveSourceCapture(db:DB,context:LiveAuditContext,requestId:number):Promise<{request:LiveAuditCaptureRequest;claim:LiveAuditCaptureClaim;originCurrent:boolean}|null>{
  return liveAuditTransaction(db,async(tx)=>{
    await lockLiveAudit(tx,"capture-state");
    await lockLiveAudit(tx,`capture-request:${requestId}`);
    const request=await readLiveCaptureRequest(tx,requestId);if(!request)return null;
    const disposition=await latestLiveCaptureDisposition(tx,requestId);if(disposition==="invalid"||disposition&&terminal(disposition.state))return null;
    const [{now}]=await tx<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    if(disposition?.retryAt&&Date.parse(disposition.retryAt)>now.getTime())return null;
    const previous=await latestClaim(tx,request);if(previous==='invalid')return null;
    if(previous&&Date.parse(previous.leaseUntil)>now.getTime()&&(!disposition||disposition.claimId!==previous.eventId))return null;
    const attempt=previous?previous.attempt+1:1;
    const reason=now.getTime()>=Date.parse(request.expiresAt)?"capture_episode_expired":attempt>LIMITS.captureAttempts?"capture_attempts_exhausted":null;
    if(reason){await appendLiveAuditEvent(tx,context,EVENTS.disposition,{protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId:request.drawId,
      requestId,claimId:null,attempt:Math.min(attempt-1,LIMITS.captureAttempts),state:"failed",reason,at:now.toISOString(),retryAt:null,sourceDocumentId:null});return null;}
    const claim={protocol:1 as const,series:LIVE_SOURCE_AUDIT_SERIES,drawId:request.drawId,requestId,attempt,
      ownerRunId:context.runId,ownerStepId:context.stepId,leaseUntil:new Date(Math.min(now.getTime()+LIMITS.leaseMs,Date.parse(request.expiresAt))).toISOString()};
    const eventId=await appendLiveAuditEvent(tx,context,EVENTS.captureClaim,claim);
    return {request,claim:{...claim,eventId},originCurrent:await liveCaptureOriginCurrent(tx,request)};
  });
}

/** Generation guarded settlement; new-source inserts are side copies, never current-copy or fee repair. */
export async function settleLiveSourceCapture(db:DB,context:LiveAuditContext,request:LiveAuditCaptureRequest,claim:LiveAuditCaptureClaim,
  outcome:{state:"captured"|"retry"|"blocked"|"stale";reason:string;document?:{contentType:string|null;byteSize:number;key:string;etag:string|null;lastModified:string|null}}):Promise<boolean>{
  return liveAuditTransaction(db,async(tx)=>{
    await lockLiveAudit(tx,"capture-state");
    await lockLiveAudit(tx,`capture-request:${request.eventId}`);
    const [{now}]=await tx<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const latest=await latestClaim(tx,request);
    const original=await readLiveCaptureRequest(tx,request.eventId);
    const [owner]=await tx`SELECT r.id FROM agent_runs r JOIN agent_run_steps s ON s.agent_run_id=r.id
      WHERE r.id=${context.runId} AND s.id=${context.stepId} AND r.status='running' AND s.status='running'
        AND s.step_key=${STEPS.capture} AND s.agent_name='magellan' AND r.agent_name='magellan'
        AND r.run_kind='workflow' AND r.params_json->>'source'='deming.live_source_audit'`;
    if(!owner||!original||auditHash(original)!==auditHash(request)||!latest||latest==='invalid'||auditHash(latest)!==auditHash(claim)
      ||claim.ownerRunId!==context.runId||claim.ownerStepId!==context.stepId||now.getTime()>=Date.parse(claim.leaseUntil))return false;
    const existing=await latestLiveCaptureDisposition(tx,request.eventId);
    if(existing==="invalid"||existing&&existing.claimId===claim.eventId)return false;
    let state:LiveAuditCaptureDisposition["state"]=outcome.state,reason=outcome.reason,sourceDocumentId:number|null=null;
    if(!await liveCaptureOriginCurrent(tx,request)){state="stale";reason="capture_origin_identity_changed";}
    if(state==="captured"){
      if(!outcome.document)throw new Error("live_audit_capture_missing_vault_receipt");
      if(outcome.document.key!==`${request.contentHash.slice(0,2)}/${request.contentHash}`||!Number.isSafeInteger(outcome.document.byteSize)
        ||outcome.document.byteSize<1||outcome.document.byteSize>LIMITS.responseBytes)throw new Error("live_audit_capture_vault_identity");
      await lockLiveAudit(tx,`captured-bytes:${request.institutionId}:${request.contentHash}`);
      const [existingDoc]=await tx<Row[]>`SELECT id FROM source_documents WHERE institution_id=${request.institutionId}
        AND content_hash=${request.contentHash} ORDER BY id LIMIT 1 FOR UPDATE`;
      if(existingDoc){sourceDocumentId=Number(existingDoc.id);await tx`UPDATE source_documents SET document_r2_key=${outcome.document.key}
        WHERE id=${sourceDocumentId} AND document_r2_key IS NULL`;}
      else{
        const [doc]=await tx<Row[]>`INSERT INTO source_documents(institution_id,document_url,content_hash,status,document_r2_key,content_type,byte_size,etag,last_modified,crawled_at,last_checked_at,status_code)
          VALUES(${request.institutionId},${request.url},${request.contentHash},'success',
          ${outcome.document.key},${outcome.document.contentType},${outcome.document.byteSize},${outcome.document.etag},${outcome.document.lastModified},clock_timestamp(),clock_timestamp(),200) RETURNING id`;
        sourceDocumentId=Number(doc.id);
      }
    }
    if(state==="retry"&&(claim.attempt>=LIMITS.captureAttempts||now.getTime()+600_000>=Date.parse(request.expiresAt))){state="failed";reason="capture_attempts_or_age_exhausted";}
    const retryAt=state==="retry"?new Date(now.getTime()+(claim.attempt===1?600_000:3_600_000)).toISOString():null;
    await appendLiveAuditEvent(tx,context,EVENTS.disposition,{protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId:request.drawId,
      requestId:request.eventId,claimId:claim.eventId,attempt:claim.attempt,state,reason,at:now.toISOString(),retryAt,sourceDocumentId});
    return true;
  });
}

/** Finite age disposition even when capture never starts; invoked by a real non-exempt archive/draw step. */
export async function expireLiveCaptureEpisodes(db:DB,context:LiveAuditContext):Promise<number>{
  return liveAuditTransaction(db,async(tx)=>{
    await lockLiveAudit(tx,"capture-state");
    const rows=await tx<Row[]>`SELECT e.id,CASE WHEN octet_length(e.detail::text)<=8192 THEN e.detail ELSE NULL END AS detail
      FROM agent_run_events e WHERE e.event_type=${EVENTS.capture} AND e.created_at<clock_timestamp()-interval '24 hours'
        AND NOT EXISTS(SELECT 1 FROM agent_run_events d WHERE d.event_type=${EVENTS.disposition} AND d.detail->>'requestId'=e.id::text
          AND d.detail->>'state' IN ('captured','failed','blocked','stale')) ORDER BY e.id LIMIT 500`;
    const dispositions=rows.flatMap(row=>{
      const request=liveAuditCaptureRequestShape.safeParse(row.detail);if(!request.success)return [];
      return [{protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId:request.data.drawId,requestId:Number(row.id),claimId:null,attempt:0,
        state:"failed",reason:"capture_episode_expired",at:request.data.expiresAt,retryAt:null,sourceDocumentId:null}];
    });
    if(!dispositions.length)return 0;
    const inserted=await tx<Row[]>`INSERT INTO agent_run_events(agent_run_id,step_id,event_type,status,message,detail,created_at)
      SELECT r.id,s.id,${EVENTS.disposition},'completed','Capture episode reached its finite age limit.',q.value,clock_timestamp()
      FROM agent_runs r JOIN agent_run_steps s ON s.agent_run_id=r.id
      CROSS JOIN jsonb_array_elements(${boundedAuditJson(dispositions,LIMITS.eventBytes)}::jsonb)q(value)
      WHERE r.id=${context.runId} AND s.id=${context.stepId} AND s.step_key=${STEPS.archive}
        AND r.run_kind='workflow' AND r.agent_name IN ('atlas','magellan') AND r.params_json->>'source'='deming.live_source_audit'
        AND r.status='running' AND s.status='running' RETURNING id`;
    if(inserted.length!==dispositions.length)throw new Error("live_audit_expiry_not_persisted");
    return inserted.length;
  });
}
