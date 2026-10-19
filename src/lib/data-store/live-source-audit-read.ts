import { sql } from "./connection";
import { LIVE_SOURCE_AUDIT as LIMITS,LIVE_SOURCE_AUDIT_SERIES,LIVE_AUDIT_EVENTS as EVENTS,LIVE_AUDIT_STEPS as STEPS,auditHash,boundedAuditJson,liveAuditUnknown,positiveId } from "@/lib/agents/deming/live-source-audit";
import { compactLiveAuditArchive,summarizeLiveAudit,validateLiveAuditComponent,type LiveAuditComponent,type LiveAuditSummary,type LiveAuditProgress,liveAuditCaptureRequestShape } from "@/lib/agents/deming/live-source-audit-records";
import { appendLiveAuditEvent,currentLiveAuditState,LIVE_AUDIT_CURRENT_STATE_SQL,LIVE_AUDIT_FEE_JOINS_SQL,LIVE_AUDIT_POLICY_JOINS_SQL,latestLiveAuditDraw,liveAuditDrawById,liveAuditTransaction,lockLiveAudit,readLiveAuditProgress,type LiveAuditContext,type LiveAuditDrawEvent } from "./live-source-audit";
import { readLiveCaptureDispositions } from "./live-source-capture";
type DB=typeof sql;type Row=Record<string,unknown>;

async function captureCounts(db:DB,drawId:number,now:Date):Promise<LiveAuditSummary["capture"]&{requestIds:number[]}>{
  const rows=await db<Row[]>`WITH headers AS MATERIALIZED(SELECT e.id,e.step_id,e.agent_run_id,e.created_at,e.detail,
    octet_length(e.detail::text) AS bytes FROM agent_run_events e WHERE e.event_type=${EVENTS.capture}
    AND e.detail->>'drawId'=${String(drawId)} ORDER BY e.id LIMIT 501),
    limits AS(SELECT count(*) AS n,COALESCE(sum(bytes),0) AS bytes FROM headers)
    SELECT e.id,e.created_at,CASE WHEN l.n<=500 AND l.bytes<=4194304 AND e.bytes<=8192 THEN e.detail ELSE NULL END AS detail,
      (s.agent_run_id=e.agent_run_id AND s.step_key=${STEPS.observe} AND r.agent_name='atlas' AND r.run_kind='workflow'
       AND r.params_json->>'source'='deming.live_source_audit') AS valid,
      e.id AS request_id
    FROM headers e CROSS JOIN limits l LEFT JOIN agent_run_steps s ON s.id=e.step_id LEFT JOIN agent_runs r ON r.id=e.agent_run_id`;
  if(rows.length>500)throw new Error("live_capture_receipt_cap");
  const dispositions=await readLiveCaptureDispositions(db,rows.map(r=>Number(r.id)));
  const count:LiveAuditSummary["capture"]={requested:rows.length,pending:0,captured:0,failed:0,blocked:0,oldestPendingAt:null};
  for(const row of rows){
    const request=liveAuditCaptureRequestShape.safeParse(row.detail),disposition=dispositions.get(Number(row.id));
    if(!row.valid||!request.success||disposition==='invalid'){count.blocked++;continue;}
    const state=disposition?.state??null;
    if(state==="captured")count.captured++;
    else if(state==="blocked"||state==="stale")count.blocked++;
    else if(state==="failed"||Date.parse(request.data.expiresAt)<=now.getTime())count.failed++;
    else{count.pending++;const at=row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at);
      if(!count.oldestPendingAt||at<count.oldestPendingAt)count.oldestPendingAt=at;}
  }
  return {...count,requestIds:rows.map(r=>Number(r.id))};
}

