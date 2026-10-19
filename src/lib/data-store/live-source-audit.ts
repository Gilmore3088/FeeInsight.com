import { randomBytes } from "node:crypto";
import { sql } from "./connection";
import { inLiveAuditTransaction } from "./live-source-sql";
import {
  LIVE_SOURCE_AUDIT as LIMITS, LIVE_SOURCE_AUDIT_PROTOCOL, LIVE_SOURCE_AUDIT_SERIES, LIVE_AUDIT_EVENTS as EVENTS,
  LIVE_AUDIT_STEPS as STEPS, LIVE_AUDIT_SOURCE, auditHash, boundedAuditJson, freezeLiveAuditFee,
  liveAuditPolicyFingerprint, makeLiveAuditDraw, positiveId, type LiveAuditCatalogRow, type LiveAuditDraw,
  type LiveAuditFee, type LiveAuditGroup, type LiveAuditSourceIdentity,
  type LiveAuditObservation,
} from "@/lib/agents/deming/live-source-audit";
import { liveAuditClaimShape, liveAuditChunkShape, validLiveAuditObservation,
  type LiveAuditClaim, type LiveAuditChunk, type LiveAuditProgress } from "@/lib/agents/deming/live-source-audit-records";

type SqlTag = typeof sql;
type Row = Record<string, unknown>;
export interface LiveAuditContext { runId: number; stepId: number; stepKey: string }
export interface LiveAuditEvent<T = unknown> { id: number; detail: T | null; createdAt: string; valid: boolean }
export interface LiveAuditDrawEvent extends LiveAuditEvent<LiveAuditDraw> { reason?: string }

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const dbId = (value: unknown) => { const n = typeof value === "string" && /^[1-9][0-9]{0,17}$/.test(value) ? Number(value) : value; return positiveId(n) ? n : null; };

/** All new steps use a global client, not the old step-spanning ledger transaction. */
export async function liveAuditTransaction<T>(db: SqlTag, work: (tx: SqlTag) => Promise<T>,deadline?:number): Promise<T> {
  return inLiveAuditTransaction(db,work,deadline);
}

