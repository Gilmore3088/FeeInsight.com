import { sql } from "@/lib/data-store/connection";
import { liveAuditTransaction,lockLiveAudit } from "@/lib/data-store/live-source-audit";
import { startAgentRun } from "../run-store";
import { LIVE_AUDIT_EVENTS as EVENTS,LIVE_AUDIT_STEPS as STEPS,LIVE_AUDIT_SOURCE } from "./live-source-audit";

/** Admission only, no I/O: one live work run per UTC ten-minute tick bucket, and one active globally. */
export async function scheduleLiveSourceAudit(options:{db?:typeof sql;pipelineEnabled:boolean;backendEnabled:boolean;now?:Date}):Promise<{scheduled:number;reused:number;runId:number|null}>{
  if(!options.pipelineEnabled||!options.backendEnabled)return {scheduled:0,reused:0,runId:null};
  const db=options.db??sql,now=options.now??new Date(),bucket=Math.floor(now.getTime()/600_000);
  return liveAuditTransaction(db,async(tx)=>{
    await lockLiveAudit(tx,"work-admission");
    const key=`live-source-audit:${bucket}`;
    const [active]=await tx`SELECT id FROM agent_runs WHERE params_json->>'source'=${LIVE_AUDIT_SOURCE}
      AND status IN ('queued','running','cancel_requested') ORDER BY started_at,id LIMIT 1`;
    if(active)return {scheduled:0,reused:1,runId:Number(active.id)};
    const [sameTick]=await tx`SELECT id FROM agent_runs WHERE idempotency_key=${key} ORDER BY started_at,id LIMIT 1`;
    if(sameTick)return {scheduled:0,reused:1,runId:Number(sameTick.id)};
    const draws=await tx`SELECT e.id FROM agent_run_events e WHERE e.event_type=${EVENTS.draw}
      AND e.created_at>=clock_timestamp()-interval '24 hours' AND e.detail->>'state'='ready'
      AND jsonb_typeof(e.detail->'groups')='array'
      AND e.detail->>'deadline'>to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      AND COALESCE((SELECT c.detail->>'nextGroup' FROM agent_run_events c WHERE c.event_type=${EVENTS.chunk}
        AND c.detail->>'drawId'=e.id::text ORDER BY c.id DESC LIMIT 1),'0')<>(CASE WHEN jsonb_typeof(e.detail->'groups')='array' THEN jsonb_array_length(e.detail->'groups') END)::text
      AND NOT EXISTS(SELECT 1 FROM agent_run_events a WHERE a.event_type=${EVENTS.archived} AND a.detail->>'drawId'=e.id::text
        AND a.detail->'summary'->>'state'='unavailable')
      ORDER BY e.created_at,e.id LIMIT 1`;
    const requests=await tx`SELECT e.id,e.detail->>'drawId' AS draw_id FROM agent_run_events e WHERE e.event_type=${EVENTS.capture}
      AND e.created_at>=clock_timestamp()-interval '24 hours'
      AND NOT EXISTS(SELECT 1 FROM agent_run_events d WHERE d.event_type=${EVENTS.disposition} AND d.detail->>'requestId'=e.id::text
        AND d.detail->>'state' IN ('captured','failed','blocked','stale'))
      AND COALESCE((SELECT d.detail->>'retryAt' FROM agent_run_events d WHERE d.event_type=${EVENTS.disposition}
        AND d.detail->>'requestId'=e.id::text ORDER BY d.id DESC LIMIT 1),'')<=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ORDER BY e.created_at,e.id LIMIT 1`;
    const capture=Boolean(requests[0])&&(bucket%2===0||!draws[0]);
    const maintenance=!capture&&!draws[0]?await tx`SELECT e.id FROM agent_run_events e WHERE e.event_type=${EVENTS.draw}
      AND e.created_at>=clock_timestamp()-interval '97 days'
      AND (NOT EXISTS(SELECT 1 FROM agent_run_events a WHERE a.event_type=${EVENTS.archived} AND a.detail->>'drawId'=e.id::text)
        OR EXISTS(SELECT 1 FROM agent_run_events q WHERE q.event_type=${EVENTS.capture} AND q.detail->>'drawId'=e.id::text
          AND q.created_at<clock_timestamp()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM agent_run_events d
            WHERE d.event_type=${EVENTS.disposition} AND d.detail->>'requestId'=q.id::text AND d.detail->>'state' IN ('captured','failed','blocked','stale'))))
      ORDER BY (SELECT max(f.created_at) FROM agent_run_events f WHERE f.event_type=${EVENTS.final} AND f.detail->>'drawId'=e.id::text) ASC NULLS FIRST,e.created_at,e.id LIMIT 1`:[];
    if(!capture&&!draws[0]&&!maintenance[0])return {scheduled:0,reused:0,runId:null};
    const onlyArchive=!capture&&!draws[0],drawId=Number(capture?requests[0].draw_id:draws[0]?.id??maintenance[0].id),requestId=capture?Number(requests[0].id):null;
    const started=await startAgentRun({agent:capture?"magellan":"atlas",kind:"workflow",title:capture?"Magellan: capture observed official fee document":"Deming: live-source diagnostic chunk",
      params:{source:LIVE_AUDIT_SOURCE,drawId,...(requestId?{requestId}:{})},triggeredBy:LIVE_AUDIT_SOURCE,triggerSource:"schedule",idempotencyKey:key,reuseTerminal:true,
      steps:[...(!onlyArchive?[{key:capture?STEPS.capture:STEPS.observe,agent:capture?"magellan" as const:"atlas" as const,title:capture?"Capture exact observed bytes with finite retries":"Observe a bounded fresh official-source chunk"}]:[]),
        {key:STEPS.archive,agent:"atlas",title:"Archive completed-later diagnostic history"}]},tx);
    return {scheduled:started.reused?0:1,reused:started.reused?1:0,runId:started.run.id};
  });
}