async function componentFromOrigin(db:DB,origin:LiveAuditDrawEvent,now:Date,current:boolean):Promise<{component:LiveAuditComponent;progress:LiveAuditProgress;currentState:Map<number,{matches:boolean;stateHash:string}>}|null>{
  if(!origin.valid||!origin.detail)return null;
  let progress=await readLiveAuditProgress(db,origin);
  const currentState=current?await currentLiveAuditState(db,origin.detail.rows,origin.detail.groups):new Map<number,{matches:boolean;stateHash:string}>();
  if(current&&progress.valid){
    progress={...progress,observations:progress.observations.map(o=>currentState.get(o.feeId)?.matches===true?o:
      liveAuditUnknown(origin.detail!.rows.find(f=>f.id===o.feeId)!,now.toISOString(),"identity_changed_since_observation"))};
  }
  const summary=summarizeLiveAudit(origin.id,origin.detail,progress,now);
  const {requestIds,...captures}=await captureCounts(db,origin.id,now);
  summary.capture=captures;progress={...progress,captureRequestIds:requestIds};
  if(current&&now.getTime()>=Date.parse(origin.detail.deadline)){
    // Retained historical support is labelled separately; expired evidence is no current percentage.
    summary.support=null;summary.envelope=null;
  }
  return {component:{summary,archive:null,archiveEventId:null},progress,currentState};
}

/** Read-only: no network or writes. The latest unknown/malformed draw is a tombstone. */
export async function readLiveSourceAudit(db:DB=sql,now=new Date()):Promise<LiveAuditComponent|null>{
  const origin=await latestLiveAuditDraw(db);if(!origin)return null;
  if(!origin.valid||!origin.detail)return null;
  const result=await componentFromOrigin(db,origin,now,true);
  if(result){const [last]=await db<Row[]>`SELECT event_type,detail->>'reason' AS reason FROM agent_run_events
    WHERE event_type IN (${EVENTS.final},${EVENTS.archived}) AND detail->>'drawId'=${String(origin.id)} ORDER BY id DESC LIMIT 1`;
    if(last?.event_type===EVENTS.final)result.component.summary.reason=`final_unarchived:${String(last.reason??"unknown").slice(0,80)}`;}
  return validateLiveAuditComponent(result?.component);
}

/** A retained component is validated as its own historical series, never used as current fallback. */
export function readHistoricalLiveSourceAudit(detail:unknown):LiveAuditComponent|null{
  if(!detail||typeof detail!=="object")return null;
  const goal=(detail as Record<string,unknown>).goal;
  return validateLiveAuditComponent(goal&&typeof goal==="object"?(goal as Record<string,unknown>).liveSourceAudit:null);
}

/** A retained degradation label carries no numerical metric or reconstructed provenance. */
export function readHistoricalLiveAuditUnavailable(detail:unknown):{reason:string;at:string}|null{
  if(!detail||typeof detail!=='object')return null;const goal=(detail as Row).goal;
  if(!goal||typeof goal!=='object')return null;const value=(goal as Row).liveSourceAuditUnavailable;
  if(!value||typeof value!=='object')return null;const v=value as Row;
  return v.protocol===1&&v.series===LIVE_SOURCE_AUDIT_SERIES&&positiveId(v.drawId)&&positiveId(v.tombstoneId)
    &&v.reason==='origin_retention_exhausted'&&typeof v.at==='string'&&Number.isFinite(Date.parse(v.at))?{reason:v.reason,at:v.at}:null;
}