export async function lockLiveAudit(tx: SqlTag, key: string): Promise<void> {
  if (key.length > 200) throw new Error("live_audit_lock_key_limit");
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`live_fee_audit:${key}`}, 0))`;
}

/** Keep the same expressions for freezing and the final current-state comparisons. */
export const LIVE_AUDIT_FEE_PAYLOAD_SQL = `jsonb_build_object(
  'catalog',to_jsonb(c),'lineShare',fr.line_share,
  'source',jsonb_build_object('id',sd.id,'institutionId',sd.institution_id,'url',sd.document_url,'contentHash',sd.content_hash,
    'r2Key',sd.document_r2_key,'status',sd.status,'supersededById',sd.superseded_by_id))`;
export const LIVE_AUDIT_POLICY_SQL = `jsonb_build_object(
  'institutionId',inst.id,'websiteUrl',inst.website_url,'feeScheduleUrl',inst.fee_schedule_url,
  'canonicalSourceUrl',profile.canonical_source_url,'sourceKind',profile.source_kind,'readStrategy',profile.read_strategy,
  'correctionVersion',profile.correction_version,'lockedByCorrection',profile.locked_by_correction,
  'lastSourceHash',profile.last_source_hash,'lastSuccessfulSourceDocumentId',profile.last_successful_source_document_id,
  'doNotRetry',profile.do_not_retry,'rejectedSourceUrls',profile.rejected_source_urls)`;
const SOURCE_SQL = `jsonb_build_object('id',sd.id,'institutionId',sd.institution_id,'url',sd.document_url,'contentHash',sd.content_hash,
  'r2Key',sd.document_r2_key,'status',sd.status,'supersededById',sd.superseded_by_id)`;
export const LIVE_AUDIT_FEE_JOINS_SQL = `LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id=c.fee_raw_id
  LEFT JOIN source_documents sd ON sd.id=c.source_document_id`;
export const LIVE_AUDIT_POLICY_JOINS_SQL = `LEFT JOIN institution_source_profiles profile ON profile.institution_id=inst.id`;
const FEE_JOINS=LIVE_AUDIT_FEE_JOINS_SQL,POLICY_JOINS=LIVE_AUDIT_POLICY_JOINS_SQL;
export const LIVE_AUDIT_CURRENT_STATE_SQL=`encode(sha256(convert_to(COALESCE((${LIVE_AUDIT_FEE_PAYLOAD_SQL})::text,'null')||E'\\n'||COALESCE((${LIVE_AUDIT_POLICY_SQL})::text,'null'),'UTF8')),'hex')`;
const VARIABLE_GUARD = `GREATEST(COALESCE(octet_length(c.fee_name),0),COALESCE(octet_length(c.conditions),0),
 COALESCE(octet_length(c.account_product_type),0),COALESCE(octet_length(c.audience_evidence),0),
 COALESCE(octet_length(c.waiver_text),0),COALESCE(octet_length(c.extraction_note),0),
 COALESCE(octet_length(c.source_url),0),COALESCE(octet_length(c.document_url),0),
 COALESCE(octet_length(c.document_r2_key),0),COALESCE(octet_length(fr.line_share),0))<=8192
 AND COALESCE(octet_length(c.validation_flags::text),0)<=32768`;

// One statement snapshot freezes the whole bounded ID frame, selected row state and
// shared semantic policies/source identities. Caps are checked BEFORE array aggregation
// or transfer. A sentinel/overflow invalidates the whole draw, never just the large rows.
const FRAME_SQL = `WITH frame AS MATERIALIZED (
 SELECT c.id,c.institution_id FROM published_fee_catalog c
 WHERE c.review_status='approved' AND c.amount IS NOT NULL AND c.amount_kind IS DISTINCT FROM 'percent'
 ORDER BY c.id LIMIT 250001
), sample AS MATERIALIZED (
 SELECT id,institution_id FROM frame WHERE (SELECT count(*) FROM frame)<250001
 ORDER BY encode(sha256(convert_to('selection:'||$1||':'||id::text,'UTF8')),'hex'),id LIMIT 500
), fee_payloads AS MATERIALIZED (
 SELECT c.id,c.institution_id,CASE WHEN ${VARIABLE_GUARD} THEN ${LIVE_AUDIT_FEE_PAYLOAD_SQL} ELSE NULL END AS payload
 FROM sample f JOIN published_fee_catalog c ON c.id=f.id ${FEE_JOINS}
), group_ids AS MATERIALIZED (SELECT DISTINCT institution_id FROM sample),
 policy_payloads AS MATERIALIZED (
 SELECT g.institution_id,CASE WHEN
   GREATEST(COALESCE(octet_length(inst.website_url),0),COALESCE(octet_length(inst.fee_schedule_url),0),
    COALESCE(octet_length(profile.canonical_source_url),0))<=2048
   AND COALESCE(octet_length(profile.do_not_retry::text),0)+COALESCE(octet_length(profile.rejected_source_urls::text),0)<=32768
   THEN ${LIVE_AUDIT_POLICY_SQL} ELSE NULL END AS payload
 FROM group_ids g LEFT JOIN institution_sources inst ON inst.id=g.institution_id ${POLICY_JOINS}
), source_rows AS MATERIALIZED (
 SELECT g.institution_id,docs.id,docs.payload
 FROM group_ids g CROSS JOIN LATERAL (
   SELECT sd.id,CASE WHEN GREATEST(COALESCE(octet_length(sd.document_url),0),
    COALESCE(octet_length(sd.document_r2_key),0),COALESCE(octet_length(sd.content_hash),0))<=2048
    AND octet_length(sd.status)<=100 THEN ${SOURCE_SQL} ELSE NULL END AS payload
   FROM source_documents sd WHERE sd.institution_id=g.institution_id ORDER BY sd.id LIMIT 257
 ) docs
), source_limits AS MATERIALIZED (
 SELECT institution_id,count(*) AS n,bool_or(payload IS NULL) AS invalid,
  sum(COALESCE(octet_length(payload::text),0)) AS bytes FROM source_rows GROUP BY institution_id
), limits AS MATERIALIZED (
 SELECT CASE
  WHEN (SELECT count(*) FROM frame)=250001 THEN 'population_cap'
  WHEN (SELECT count(*) FROM sample)<>(SELECT count(*) FROM fee_payloads) THEN 'sample_inventory_mismatch'
  WHEN EXISTS(SELECT 1 FROM fee_payloads WHERE payload IS NULL OR octet_length(payload::text)>8192) THEN 'row_cap'
  WHEN EXISTS(SELECT 1 FROM policy_payloads WHERE payload IS NULL OR octet_length(payload::text)>32768) THEN 'policy_cap'
  WHEN EXISTS(SELECT 1 FROM source_limits WHERE n>256 OR invalid OR bytes>32768) THEN 'source_inventory_cap'
  WHEN (SELECT COALESCE(sum(octet_length(payload::text)),0) FROM fee_payloads)>4194304 THEN 'rows_pool_cap'
  WHEN (SELECT COALESCE(sum(octet_length(payload::text)),0) FROM policy_payloads)>2097152 THEN 'policy_pool_cap'
  WHEN (SELECT COALESCE(sum(octet_length(id::text)+2),0) FROM frame)
    +(SELECT COALESCE(sum(octet_length(payload::text)),0) FROM fee_payloads)
    +(SELECT COALESCE(sum(octet_length(payload::text)),0) FROM policy_payloads)
    +(SELECT COALESCE(sum(bytes),0) FROM source_limits)>7864320 THEN 'draw_pool_cap'
  ELSE NULL END AS reason
)
SELECT statement_timestamp() AS as_of,limits.reason,
 CASE WHEN limits.reason IS NULL THEN (SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM frame) ELSE '[]'::jsonb END AS population_ids,
 CASE WHEN limits.reason IS NULL THEN (SELECT COALESCE(jsonb_agg(payload ORDER BY id),'[]'::jsonb) FROM fee_payloads) ELSE '[]'::jsonb END AS fees,
 CASE WHEN limits.reason IS NULL THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'institutionId',p.institution_id,'policy',p.payload,
  'feeIds',(SELECT jsonb_agg(id ORDER BY id) FROM sample s WHERE s.institution_id=p.institution_id),
  'sources',(SELECT COALESCE(jsonb_agg(payload ORDER BY id),'[]'::jsonb) FROM source_rows s WHERE s.institution_id=p.institution_id)
 ) ORDER BY p.institution_id),'[]'::jsonb) FROM policy_payloads p) ELSE '[]'::jsonb END AS groups
