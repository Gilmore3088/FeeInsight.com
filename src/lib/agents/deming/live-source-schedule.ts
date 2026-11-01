import { sql } from "@/lib/data-store/connection";
import { LIVE_AUDIT_DRAW_ATTEMPTS_PER_DAY,LIVE_AUDIT_DRAWS_PER_DAY,liveAuditTransaction,lockLiveAudit } from "@/lib/data-store/live-source-audit";
import { startAgentRun } from "../run-store";
import { LIVE_AUDIT_EVENTS as EVENTS,LIVE_AUDIT_STEPS as STEPS,LIVE_AUDIT_SOURCE,LIVE_SOURCE_AUDIT_SERIES } from "./live-source-audit";

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
    // A draw frozen under an older series (a checker/category/name version bumped since) can never be
    // claimed (latestLiveAuditDraw rejects it), so admitting a chunk for it only holds the one active slot.
    const draws=await tx`SELECT e.id FROM agent_run_events e WHERE e.event_type=${EVENTS.draw}
      AND e.created_at>=clock_timestamp()-interval '24 hours' AND e.detail->>'state'='ready'
      AND e.detail->>'series'=${LIVE_SOURCE_AUDIT_SERIES}
      AND jsonb_typeof(e.detail->'groups')='array'
      AND e.detail->>'deadline'>to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      AND COALESCE((SELECT c.detail->>'nextGroup' FROM agent_run_events c WHERE c.event_type=${EVENTS.chunk}
        AND c.detail->>'drawId'=e.id::text ORDER BY c.id DESC LIMIT 1),'0')<>(CASE WHEN jsonb_typeof(e.detail->'groups')='array' THEN jsonb_array_length(e.detail->'groups') END)::text
      AND NOT EXISTS(SELECT 1 FROM agent_run_events a WHERE a.event_type=${EVENTS.archived} AND a.detail->>'drawId'=e.id::text
        AND a.detail->'summary'->>'state'='unavailable')
      ORDER BY e.created_at,e.id LIMIT 1`;
    if(!draws[0]){
      // The day's draw no longer waits on the scoreboard run, whose earlier failures cancelled it on
      // Oct 29 and Nov 1. A version bump that changes the series redraws under the new series
      // instead of voiding the open draw's remaining work (#2061); createLiveAuditDraw caps it per day.
      const day=now.toISOString().slice(0,10);
      const [due]=await tx`SELECT (NOT EXISTS(SELECT 1 FROM agent_run_events e WHERE e.event_type=${EVENTS.draw}
          AND e.detail->>'day'=${day} AND e.detail->>'series'=${LIVE_SOURCE_AUDIT_SERIES}))
        AND (SELECT count(*) FROM agent_run_events e WHERE e.event_type=${EVENTS.draw} AND e.detail->>'day'=${day})<${LIVE_AUDIT_DRAWS_PER_DAY}
        -- A draw that keeps running out of SQL budget writes no draw event, so its attempts are counted
        -- by the runs themselves: at most LIVE_AUDIT_DRAW_ATTEMPTS_PER_DAY a UTC day, 30 minutes apart,
        -- so capture and maintenance keep their ticks.
        AND (SELECT count(*) FROM agent_runs r JOIN agent_run_steps s ON s.agent_run_id=r.id AND s.step_key=${STEPS.draw}
          WHERE r.params_json->>'source'=${LIVE_AUDIT_SOURCE} AND r.started_at>=(${day}::date)::timestamp AT TIME ZONE 'UTC')<${LIVE_AUDIT_DRAW_ATTEMPTS_PER_DAY}
        AND NOT EXISTS(SELECT 1 FROM agent_runs r JOIN agent_run_steps s ON s.agent_run_id=r.id AND s.step_key=${STEPS.draw}
          WHERE r.params_json->>'source'=${LIVE_AUDIT_SOURCE} AND r.started_at>${now.toISOString()}::timestamptz-interval '30 minutes') AS due`;
      if(due?.due===true){
        const started=await startAgentRun({agent:"atlas",kind:"workflow",title:"Deming: live-source diagnostic draw",
          params:{source:LIVE_AUDIT_SOURCE},triggeredBy:LIVE_AUDIT_SOURCE,triggerSource:"schedule",idempotencyKey:key,reuseTerminal:true,
          steps:[{key:STEPS.draw,agent:"atlas",title:"Freeze today's 500-fee draw under the current series"}]},tx);
        return {scheduled:started.reused?0:1,reused:started.reused?1:0,runId:started.run.id};
      }
    }
    // An older-series request belongs to a draw no claim can validate; it must not hold the capture slot.
    const requests=await tx`SELECT e.id,e.detail->>'drawId' AS draw_id FROM agent_run_events e WHERE e.event_type=${EVENTS.capture}
      AND e.created_at>=clock_timestamp()-interval '24 hours' AND e.detail->>'series'=${LIVE_SOURCE_AUDIT_SERIES}
      AND NOT EXISTS(SELECT 1 FROM agent_run_events d WHERE d.event_type=${EVENTS.disposition} AND d.detail->>'requestId'=e.id::text
        AND d.detail->>'state' IN ('captured','failed','blocked','stale'))
      AND COALESCE((SELECT d.detail->>'retryAt' FROM agent_run_events d WHERE d.event_type=${EVENTS.disposition}
        AND d.detail->>'requestId'=e.id::text ORDER BY d.id DESC LIMIT 1),'')<=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ORDER BY e.created_at,e.id LIMIT 1`;
    const capture=Boolean(requests[0])&&(bucket%2===0||!draws[0]);
    // An older-series draw can never be archived (its origin no longer validates), so it would take
    // this slot on every idle tick; only the current series is maintained.
    const maintenance=!capture&&!draws[0]?await tx`SELECT e.id FROM agent_run_events e WHERE e.event_type=${EVENTS.draw}
      AND e.created_at>=clock_timestamp()-interval '97 days' AND e.detail->>'series'=${LIVE_SOURCE_AUDIT_SERIES}
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