/** Persist the late final result into its ORIGINAL day's existing scoreboard; other goal fields stay fixed. */
export async function archiveLiveSourceAudit(db:DB,context:LiveAuditContext,drawId:number,now=new Date()):Promise<boolean>{
  return liveAuditTransaction(db,async(tx)=>{
    await lockLiveAudit(tx,`progress:${drawId}`);
    await lockLiveAudit(tx,"capture-state");
    const origin=await liveAuditDrawById(tx,drawId);if(!origin?.valid||!origin.detail)return false;
    const [snapshot]=await tx<Row[]>`SELECT id,detail FROM pipeline_scoreboard_snapshots WHERE snapshot_date=${origin.detail.day}::date FOR UPDATE`;
    const result=await componentFromOrigin(tx,origin,now,true);if(!result||result.component.summary.state==="partial")return false;
    const summary={...result.component.summary,archiveState:"archived" as const};
    const previous=snapshot?readHistoricalLiveSourceAudit(snapshot.detail):null;
    if(previous?.archive&&auditHash({...previous.summary,componentAsOf:""})===auditHash({...summary,componentAsOf:""}))return true;
    let archive;
    try{archive=compactLiveAuditArchive(origin.id,origin.detail,result.progress,now,summary);}
    catch{await appendLiveAuditEvent(tx,context,EVENTS.final,{protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId,day:origin.detail.day,state:"final_unarchived",reason:"compact_payload_cap",at:now.toISOString()});return false;}
    if(!snapshot){await appendLiveAuditEvent(tx,context,EVENTS.final,{protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId,day:origin.detail.day,state:"final_unarchived",reason:"snapshot_missing",at:now.toISOString()});return false;}
    const component:LiveAuditComponent={summary,archive,archiveEventId:Number.MAX_SAFE_INTEGER};
    if(!validateLiveAuditComponent(component))throw new Error("live_audit_archive_validation");
    const expected=[...result.currentState].map(([id,value])=>({id,state_hash:value.stateHash}));
    const updated=await tx.unsafe<Row[]>(`WITH expected AS MATERIALIZED(SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id bigint,state_hash text)),
      current_state AS MATERIALIZED(SELECT expected.id,expected.state_hash=${LIVE_AUDIT_CURRENT_STATE_SQL} AS matches
        FROM expected LEFT JOIN published_fee_catalog c ON c.id=expected.id ${LIVE_AUDIT_FEE_JOINS_SQL}
        LEFT JOIN institution_sources inst ON inst.id=c.institution_id ${LIVE_AUDIT_POLICY_JOINS_SQL}),
      receipt AS(INSERT INTO agent_run_events(agent_run_id,step_id,event_type,status,message,detail,created_at)
        SELECT r.id,s.id,$2,'completed','Bound compact live-source archive.',$3::jsonb,clock_timestamp()
        FROM agent_runs r JOIN agent_run_steps s ON s.agent_run_id=r.id
        WHERE r.id=$4 AND s.id=$5 AND s.step_key=$6 AND s.agent_name='atlas' AND r.agent_name IN ('atlas','magellan')
          AND r.run_kind='workflow' AND r.params_json->>'source'='deming.live_source_audit' AND r.status='running' AND s.status='running'
          AND NOT EXISTS(SELECT 1 FROM current_state WHERE matches IS DISTINCT FROM true) RETURNING id)
      UPDATE pipeline_scoreboard_snapshots snap SET detail=jsonb_set(COALESCE(snap.detail,'{}'::jsonb),'{goal}',
        COALESCE(snap.detail->'goal','{}'::jsonb)||jsonb_build_object('liveSourceAudit',jsonb_set($7::jsonb,'{archiveEventId}',to_jsonb(receipt.id)))),updated_at=clock_timestamp()
      FROM receipt WHERE snap.id=$8 RETURNING snap.id`,[boundedAuditJson(expected,LIMITS.eventBytes),EVENTS.archived,boundedAuditJson(archive,LIMITS.archiveBytes),
        context.runId,context.stepId,STEPS.archive,boundedAuditJson(component,LIMITS.archiveBytes+8192),Number(snapshot.id)]);
    if(!updated.length){await appendLiveAuditEvent(tx,context,EVENTS.final,{protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId,day:origin.detail.day,
      state:"final_unarchived",reason:"state_changed_during_archival",at:new Date().toISOString()});return false;}
    return true;
  });
}