FROM limits`;

/** Generic appends remain bound to a real executing step of this protocol, never a reader. */
export async function appendLiveAuditEvent<T>(db: SqlTag, context: LiveAuditContext, eventType: string, detail: T, status = "completed", maxBytes: number = LIMITS.eventBytes): Promise<number> {
  if (!positiveId(context.runId) || !positiveId(context.stepId) || !Object.values(EVENTS).includes(eventType as never)) throw new Error("live_audit_producer_identity");
  const key = context.stepKey;
  const isDraw = key === STEPS.draw;
  const capture = key === STEPS.capture;
  const maintenance = key === "atlas-storage-retention";
  const archive = key === STEPS.archive;
  if (![...Object.values(STEPS), "atlas-storage-retention"].includes(key)) throw new Error("live_audit_wrong_step");
  const allowed:Record<string,string[]>={
    [EVENTS.draw]:[STEPS.draw],[EVENTS.claim]:[STEPS.observe],[EVENTS.chunk]:[STEPS.observe],[EVENTS.capture]:[STEPS.observe],
    [EVENTS.captureClaim]:[STEPS.capture],[EVENTS.disposition]:[STEPS.capture,STEPS.archive],
    [EVENTS.final]:[STEPS.archive],[EVENTS.archived]:[STEPS.archive],[EVENTS.unavailable]:["atlas-storage-retention"],
  };
  if(!allowed[eventType]?.includes(key))throw new Error("live_audit_wrong_step");
  const [row] = await db<{ id: string }[]>`
    INSERT INTO agent_run_events (agent_run_id,step_id,event_type,status,message,detail,created_at)
    SELECT r.id,s.id,${eventType},${status},'Live-source diagnostic receipt.',${boundedAuditJson(detail,maxBytes)}::jsonb,clock_timestamp()
    FROM agent_runs r JOIN agent_run_steps s ON s.agent_run_id=r.id
    WHERE r.id=${context.runId} AND s.id=${context.stepId} AND s.step_key=${key}
      AND r.run_kind='workflow' AND r.status='running' AND s.status='running'
      AND r.agent_name=ANY(${archive ? ["atlas","magellan"] : [capture ? "magellan" : "atlas"]}::text[])
      AND s.agent_name=${capture?"magellan":"atlas"}
      AND r.params_json->>'source'=${isDraw || maintenance ? "atlas.scoreboard" : LIVE_AUDIT_SOURCE}
    RETURNING id
  `;
  const id = dbId(row?.id); if (!id) throw new Error("live_audit_receipt_not_persisted"); return id;
}

export async function latestLiveAuditDraw(db: SqlTag = sql, day?: string): Promise<LiveAuditDrawEvent | null> {
  const [row] = await db<Row[]>`
    SELECT e.id,e.created_at,CASE WHEN octet_length(e.detail::text)<=${LIMITS.drawBytes} THEN e.detail ELSE NULL END AS detail,
      (s.agent_run_id=e.agent_run_id AND s.step_key=${STEPS.draw} AND r.agent_name='atlas' AND r.run_kind='workflow'
       AND r.params_json->>'source'='atlas.scoreboard') AS valid
    FROM agent_run_events e LEFT JOIN agent_run_steps s ON s.id=e.step_id LEFT JOIN agent_runs r ON r.id=e.agent_run_id
    WHERE e.event_type=${EVENTS.draw} AND (${day ?? null}::text IS NULL OR e.detail->>'day'=${day ?? null})
    ORDER BY e.created_at DESC,e.id DESC LIMIT 1
  `;
  if (!row) return null;
  const id = dbId(row.id); const detail = row.detail as LiveAuditDraw | null;
  const invalid = { id: id ?? 0, detail: null, createdAt: iso(row.created_at), valid: false, reason: "latest_draw_malformed_or_unbound" };
  if (!id || !row.valid || !detail || detail.protocol !== LIVE_SOURCE_AUDIT_PROTOCOL || detail.series !== LIVE_SOURCE_AUDIT_SERIES) return invalid;
  try {
    boundedAuditJson(detail,LIMITS.drawBytes);
    const rebuilt = makeLiveAuditDraw({ day: detail.day, asOf: detail.asOf, seed: detail.seed, populationIds: detail.populationIds,
      rows: detail.rows, groups: detail.groups, unavailableReason: detail.state === "unavailable" ? detail.reason ?? "unavailable" : undefined });
    if (auditHash(rebuilt)!==auditHash(detail)) return invalid;
    return { id,detail,createdAt:iso(row.created_at),valid:true };
  } catch { return invalid; }
}

export async function createLiveAuditDraw(options: { db?: SqlTag; context: LiveAuditContext; now?: Date; seed?: string }): Promise<LiveAuditDrawEvent> {
  const db=options.db ?? sql; const day=(options.now ?? new Date()).toISOString().slice(0,10);
  return liveAuditTransaction(db,async(tx)=>{
    await lockLiveAudit(tx,`draw:${LIVE_SOURCE_AUDIT_SERIES}:${day}`);
    const existing=await latestLiveAuditDraw(tx,day); if(existing)return existing;
    const seed=options.seed ?? randomBytes(32).toString("hex");
    const [frame]=await tx.unsafe<Row[]>(FRAME_SQL,[seed]);
    const asOf=iso(frame?.as_of ?? options.now ?? new Date());
    let reason=frame?.reason == null ? undefined : String(frame.reason);
    let rows: LiveAuditFee[]=[],groups: LiveAuditGroup[]=[];
    try {
      rows=((frame?.fees ?? []) as Array<{ catalog: LiveAuditCatalogRow; source: LiveAuditSourceIdentity; lineShare: string|null }>).map((r)=>freezeLiveAuditFee(r.catalog,r.source,r.lineShare));
      groups=((frame?.groups ?? []) as Array<Omit<LiveAuditGroup,"policyFingerprint">>).map((g)=>({...g,policyFingerprint:liveAuditPolicyFingerprint(g.policy)}));
    } catch(error){reason=error instanceof Error ? error.message : "frame_unavailable";}
    const draw=makeLiveAuditDraw({day,asOf,seed,populationIds:(frame?.population_ids ?? []) as number[],rows,groups,unavailableReason:reason});
    const id=await appendLiveAuditEvent(tx,options.context,EVENTS.draw,draw,"completed",LIMITS.drawBytes);
    return {id,detail:draw,valid:true,createdAt:new Date().toISOString()};
  });
}

/** Current comparison is one SQL snapshot, including semantic policy and exact edition. */
export async function currentLiveAuditMatches(db: SqlTag, rows: LiveAuditFee[], groups: LiveAuditGroup[]): Promise<Map<number,boolean>> {
  const state=await currentLiveAuditState(db,rows,groups);
  return new Map([...state].map(([id,value])=>[id,value.matches]));
}
export async function currentLiveAuditState(db: SqlTag, rows: LiveAuditFee[], groups: LiveAuditGroup[]): Promise<Map<number,{matches:boolean;stateHash:string}>> {
  if(rows.length>LIMITS.sample || groups.length>LIMITS.sample)throw new Error("live_audit_current_inventory_cap");
  const expected=rows.map((fee)=>({id:fee.id,institution_id:fee.institutionId,payload:{catalog:fee.catalog,source:fee.source,lineShare:fee.lineShare}}));
  const policies=groups.map(g=>({institution_id:g.institutionId,policy:g.policy}));
  const result=await db.unsafe<{id:string;matches:boolean;state_hash:string}[]>(`WITH expected AS(SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id bigint,institution_id bigint,payload jsonb)),
    policies AS(SELECT * FROM jsonb_to_recordset($2::jsonb) AS p(institution_id bigint,policy jsonb))
    SELECT expected.id,(${LIVE_AUDIT_FEE_PAYLOAD_SQL}=expected.payload AND ${LIVE_AUDIT_POLICY_SQL}=policies.policy) AS matches,${LIVE_AUDIT_CURRENT_STATE_SQL} AS state_hash
    FROM expected LEFT JOIN policies ON policies.institution_id=expected.institution_id LEFT JOIN published_fee_catalog c ON c.id=expected.id ${FEE_JOINS}
    LEFT JOIN institution_sources inst ON inst.id=c.institution_id ${POLICY_JOINS}`,[boundedAuditJson(expected,LIMITS.drawBytes),boundedAuditJson(policies,LIMITS.policiesBytes)]);
  return new Map(result.map((r)=>[Number(r.id),{matches:r.matches===true,stateHash:r.state_hash}]));
}

/** Load exactly one immutable origin; malformed detail never authorizes older evidence. */
export async function liveAuditDrawById(db: SqlTag, id: number): Promise<LiveAuditDrawEvent | null> {
  if(!positiveId(id))return null;
  const [header]=await db<Row[]>`SELECT detail->>'day' AS day FROM agent_run_events WHERE id=${id} AND event_type=${EVENTS.draw}`;
  if(!header)return null;
  const latest=await latestLiveAuditDraw(db,String(header.day));
  return latest?.id===id?latest:{id,detail:null,createdAt:"",valid:false,reason:"draw_superseded_or_malformed"};
}

const emptyProgress=():LiveAuditProgress=>({valid:true,reason:null,cursor:0,graphBytes:0,observations:[],chunks:[],captureRequestIds:[],observationOrigins:{}});
const badProgress=(reason:string):LiveAuditProgress=>({...emptyProgress(),valid:false,reason});

/** Bound headers/count/aggregate bytes before moving event JSON into application memory. */
export async function readLiveAuditProgress(db:SqlTag,origin:LiveAuditDrawEvent):Promise<LiveAuditProgress> {
  if(!origin.valid||!origin.detail)return badProgress("draw_unavailable");
  const rows=await db<Row[]>`WITH headers AS MATERIALIZED (
    SELECT e.id,e.created_at,e.step_id,e.agent_run_id,octet_length(e.detail::text) AS bytes,
      e.detail FROM agent_run_events e WHERE e.event_type=${EVENTS.chunk}
      AND e.detail->>'drawId'=${String(origin.id)} ORDER BY e.id LIMIT 501
  ), limits AS (SELECT count(*) AS n,COALESCE(sum(bytes),0) AS bytes FROM headers)
  SELECT h.id,h.created_at,h.agent_run_id,h.step_id,CASE WHEN l.n<=500 AND l.bytes<=${LIMITS.drawBytes} AND h.bytes<=${LIMITS.eventBytes} THEN h.detail ELSE NULL END AS detail,
    CASE WHEN octet_length(c.detail::text)<=8192 THEN c.detail ELSE NULL END AS claim_detail,c.agent_run_id AS claim_run_id,c.step_id AS claim_step_id,
    (cs.agent_run_id=c.agent_run_id AND cs.step_key=${STEPS.observe} AND cr.agent_name='atlas' AND cr.run_kind='workflow'
      AND cr.params_json->>'source'=${LIVE_AUDIT_SOURCE} AND c.created_at<=h.created_at) AS claim_valid,
    (s.agent_run_id=h.agent_run_id AND s.step_key=${STEPS.observe} AND r.agent_name='atlas' AND r.run_kind='workflow'
      AND r.params_json->>'source'=${LIVE_AUDIT_SOURCE}) AS valid
  FROM headers h CROSS JOIN limits l LEFT JOIN agent_run_steps s ON s.id=h.step_id LEFT JOIN agent_runs r ON r.id=h.agent_run_id
  LEFT JOIN agent_run_events c ON c.id=CASE WHEN h.detail->>'claimId' ~ '^[1-9][0-9]{0,17}$' THEN (h.detail->>'claimId')::bigint ELSE 0 END
    AND c.event_type=${EVENTS.claim} LEFT JOIN agent_run_steps cs ON cs.id=c.step_id LEFT JOIN agent_runs cr ON cr.id=c.agent_run_id ORDER BY h.id`;
  const progress=emptyProgress();const draw=origin.detail;
  for(const row of rows){
    const parsed=liveAuditChunkShape.safeParse(row.detail);const id=dbId(row.id);
    if(!id||!row.valid||!parsed.success)return badProgress("chunk_origin_or_shape");
    const chunk=parsed.data;
    if(chunk.drawId!==origin.id||chunk.fromGroup!==progress.cursor||chunk.nextGroup<=chunk.fromGroup||chunk.nextGroup>draw.groups.length
      ||chunk.nextGroup-chunk.fromGroup>LIMITS.groupsPerChunk)return badProgress("chunk_cursor");
    const fees=draw.groups.slice(chunk.fromGroup,chunk.nextGroup).flatMap((g)=>g.feeIds);
    if(fees.length!==chunk.observations.length||new Set(chunk.observations.map((o)=>o.feeId)).size!==fees.length
      ||chunk.observations.some((o)=>!fees.includes(o.feeId)||!validLiveAuditObservation(o,draw,iso(row.created_at))
        ||o.graphHash!==null&&!chunk.graphHashes.includes(o.graphHash)))return badProgress("chunk_fee_identity");
    try {
      const bytes=chunk.graphs.reduce((n,g)=>n+Buffer.byteLength(boundedAuditJson(g,LIMITS.graphBytes)),0);
      if(bytes!==chunk.graphBytes||chunk.graphs.some((g,i)=>auditHash(g)!==chunk.graphHashes[i])||chunk.graphs.length!==chunk.graphHashes.length)return badProgress("chunk_graph_identity");
      progress.graphBytes+=bytes;if(progress.graphBytes>LIMITS.graphsBytes)return badProgress("draw_graph_cap");
      progress.chunks.push({id,hash:auditHash(chunk)});
    } catch{return badProgress("chunk_payload_cap");}
    // Prove the immutable claim belonged to this producer; a matching JSON claimId is insufficient.
    const c=liveAuditClaimShape.safeParse(row.claim_detail);
    if(!c.success||!row.claim_valid||c.data.drawId!==origin.id||c.data.fromGroup!==chunk.fromGroup||c.data.throughGroup<chunk.nextGroup
      ||Date.parse(c.data.leaseUntil)<Date.parse(iso(row.created_at))
      ||dbId(row.claim_run_id)!==c.data.ownerRunId||dbId(row.claim_step_id)!==c.data.ownerStepId
      ||dbId(row.agent_run_id)!==c.data.ownerRunId||dbId(row.step_id)!==c.data.ownerStepId)return badProgress("chunk_claim_origin");
    progress.cursor=chunk.nextGroup;progress.observations.push(...chunk.observations);
    for(const observation of chunk.observations)progress.observationOrigins![observation.feeId]=id;
    progress.captureRequestIds.push(...chunk.captureRequestIds);
  }
  return progress;
}

export async function claimLiveAuditChunk(options:{db?:SqlTag;context:LiveAuditContext;drawId:number}):Promise<{origin:LiveAuditDrawEvent;claim:LiveAuditClaim;graphBytes:number}|null>{
  const db=options.db??sql;
  return liveAuditTransaction(db,async(tx)=>{
    await lockLiveAudit(tx,`progress:${options.drawId}`);
    const origin=await liveAuditDrawById(tx,options.drawId);if(!origin?.valid||!origin.detail||origin.detail.state!=="ready")return null;
    const [{now}]=await tx<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    if(now.getTime()>=Date.parse(origin.detail.deadline))return null;
    const progress=await readLiveAuditProgress(tx,origin);if(!progress.valid||progress.cursor>=origin.detail.groups.length)return null;
    const [row]=await tx<Row[]>`SELECT e.id,CASE WHEN octet_length(e.detail::text)<=8192 THEN e.detail ELSE NULL END AS detail,
      (s.agent_run_id=e.agent_run_id AND s.step_key=${STEPS.observe} AND r.agent_name='atlas' AND r.run_kind='workflow'
       AND r.params_json->>'source'=${LIVE_AUDIT_SOURCE} AND e.agent_run_id::text=e.detail->>'ownerRunId'
       AND e.step_id::text=e.detail->>'ownerStepId') AS valid
      FROM agent_run_events e LEFT JOIN agent_run_steps s ON s.id=e.step_id LEFT JOIN agent_runs r ON r.id=e.agent_run_id
      WHERE e.event_type=${EVENTS.claim} AND e.detail->>'drawId'=${String(options.drawId)} ORDER BY e.id DESC LIMIT 1`;
    if(row){const latest=liveAuditClaimShape.safeParse(row.detail);if(!row.valid||!latest.success)return null;
      if(latest.data.fromGroup===progress.cursor&&Date.parse(latest.data.leaseUntil)>now.getTime())return null;}
    const claim={protocol:1 as const,series:LIVE_SOURCE_AUDIT_SERIES,drawId:origin.id,fromGroup:progress.cursor,
      throughGroup:Math.min(origin.detail.groups.length,progress.cursor+LIMITS.groupsPerChunk),ownerRunId:options.context.runId,
      ownerStepId:options.context.stepId,leaseUntil:new Date(Math.min(now.getTime()+LIMITS.leaseMs,Date.parse(origin.detail.deadline))).toISOString()};
    const eventId=await appendLiveAuditEvent(tx,options.context,EVENTS.claim,claim);
    return {origin,claim:{...claim,eventId},graphBytes:progress.graphBytes};
  });
}

/** One locked generation, one write snapshot. Drift becomes unknown; it is never borrowed support. */
export async function settleLiveAuditChunk(options:{db?:SqlTag;context:LiveAuditContext;origin:LiveAuditDrawEvent;claim:LiveAuditClaim;
  nextGroup:number;observations:LiveAuditObservation[];graphs:Record<string,unknown>[];deadline?:number;afterInsert?:(tx:SqlTag,id:number)=>Promise<void>}):Promise<number|null>{
  const db=options.db??sql;const {origin,claim,context}=options;const draw=origin.detail;
  if(!origin.valid||!draw||claim.drawId!==origin.id||claim.ownerRunId!==context.runId||claim.ownerStepId!==context.stepId
    ||options.nextGroup<=claim.fromGroup||options.nextGroup>claim.throughGroup)throw new Error("live_audit_settlement_identity");
  const expectedIds=draw.groups.slice(claim.fromGroup,options.nextGroup).flatMap((g)=>g.feeIds);
  if(expectedIds.length!==options.observations.length||new Set(options.observations.map((o)=>o.feeId)).size!==expectedIds.length
    ||options.observations.some((o)=>!expectedIds.includes(o.feeId)||!validLiveAuditObservation(o,draw,new Date().toISOString())))throw new Error("live_audit_settlement_inventory");
  const graphBytes=options.graphs.reduce((n,g)=>n+Buffer.byteLength(boundedAuditJson(g,LIMITS.graphBytes)),0);
  const graphHashes=options.graphs.map(auditHash);
  if(options.observations.some(o=>o.graphHash!==null&&!graphHashes.includes(o.graphHash)))throw new Error("live_audit_settlement_graph_origin");
  const chunk:LiveAuditChunk={protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId:origin.id,claimId:claim.eventId,
    fromGroup:claim.fromGroup,nextGroup:options.nextGroup,observations:options.observations,graphBytes,
    graphs:options.graphs,graphHashes,captureRequestIds:[]};
  boundedAuditJson(chunk,LIMITS.eventBytes);
  return liveAuditTransaction(db,async(tx)=>{
    await lockLiveAudit(tx,`progress:${origin.id}`);
    const actualOrigin=await liveAuditDrawById(tx,origin.id);
    if(!actualOrigin?.valid||!actualOrigin.detail||auditHash(actualOrigin.detail)!==auditHash(draw))return null;
    const progress=await readLiveAuditProgress(tx,origin);if(!progress.valid||progress.cursor!==claim.fromGroup||progress.graphBytes+graphBytes>LIMITS.graphsBytes)return null;
    const [last]=await tx<Row[]>`SELECT e.id,e.detail,(s.agent_run_id=e.agent_run_id AND s.step_key=${STEPS.observe}
      AND r.agent_name='atlas' AND r.run_kind='workflow' AND r.params_json->>'source'=${LIVE_AUDIT_SOURCE}
      AND e.agent_run_id=${context.runId} AND e.step_id=${context.stepId}) AS valid
      FROM agent_run_events e LEFT JOIN agent_run_steps s ON s.id=e.step_id LEFT JOIN agent_runs r ON r.id=e.agent_run_id
      WHERE e.event_type=${EVENTS.claim} AND e.detail->>'drawId'=${String(origin.id)} ORDER BY e.id DESC LIMIT 1`;
    const {eventId:claimEventId,...claimDetail}=claim;
    if(!last?.valid||dbId(last.id)!==claimEventId||auditHash(last.detail)!==auditHash(claimDetail))return null;
    const fees=draw.rows.filter((f)=>expectedIds.includes(f.id));
    const expected=fees.map((fee)=>({id:fee.id,institution_id:fee.institutionId,payload:{catalog:fee.catalog,source:fee.source,lineShare:fee.lineShare}}));
    const policies=draw.groups.map(g=>({institution_id:g.institutionId,policy:g.policy}));
    const [result]=await tx.unsafe<Row[]>(`WITH expected AS MATERIALIZED (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id bigint,institution_id bigint,payload jsonb)),
      policies AS MATERIALIZED(SELECT * FROM jsonb_to_recordset($10::jsonb) AS p(institution_id bigint,policy jsonb)),
      matched AS MATERIALIZED (SELECT expected.id,(${LIVE_AUDIT_FEE_PAYLOAD_SQL}=expected.payload AND ${LIVE_AUDIT_POLICY_SQL}=policies.policy) AS matches
        FROM expected LEFT JOIN policies ON policies.institution_id=expected.institution_id LEFT JOIN published_fee_catalog c ON c.id=expected.id ${FEE_JOINS}
        LEFT JOIN institution_sources inst ON inst.id=c.institution_id ${POLICY_JOINS}),
      payload AS (SELECT jsonb_set($2::jsonb,'{observations}',(SELECT jsonb_agg(CASE WHEN m.matches THEN o.value ELSE
        jsonb_set(jsonb_set(jsonb_set(jsonb_set(o.value,'{status}','"unknown"'::jsonb),'{reason}','"identity_changed_during_observation"'::jsonb),'{dimensions}','[]'::jsonb),'{sourceLine}','null'::jsonb) END ORDER BY o.ordinality)
        FROM jsonb_array_elements($2::jsonb->'observations') WITH ORDINALITY o(value,ordinality) JOIN matched m ON m.id=(o.value->>'feeId')::bigint)) AS detail)
      INSERT INTO agent_run_events(agent_run_id,step_id,event_type,status,message,detail,created_at)
      SELECT r.id,s.id,$3,'completed','Live-source observation chunk.',p.detail,clock_timestamp()
      FROM agent_runs r JOIN agent_run_steps s ON s.agent_run_id=r.id CROSS JOIN payload p
      WHERE r.id=$4 AND s.id=$5 AND r.status='running' AND s.status='running' AND s.step_key=$6
        AND r.agent_name='atlas' AND r.run_kind='workflow' AND r.params_json->>'source'=$7
        AND clock_timestamp()<$8::timestamptz AND clock_timestamp()<$9::timestamptz
      RETURNING id`,[boundedAuditJson(expected,LIMITS.drawBytes),boundedAuditJson(chunk,LIMITS.eventBytes),EVENTS.chunk,context.runId,context.stepId,STEPS.observe,LIVE_AUDIT_SOURCE,claim.leaseUntil,draw.deadline,boundedAuditJson(policies,LIMITS.policiesBytes)]);
    const id=dbId(result?.id);if(id&&options.afterInsert)await options.afterInsert(tx,id);
    return id;
  },options.deadline);
}