/** At most eight bookkeeping finalizers, separate from fresh-work fairness and with no HTTP. */
export async function finalizeDueLiveAudits(db:DB,context:LiveAuditContext):Promise<number>{
  const rows=await liveAuditTransaction(db,async tx=>tx<Row[]>`SELECT id FROM agent_run_events WHERE event_type=${EVENTS.draw}
    AND created_at>=clock_timestamp()-interval '97 days' AND detail->>'series'=${LIVE_SOURCE_AUDIT_SERIES}
    AND (detail->>'deadline')::text<=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    AND NOT EXISTS(SELECT 1 FROM agent_run_events a WHERE a.event_type=${EVENTS.archived} AND a.detail->>'drawId'=agent_run_events.id::text
      AND a.created_at>=COALESCE((SELECT max(c.created_at) FROM agent_run_events c WHERE c.event_type IN (${EVENTS.chunk},${EVENTS.capture},${EVENTS.disposition})
        AND c.detail->>'drawId'=agent_run_events.id::text),agent_run_events.created_at))
    ORDER BY (SELECT max(f.created_at) FROM agent_run_events f WHERE f.event_type=${EVENTS.final}
      AND f.detail->>'drawId'=agent_run_events.id::text) ASC NULLS FIRST,created_at,id LIMIT 8`);
  let n=0;for(const row of rows)if(await archiveLiveSourceAudit(db,context,Number(row.id)))n++;return n;
}

/** Before deleting origins after the bounded grace, leave an explicit retained degradation receipt. */
export async function degradeLiveAuditRetention(db:DB,context:LiveAuditContext):Promise<number>{
  const rows=await db<Row[]>`SELECT id,detail->>'day' AS day FROM agent_run_events e
    WHERE e.event_type=${EVENTS.draw} AND e.created_at<clock_timestamp()-interval '97 days'
      AND NOT EXISTS(SELECT 1 FROM agent_run_events a WHERE a.event_type=${EVENTS.unavailable} AND a.detail->>'drawId'=e.id::text)
    ORDER BY e.id LIMIT 8`;
  for(const row of rows){
    const tombstone={protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId:Number(row.id),day:String(row.day),reason:"origin_retention_exhausted",at:new Date().toISOString()};
    const tombstoneId=await appendLiveAuditEvent(db,context,EVENTS.unavailable,tombstone);
    if(typeof row.day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(row.day)||!Number.isFinite(Date.parse(row.day)))continue;
    // Remove the numerical component only when it was not already durably archived and valid.
    const [snapshot]=await db<Row[]>`SELECT id,detail FROM pipeline_scoreboard_snapshots WHERE snapshot_date=${String(row.day)}::date FOR UPDATE`;
    if(snapshot&&!readHistoricalLiveSourceAudit(snapshot.detail)?.archive)await db`UPDATE pipeline_scoreboard_snapshots
      SET detail=jsonb_set(detail,'{goal}',COALESCE(detail->'goal','{}'::jsonb)||jsonb_build_object('liveSourceAudit',null,
        'liveSourceAuditUnavailable',${boundedAuditJson({...tombstone,tombstoneId},8192)}::jsonb)),updated_at=clock_timestamp()
      WHERE id=${Number(snapshot.id)}`;
  }
  // Malformed/orphan namespace events cannot pin origins forever merely by omitting drawId.
  // A separate bounded receipt names each immutable orphan before the same savepoint trims it.
  const orphans=await db<Row[]>`SELECT e.id FROM agent_run_events e WHERE e.event_type LIKE 'live_fee_audit.%'
    AND e.event_type<>${EVENTS.draw} AND e.created_at<clock_timestamp()-interval '97 days'
    AND NOT EXISTS(SELECT 1 FROM agent_run_events d WHERE d.event_type=${EVENTS.draw} AND d.id::text=e.detail->>'drawId')
    AND NOT EXISTS(SELECT 1 FROM agent_run_events proof WHERE proof.event_type=${EVENTS.unavailable} AND proof.detail->>'originEventId'=e.id::text)
    ORDER BY e.id LIMIT 8`;
  for(const orphan of orphans)await appendLiveAuditEvent(db,context,EVENTS.unavailable,{protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,
    originEventId:Number(orphan.id),reason:'orphan_origin_retention_exhausted',at:new Date().toISOString()});
  return rows.length+orphans.length;
}
