import type { sql as Sql } from "@/lib/data-store/connection";
import { SOURCE_CHECK_NAME } from "./checkers";
import { CATEGORY_GUARD_RULES } from "@/lib/fee-category-guard";
import { releaseCategoryPattern } from "@/lib/agents/darwin/release-held";
import { inSavepoint } from "@/lib/agents/savepoint";
import {
  CASE_BYTE_CAP, CORRECTIVE_CHECK, CORRECTIVE_KIND, METADATA_BYTE_CAP, SOURCE_BYTE_CAP, SOURCE_CODEPOINT_CAP,
  SOURCE_PHASE_BYTE_CAP, evidenceHash, encodedBytes, fixtureArtifact, replayCorrective, validCorrectiveReceipt,
  type CorrectiveDocument, type CorrectiveInput, type CorrectiveReceipt, type FixtureArtifact, type FixtureCase,
} from "./corrective-source";

type Db = typeof Sql;
const SUPPORTED_CATEGORIES = Object.keys(CATEGORY_GUARD_RULES).filter((key) => releaseCategoryPattern(key)).map((key) => `'${key.replaceAll("'", "''")}'`).join(",");
const FEE_CONTEXT = `jsonb_build_object('amount_kind',old.amount_kind,'rate_percent',old.rate_percent,'fee_audience',old.fee_audience,'variant_type',old.variant_type,'fee_treatment',old.fee_treatment,'account_product_type',to_jsonb(old)->'account_product_type','product_name',to_jsonb(old)->'product_name',
 'lineage_product_name',fr.product_name,'lineage_conditions',fr.conditions,'lineage_waiver_text',fr.waiver_text,
 'lineage_raw_id',fr.fee_raw_id,'lineage_document_id',fr.source_document_id,'original_normalization_binding','unknown')`;
const CANONICAL = `jsonb_build_object('id',c.id,'created_at',c.created_at,'fee_chain_id',c.fee_chain_id,'version',c.version,'action',c.action,'institution_id',c.institution_id,'fee_audience',c.fee_audience,'variant_type',c.variant_type,'previous_fee_published_id',c.previous_fee_published_id,'fee_published_id',c.fee_published_id,'before_canonical_fee_key',c.before_canonical_fee_key,'before_fee_name',c.before_fee_name,'before_amount',c.before_amount,'before_frequency',c.before_frequency,'before_conditions',c.before_conditions,'canonical_fee_key',c.canonical_fee_key,'fee_name',c.fee_name,'amount',c.amount,'frequency',c.frequency,'conditions',c.conditions,'source_document_id',c.source_document_id,'source_excerpt',c.source_excerpt,'source_location',c.source_location,'reason',c.reason,'actor_user_id',c.actor_user_id,'actor_name',c.actor_name,'idempotency_key',c.idempotency_key)`;
const ORIGIN = `jsonb_build_object(
 'run',jsonb_build_object('id',r.id,'agent_name',r.agent_name,'run_kind',r.run_kind,'status',r.status,'trigger_source',r.trigger_source,'triggered_by',r.triggered_by,'params_json',r.params_json,'started_at',r.started_at,'completed_at',r.completed_at),
 'step',jsonb_build_object('id',s.id,'agent_run_id',s.agent_run_id,'agent_name',s.agent_name,'step_key',s.step_key,'status',s.status,'input_payload',s.input_payload,'started_at',s.started_at,'completed_at',s.completed_at),
 'event',jsonb_build_object('id',e.id,'agent_run_id',e.agent_run_id,'step_id',e.step_id,'event_type',e.event_type,'status',e.status,'detail',e.detail,'created_at',e.created_at),
 'feedback',jsonb_build_object('id',f.id,'agent_run_id',f.agent_run_id,'reported_by',f.reported_by,'kind',f.kind,'signal',f.signal,'check_name',f.check_name,'dedupe_key',f.dedupe_key,'institution_id',f.institution_id,'source_document_id',f.source_document_id,'fee_published_id',f.fee_published_id,'canonical_fee_key',f.canonical_fee_key,'amount',f.amount,'evidence',f.evidence,'created_at',f.created_at))`;
const BEFORE = `jsonb_build_object('canonicalFeeKey',c.before_canonical_fee_key,'feeName',c.before_fee_name,'amount',c.before_amount,'frequency',c.before_frequency,'conditions',c.before_conditions)`;
const AFTER = `jsonb_build_object('canonicalFeeKey',c.canonical_fee_key,'feeName',c.fee_name,'amount',c.amount,'frequency',c.frequency,'conditions',c.conditions)`;
const DETAIL = `jsonb_build_object('action','correct','institution_id',c.institution_id,'actor_id',c.actor_user_id,'actor',c.actor_name,
 'fee_published_id',c.previous_fee_published_id,'fee_chain_id',c.fee_chain_id,'version',c.version,'reason',c.reason,'before',${BEFORE},'after',${AFTER})`;
// Matches the same explicit provenance contract as the pure replay; evaluated before either LIMIT.
const SNAPSHOT_ORIGIN = `
 p->'origin'->'run'->>'agent_name'='hamilton' AND p->'origin'->'run'->>'run_kind'='manual_repair'
 AND p->'origin'->'run'->>'status'='completed' AND p->'origin'->'run'->>'trigger_source'='admin'
 AND p->'origin'->'run'->>'triggered_by'='user:'||c.actor_user_id::text
 AND p->'origin'->'step'->>'agent_name'='hamilton' AND p->'origin'->'step'->>'step_key'='admin.fee_correct'
 AND p->'origin'->'step'->>'status'='completed'
 AND p->'origin'->'step'->'agent_run_id'=p->'origin'->'run'->'id'
 AND p->'origin'->'event'->'agent_run_id'=p->'origin'->'run'->'id'
 AND p->'origin'->'event'->'step_id'=p->'origin'->'step'->'id'
 AND p->'origin'->'event'->>'event_type'='fee.correct' AND p->'origin'->'event'->>'status'='completed'
 AND p->'origin'->'feedback'->'agent_run_id'=p->'origin'->'run'->'id'
 AND p->'origin'->'feedback'->>'kind'='admin_correction' AND p->'origin'->'feedback'->>'reported_by'='human'
 AND p->'origin'->'feedback'->>'signal'='wrong' AND p->'origin'->'feedback'->>'check_name'='admin.fee_correction'
 AND p->'origin'->'feedback'->>'dedupe_key'='admin.fee_correction:'||c.id::text
 AND p->'origin'->'feedback'->'institution_id'=to_jsonb(c.institution_id)
 AND p->'origin'->'feedback'->'source_document_id'=to_jsonb(c.source_document_id)
 AND p->'origin'->'feedback'->'fee_published_id'=to_jsonb(c.previous_fee_published_id)
 AND p->'origin'->'feedback'->'canonical_fee_key'=to_jsonb(c.before_canonical_fee_key)
 AND p->'origin'->'feedback'->'amount'=to_jsonb(c.before_amount)
 AND p->'origin'->'run'->'params_json'=${DETAIL}
 AND p->'origin'->'step'->'input_payload'=${DETAIL}
 AND p->'origin'->'event'->'detail'=${DETAIL}
 AND p->'origin'->'feedback'->'evidence' @> jsonb_build_object('action','correct','correction_id',c.id,'fee_chain_id',c.fee_chain_id,'version',c.version,
   'new_fee_published_id',c.fee_published_id,'actor_id',c.actor_user_id,'actor',c.actor_name,'reason',c.reason,
   'source_excerpt',c.source_excerpt,'source_location',c.source_location,'before',${BEFORE},'after',${AFTER})
 AND jsonb_typeof(p->'origin'->'run'->'id')='number' AND p->'origin'->'run'->>'id' ~ '^[1-9][0-9]{0,14}$'
 AND jsonb_typeof(p->'origin'->'step'->'id')='number' AND p->'origin'->'step'->>'id' ~ '^[1-9][0-9]{0,14}$'
 AND jsonb_typeof(p->'origin'->'event'->'id')='number' AND p->'origin'->'event'->>'id' ~ '^[1-9][0-9]{0,14}$'
 AND jsonb_typeof(p->'origin'->'feedback'->'id')='number' AND p->'origin'->'feedback'->>'id' ~ '^[1-9][0-9]{0,14}$'`;
const ORIGIN_JOINS = `
 JOIN agent_runs r ON r.id::text=origin->'run'->>'id'
 JOIN agent_run_steps s ON s.id::text=origin->'step'->>'id'
 JOIN agent_run_events e ON e.id::text=origin->'event'->>'id'
 JOIN pipeline_feedback f ON f.id::text=origin->'feedback'->>'id'`;

/** Short SQL-only scope. A caught statement error must not poison the caller's ledger/action transaction. */
async function scope<T>(db: Db, work: (tx: Db) => Promise<T>): Promise<T> {
  const run = async (tx: Db) => {
    const [prior] = await tx`SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock`;
    await tx`SELECT set_config('statement_timeout','2000',true),set_config('lock_timeout','100',true)`;
    const result = await work(tx);
    await tx`SELECT set_config('statement_timeout',${String(prior.statement)},true),set_config('lock_timeout',${String(prior.lock)},true)`;
    return result;
  };
  return typeof (db as unknown as { savepoint?: unknown }).savepoint === "function"
    ? inSavepoint(db, run)
    : db.begin((tx) => run(tx as unknown as Db)) as Promise<T>;
}

/** Called only while the new correction is uncommitted, never a historical repair. */
export async function sealCorrectiveSource(tx: Db, input: { correctionId: number; runId: number; stepId: number | null; document: CorrectiveDocument }): Promise<boolean> {
  const rows = await tx.unsafe<Array<{ canonical: Record<string, unknown>; fee_context: Record<string, unknown>; origin: Record<string, unknown> }>>(`
    SELECT ${CANONICAL} AS canonical,${ORIGIN} AS origin,${FEE_CONTEXT} AS fee_context
    FROM published_fee_corrections c
    JOIN published_fee_records old ON old.fee_published_id=c.previous_fee_published_id
    LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id=old.lineage_ref AND fv.institution_id=old.institution_id
    LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id AND fr.institution_id=old.institution_id
    JOIN agent_runs r ON r.id=c.agent_run_id
    JOIN agent_run_steps s ON s.agent_run_id=r.id AND s.id=$3
    JOIN agent_run_events e ON e.agent_run_id=r.id AND e.step_id=s.id AND e.event_type='fee.correct'
    JOIN pipeline_feedback f ON f.dedupe_key='admin.fee_correction:'||c.id::text
    WHERE c.id=$1 AND c.agent_run_id=$2 AND c.action='correct' AND c.xmin=pg_current_xact_id()::xid`, [input.correctionId, input.runId, input.stepId]);
  if (rows.length !== 1) return false;
  const payload = { context: "human_validated_edition" as const, originalExtractionBinding: "unknown" as const, canonical: rows[0].canonical, feeContext: rows[0].fee_context, documents: [input.document], origin: rows[0].origin };
  const receipt = { protocol: 2 as const, payload, digest: "0".repeat(64), databaseDigest: "0".repeat(64) };
  if (!validCorrectiveReceipt(receipt)) return false;
  // A single final statement guards the exact originally checked AST/body and actual origin after
  // any preceding lock wait. The existing correction's validation/permission semantics do not change.
  const sealed = await tx.unsafe(`
    UPDATE published_fee_corrections c SET source_check=c.source_check || jsonb_build_object('deming_source_v2',
      $2::jsonb || jsonb_build_object('digest',encode(digest(($2::jsonb->'payload')::text,'sha256'),'hex'),'databaseDigest',encode(digest(($2::jsonb->'payload')::text,'sha256'),'hex')))
    FROM agent_runs r,agent_run_steps s,agent_run_events e,pipeline_feedback f,source_documents d,agent_source_texts a,published_fee_records old
    LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id=old.lineage_ref AND fv.institution_id=old.institution_id
    LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id AND fr.institution_id=old.institution_id
    WHERE c.id=$1 AND c.action='correct' AND c.xmin=pg_current_xact_id()::xid AND NOT(c.source_check ? 'deming_source_v2')
      AND ${CANONICAL}=$2::jsonb->'payload'->'canonical'
      AND old.fee_published_id=c.previous_fee_published_id AND ${FEE_CONTEXT}=$2::jsonb->'payload'->'feeContext'
      AND r.id=c.agent_run_id AND s.id=$3 AND s.agent_run_id=r.id AND e.step_id=s.id AND e.agent_run_id=r.id
      AND e.id::text=$2::jsonb->'payload'->'origin'->'event'->>'id'
      AND f.dedupe_key='admin.fee_correction:'||c.id::text AND ${ORIGIN}=$2::jsonb->'payload'->'origin'
      AND d.id=$4 AND d.institution_id=c.institution_id AND d.document_url=$5 AND d.content_hash=$6
      AND a.id=$7 AND a.source_document_id=d.id AND a.institution_id=c.institution_id AND a.status='completed'
      AND a.source_hash=$6 AND a.text_hash=$8 AND a.normalized_text=$9
      AND a.id=(SELECT id FROM agent_source_texts WHERE source_document_id=d.id AND status='completed' AND normalized_text IS NOT NULL ORDER BY id DESC LIMIT 1)
    RETURNING c.id`, [input.correctionId, JSON.stringify(receipt), input.stepId, input.document.id, input.document.documentUrl,
    input.document.contentHash, input.document.astId, input.document.textHash, input.document.normalizedText]);
  return sealed.length === 1;
}

/** This optional observer cannot roll back the already authorized correction. */
export async function captureCorrectiveSource(tx: Db, input: Parameters<typeof sealCorrectiveSource>[1]): Promise<void> {
  try {
    const sealed = await scope(tx, (sp) => sealCorrectiveSource(sp, input));
    if (sealed) return;
  } catch {
    // Rollback to the real savepoint has completed before this safe, bounded diagnostic write.
  }
  try {
    await inSavepoint(tx, async (sp) => {
      await sp`UPDATE published_fee_corrections SET source_check=source_check || ${JSON.stringify({ deming_source_v2: { protocol: 2, state: "unavailable", reason: "snapshot_unavailable" } })}::jsonb
        WHERE id=${input.correctionId} AND xmin=pg_current_xact_id()::xid AND NOT(source_check ? 'deming_source_v2')`;
    });
  } catch {
    // Missing component is unavailable to every consumer too. Never retry the fee action.
  }
}

// Shape/cheap text limits run before encoding/digest work. No full rejected body crosses the DB.
// CASE avoids array_length/casts on JSON scalar/string packets. The single-document context is
// deliberately different from the old generic bank-wide snapshots.
const ADMITTED = `WITH admissible AS MATERIALIZED (
 SELECT c.id,c.institution_id,c.source_document_id,c.previous_fee_published_id,
   packet->>'databaseDigest' AS database_digest,octet_length(encoded)+512 AS case_bytes,
   p->'origin' AS origin,docmeta AS document
 FROM published_fee_corrections c
 CROSS JOIN LATERAL(SELECT c.source_check->'deming_source_v2' AS packet OFFSET 0) packet_cell
 CROSS JOIN LATERAL(SELECT CASE WHEN jsonb_typeof(packet)='object' AND packet->'protocol'='2'::jsonb
   AND jsonb_typeof(packet->'payload')='object' THEN packet->'payload' END AS p OFFSET 0) payload_cell
 CROSS JOIN LATERAL(SELECT CASE WHEN jsonb_typeof(p->'documents')='array' THEN
   CASE WHEN jsonb_array_length(p->'documents')=1 AND jsonb_typeof(p->'documents'->0)='object' THEN p->'documents'->0 END END AS document OFFSET 0) document_cell
 CROSS JOIN LATERAL(SELECT CASE WHEN jsonb_typeof(document->'normalizedText')='string'
   AND octet_length(document->>'normalizedText') BETWEEN 1 AND ${SOURCE_BYTE_CAP}
   AND length(document->>'normalizedText')<=${SOURCE_CODEPOINT_CAP} THEN document->>'normalizedText' END AS body OFFSET 0) body_cell
 CROSS JOIN LATERAL(SELECT CASE WHEN body IS NOT NULL THEN document-'normalizedText' END AS docmeta OFFSET 0) docmeta_cell
 CROSS JOIN LATERAL(SELECT CASE WHEN body IS NOT NULL THEN p::text END AS encoded,
   CASE WHEN body IS NOT NULL THEN jsonb_build_object('context',p->'context','originalExtractionBinding',p->'originalExtractionBinding',
     'canonical',p->'canonical','origin',p->'origin','feeContext',p->'feeContext','documents',jsonb_build_array(docmeta)) END AS metadata OFFSET 0) measured
 WHERE p->>'context'='human_validated_edition' AND p->>'originalExtractionBinding'='unknown'
   AND p->'canonical'=${CANONICAL}
   AND (${SNAPSHOT_ORIGIN})
   AND c.id BETWEEN 1 AND 9007199254740991 AND c.institution_id BETWEEN 1 AND 9007199254740991
   AND c.fee_chain_id BETWEEN 1 AND 9007199254740991 AND c.previous_fee_published_id BETWEEN 1 AND 9007199254740991
   AND c.fee_published_id BETWEEN 1 AND 9007199254740991 AND c.source_document_id BETWEEN 1 AND 9007199254740991
   AND c.actor_user_id BETWEEN 1 AND 9007199254740991
   AND p->'feeContext'->>'amount_kind'='flat' AND p->'feeContext'->'rate_percent'='null'::jsonb
   AND c.before_canonical_fee_key=c.canonical_fee_key AND c.canonical_fee_key IN(${SUPPORTED_CATEGORIES})
   AND c.before_frequency IS NOT DISTINCT FROM c.frequency AND c.before_conditions IS NOT DISTINCT FROM c.conditions
   AND c.before_amount IS NOT NULL AND c.before_amount::text NOT IN('NaN','Infinity','-Infinity')
   AND c.amount::text NOT IN('NaN','Infinity','-Infinity') AND (c.before_amount<>c.amount OR c.before_fee_name<>c.fee_name)
   AND octet_length(c.actor_name)<=200 AND octet_length(c.source_excerpt)<=4096 AND octet_length(c.source_location)<=1024
   AND octet_length(docmeta->>'documentUrl') BETWEEN 1 AND 2048
   AND octet_length(docmeta->>'contentHash') BETWEEN 1 AND 256
   AND CASE WHEN position(c.source_excerpt in body)>0 THEN true ELSE position(regexp_replace(c.source_excerpt,'\\s+',' ','g') in regexp_replace(body,'\\s+',' ','g'))>0 END
   AND (c.agent_run_id IS NULL OR c.agent_run_id::text=p->'origin'->'run'->>'id')
   AND docmeta->'id'=to_jsonb(c.source_document_id)
   AND docmeta->'institutionId'=to_jsonb(c.institution_id)
   AND docmeta->'astInstitutionId'=to_jsonb(c.institution_id)
   AND jsonb_typeof(docmeta->'astId')='number' AND docmeta->>'astId' ~ '^[1-9][0-9]{0,14}$'
   AND docmeta->>'status'='completed' AND docmeta->>'sourceHash'=docmeta->>'contentHash'
   AND docmeta->>'textHash'=encode(digest(body,'sha256'),'hex')
   AND packet->>'databaseDigest'=encode(digest(encoded,'sha256'),'hex')
   AND packet->>'digest'=packet->>'databaseDigest'
   AND octet_length(metadata::text)<=${METADATA_BYTE_CAP}
   AND octet_length(encoded)+512<=${CASE_BYTE_CAP}
   AND CASE WHEN jsonb_typeof(packet)='object' THEN NOT EXISTS(SELECT 1 FROM jsonb_object_keys(packet) k WHERE k NOT IN('protocol','payload','digest','databaseDigest')) ELSE false END
   AND CASE WHEN jsonb_typeof(p)='object' THEN NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('context','originalExtractionBinding','canonical','feeContext','documents','origin')) ELSE false END
   AND c.action='correct'
)`;
const ENROLLMENT = `${ADMITTED}, text_ids AS MATERIALIZED (
 SELECT DISTINCT document->>'astId' AS id FROM admissible
), current_texts AS MATERIALIZED (
 SELECT a.id,a.source_document_id,a.institution_id,a.status,a.source_hash,a.text_hash,
   CASE WHEN octet_length(a.normalized_text) BETWEEN 1 AND ${SOURCE_BYTE_CAP}
     AND length(a.normalized_text)<=${SOURCE_CODEPOINT_CAP} THEN encode(digest(a.normalized_text,'sha256'),'hex') END AS actual_hash
 FROM text_ids ids JOIN agent_source_texts a ON a.id::text=ids.id
), eligible AS MATERIALIZED (
 SELECT c.* FROM admissible c ${ORIGIN_JOINS}
 JOIN source_documents d ON d.id=c.source_document_id AND d.institution_id=c.institution_id
 JOIN current_texts a ON a.id::text=document->>'astId' AND a.source_document_id=d.id
 WHERE ${ORIGIN}=origin
   AND a.institution_id=c.institution_id AND a.status='completed' AND a.source_hash=document->>'sourceHash' AND a.text_hash=document->>'textHash' AND a.actual_hash=a.text_hash
   AND d.document_url=document->>'documentUrl' AND d.content_hash=document->>'contentHash'
   AND NOT EXISTS(SELECT 1 FROM eval_cases x WHERE x.case_key='corrective:'||c.id::text||':source_snapshot_v2')
)`;

export interface CorrectiveMetadata { id: number; case_bytes: number; database_digest: string }
/** Actually used by Deming. Invalid metadata/origins are excluded before LIMIT, not dropped afterwards. */
export async function loadCorrectiveCaseCandidates(db: Db, limit = 300): Promise<CorrectiveMetadata[]> {
  const rows = await scope(db, (sp) => sp.unsafe<CorrectiveMetadata[]>(`${ENROLLMENT}
    SELECT id,case_bytes::int,database_digest FROM eligible ORDER BY id LIMIT $1`, [limit]));
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}
const enrollmentForId = () => ENROLLMENT.replace("AND c.action='correct'", "AND c.action='correct' AND c.id=$1");
interface StoredCase { id: number; status: string; receipt: CorrectiveReceipt; input?: CorrectiveInput }
async function loadEnrollmentPayload(db: Db, item: CorrectiveMetadata): Promise<StoredCase | null> {
  const rows = await db.unsafe<Array<{ id: number; packet: CorrectiveReceipt }>>(`${enrollmentForId()}
    SELECT e.id,c.source_check->'deming_source_v2' AS packet FROM eligible e JOIN published_fee_corrections c ON c.id=e.id WHERE e.id=$1 AND e.database_digest=$2`, [item.id, item.database_digest]);
  const row = rows[0];
  return row && validCorrectiveReceipt(row.packet) ? { id: row.id, status: "candidate", receipt: row.packet } : null;
}
export interface CorrectiveResult {
  promoted: number; admissionLimitReached: boolean; replayLimitReached: boolean; evaluated: number; caught: number; activated: number; regressions: number;
  regressionCases: Array<{ caseId: number; verdict: string }>;
  unavailable: { count: number | null; atLeast: boolean }; deferred: number; artifact: FixtureArtifact;
}
const empty = (): CorrectiveResult => ({ promoted: 0, admissionLimitReached: false, replayLimitReached: false, evaluated: 0, caught: 0, activated: 0, regressions: 0,
  regressionCases: [], unavailable: { count: null, atLeast: false }, deferred: 0, artifact: fixtureArtifact([]) });

const DUE = `due AS MATERIALIZED (
 SELECT x.id AS case_id,x.status AS case_status,x.last_checked_at,c.* FROM eval_cases x JOIN admissible c ON
   x.case_key='corrective:'||c.id::text||':source_snapshot_v2'
 WHERE x.id BETWEEN 1 AND 9007199254740991 AND x.dataset='regression' AND x.label_provenance='human' AND x.agent='hamilton' AND x.check_name='${CORRECTIVE_CHECK}'
   AND x.status IN('candidate','active') AND x.input->>'kind'='${CORRECTIVE_KIND}'
   AND CASE WHEN jsonb_typeof(x.input)='object' THEN NOT EXISTS(SELECT 1 FROM jsonb_object_keys(x.input) k WHERE k NOT IN('kind','receipt')) ELSE false END
   AND CASE WHEN jsonb_typeof(x.input->'receipt')='object' THEN NOT EXISTS(SELECT 1 FROM jsonb_object_keys(x.input->'receipt') k WHERE k NOT IN('protocol','payload','digest','databaseDigest')) ELSE false END
   AND x.input->'receipt'->>'databaseDigest'=c.database_digest
   AND x.input->'receipt'->>'digest'=c.database_digest AND x.input->'receipt'->'protocol'='2'::jsonb
   AND encode(digest((x.input->'receipt'->'payload')::text,'sha256'),'hex')=c.database_digest
   AND octet_length(x.input::text)<=${CASE_BYTE_CAP}
   AND x.expected=jsonb_build_object('context','human_validated_edition','old_refused',true,'corrected_accepted',true)
   AND x.institution_id=c.institution_id AND x.source_document_id=c.source_document_id AND x.fee_published_id=c.previous_fee_published_id
   AND x.source_text_hash IS NULL
)`;
// Replay validates only canonical keys that actually have a pending/current case. Keep this
// cheap relational membership before source payload work; pending enrollment bodies must not
// multiply replay's statement budget. DUE still rechecks every context before its own LIMIT.
const REPLAY = `${ADMITTED.replace("AND c.action='correct'", `AND c.action='correct' AND EXISTS(
  SELECT 1 FROM eval_cases member WHERE member.case_key='corrective:'||c.id::text||':source_snapshot_v2'
    AND member.dataset='regression' AND member.status IN('candidate','active')
    AND member.check_name='${CORRECTIVE_CHECK}')`)}, ${DUE}`;

const replayForId = () => REPLAY.replace("AND c.action='correct'", "AND c.action='correct' AND c.id::text=(SELECT input->'receipt'->'payload'->'canonical'->>'id' FROM eval_cases WHERE id=$1)");

export async function runCorrectiveSource({ db, runId, dryRun, promoteLimit = 300, replayLimit = 400 }: {
  db: Db; runId: number | null; dryRun: boolean; promoteLimit?: number; replayLimit?: number;
}): Promise<CorrectiveResult> {
  const result = empty();
  let metadata: CorrectiveMetadata[];
  try { metadata = await loadCorrectiveCaseCandidates(db, promoteLimit); } catch { return result; }
  result.admissionLimitReached = metadata.length === promoteLimit && promoteLimit > 0;
  let budget = 0;
  for (const item of metadata) {
    if (budget + Number(item.case_bytes) > SOURCE_PHASE_BYTE_CAP) { result.deferred = metadata.length - metadata.indexOf(item); break; }
    budget += Number(item.case_bytes);
    try {
      const inserted = await scope(db, async (sp) => {
        const row = await loadEnrollmentPayload(sp, item);
        if (!row) return 0;
        const input: CorrectiveInput = { kind: CORRECTIVE_KIND, receipt: row.receipt };
        const verdict = replayCorrective(input);
        if (!verdict.evaluated || encodedBytes(input) > CASE_BYTE_CAP) return 0;
        if (dryRun) return 0;
        // The final guard and INSERT are one statement; concurrent enrollment counts only RETURNING.
        const rows = await sp.unsafe(`${enrollmentForId()}
          INSERT INTO eval_cases(case_key,dataset,status,agent,check_name,error_class,severity,institution_id,source_document_id,source_url,
            source_text_hash,fee_published_id,input,expected,label_provenance,origin_feedback_id,agent_run_id)
          SELECT 'corrective:'||c.id::text||':source_snapshot_v2','regression','candidate','hamilton',$3,'corrective_publication','major',c.institution_id,c.source_document_id,
            document->>'documentUrl',NULL,c.previous_fee_published_id,$4::jsonb,
            jsonb_build_object('context','human_validated_edition','old_refused',true,'corrected_accepted',true),'human',
            (origin->'feedback'->>'id')::bigint,$5
          FROM eligible c WHERE c.id=$1 AND c.database_digest=$2
            AND encode(digest(($4::jsonb->'receipt'->'payload')::text,'sha256'),'hex')=c.database_digest
          ON CONFLICT(case_key) DO NOTHING RETURNING id`, [item.id, item.database_digest, CORRECTIVE_CHECK, JSON.stringify(input), runId]);
        return rows.length;
      });
      result.promoted += inserted;
    } catch { /* Retryable unavailable: no immutable key is consumed on a failed savepoint. */ }
  }
  let due: Array<{ case_id: number; case_status: string; case_bytes: number; database_digest: string }>;
  try {
    due = await scope(db, (sp) => sp.unsafe(`${REPLAY}
      SELECT case_id,case_status,case_bytes::int,database_digest FROM due
      ORDER BY last_checked_at NULLS FIRST,case_id LIMIT $1`, [replayLimit]));
  } catch { return result; }
  result.replayLimitReached = due.length === replayLimit && replayLimit > 0;
  budget = 0;
  const fixtures: FixtureCase[] = [];
  for (const item of due) {
    if (budget + Number(item.case_bytes) > SOURCE_PHASE_BYTE_CAP) { result.deferred += due.length - due.indexOf(item); break; }
    budget += Number(item.case_bytes);
    try {
      const observed = await scope(db, async (sp) => {
        // Lock the case before reading the canonical context. The final UPDATE rechecks it too.
        await sp`SELECT id FROM eval_cases WHERE id=${item.case_id} FOR UPDATE`;
        const rows = await sp.unsafe<Array<{ packet: CorrectiveReceipt; case_status: string }>>(`${replayForId()}
          SELECT c.source_check->'deming_source_v2' AS packet,d.case_status FROM due d JOIN published_fee_corrections c ON c.id=d.id WHERE d.case_id=$1 AND d.database_digest=$2`, [item.case_id, item.database_digest]);
        if (!rows[0]) return null;
        const input: CorrectiveInput = { kind: CORRECTIVE_KIND, receipt: rows[0].packet };
        const outcome = replayCorrective(input);
        if (!outcome.evaluated) return null;
        if (!dryRun) {
          const updated = await sp.unsafe(`${replayForId()} UPDATE eval_cases x SET status=CASE WHEN $3 THEN 'active' ELSE x.status END,
            last_caught=$3,last_verdict=$4,last_checked_at=NOW(),last_run_id=$5,updated_at=NOW()
            FROM due d WHERE x.id=d.case_id AND d.case_id=$1 AND d.database_digest=$2 RETURNING x.id`,
          [item.case_id, item.database_digest, outcome.caught, outcome.verdict, runId]);
          if (updated.length !== 1) return null;
        }
        return { caseId: Number(item.case_id), input, outcome, previousStatus: rows[0].case_status };
      });
      if (!observed) continue;
      result.evaluated++;
      if (observed.outcome.caught) result.caught++;
      if (!dryRun && observed.outcome.caught && observed.previousStatus !== "active") result.activated++;
      if (observed.previousStatus === "active" && !observed.outcome.caught) {
        result.regressions++; result.regressionCases.push({ caseId: observed.caseId, verdict: observed.outcome.verdict });
      }
      fixtures.push({ caseId: observed.caseId, input: observed.input, outcome: observed.outcome });
    } catch { /* Failed origin/context read is unknown, never a rule regression. */ }
  }
  result.artifact = fixtureArtifact(fixtures);
  try {
    // Bounded metadata diagnostic, not an exact whole-store census or a teaching label.
    const unknown = await scope(db, (sp) => sp.unsafe<Array<{ context_key: string }>>(`${ENROLLMENT}, ${DUE}, unknowns AS (
      SELECT 'corrective:'||c.id::text||':source_snapshot_v2' AS context_key FROM published_fee_corrections c WHERE c.action='correct'
        AND NOT EXISTS(SELECT 1 FROM admissible a WHERE a.id=c.id)
      UNION SELECT 'corrective:'||c.id::text||':source_snapshot_v2' FROM admissible c WHERE NOT EXISTS(SELECT 1 FROM eligible e WHERE e.id=c.id)
        AND NOT EXISTS(SELECT 1 FROM eval_cases x WHERE x.case_key='corrective:'||c.id::text||':source_snapshot_v2')
      UNION SELECT 'takedown:'||f.fee_published_id::text||':'||f.check_name FROM pipeline_feedback f
        JOIN published_fee_records fp ON fp.fee_published_id=f.fee_published_id
        WHERE f.kind='takedown_confirmed' AND f.check_name='${SOURCE_CHECK_NAME}' AND fp.rolled_back_at IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM eval_cases x WHERE x.case_key='takedown:'||f.fee_published_id::text||':'||f.check_name)
      UNION SELECT x.case_key FROM eval_cases x WHERE x.status IN('active','candidate') AND x.input->>'kind' IN('source_check','${CORRECTIVE_KIND}')
        AND NOT EXISTS(SELECT 1 FROM due d WHERE d.case_id=x.id)
      ) SELECT context_key FROM unknowns ORDER BY context_key LIMIT 1001`));
    result.unavailable = { count: Math.min(1000, unknown.length), atLeast: unknown.length > 1000 };
  } catch { /* Unknown read remains count:null. */ }
  return result;
}

/** Existing ledger only. Scope rollback prevents a failed optional chunk poisoning step completion. */
export async function persistCorrectiveArtifact(db: Db, runId: number, stepId: number, artifact: FixtureArtifact): Promise<{ state: "stored" | "unavailable" | "not_generated"; scope: "evaluated_this_run"; complete: boolean; bytes: number; chunks: number; cases: number; digest: string; ciImport: "not_implemented" }> {
  try {
    if (artifact.protocol !== 2 || evidenceHash(artifact.chunks) !== artifact.digest || artifact.chunks.length > 400
        || artifact.chunks.reduce((n, c) => n + c.cases.length, 0) !== artifact.caseCount
        || artifact.chunks.reduce((n, c) => n + encodedBytes(c), 0) !== artifact.bytes
        || artifact.bytes > SOURCE_PHASE_BYTE_CAP) throw new Error("unavailable artifact integrity");
    let totalBytes = 0;
    const caseIds = new Set<number>();
    for (const [i, chunk] of artifact.chunks.entries()) {
      if (chunk.protocol !== 2 || chunk.index !== i || !chunk.cases.every((c) => c.outcome.evaluated
          && validCorrectiveReceipt(c.input.receipt) && evidenceHash(c.outcome) === evidenceHash(replayCorrective(c.input)))) throw new Error("unavailable artifact context");
      for (const c of chunk.cases) {
        if (!Number.isSafeInteger(c.caseId) || c.caseId<1 || caseIds.has(c.caseId)) throw new Error("unavailable artifact membership");
        caseIds.add(c.caseId);
      }
      const size = encodedBytes({ agent_run_id: runId, step_id: stepId, event_type: "deming.fixture.v2", status: "completed",
        message: "Corrective replay fixture; CI import is not implemented.", detail: chunk });
      if (size > 2 * 1024 * 1024) throw new Error("unavailable artifact envelope");
      totalBytes += size;
    }
    if (totalBytes > SOURCE_PHASE_BYTE_CAP) throw new Error("unavailable artifact total");
    await scope(db, async (sp) => {
      // Actual Deming step, not arbitrary caller IDs. A run retry preserves already stored chunks.
      const [owner] = await sp`SELECT s.id FROM agent_run_steps s JOIN agent_runs r ON r.id=s.agent_run_id
        WHERE s.id=${stepId} AND s.agent_run_id=${runId} AND s.step_key='deming-regression' AND s.agent_name='atlas'
          AND s.status='running' AND r.agent_name='atlas' AND r.status='running' FOR UPDATE OF s`;
      if (!owner) throw new Error("unavailable artifact owner");
      for (const chunk of artifact.chunks) {
        for (const c of chunk.cases) {
          const rows = await sp`SELECT id FROM eval_cases WHERE id=${c.caseId} AND input=${JSON.stringify(c.input)}::jsonb
            AND last_run_id=${runId} AND last_caught=${c.outcome.caught} AND last_verdict=${c.outcome.verdict}`;
          if (rows.length!==1) throw new Error("unavailable artifact observation");
        }
        if (encodedBytes(chunk) > 2 * 1024 * 1024) throw new Error("unavailable artifact bound");
        await sp`INSERT INTO agent_run_events(agent_run_id,step_id,event_type,status,message,detail)
          SELECT ${runId},${stepId},'deming.fixture.v2','completed','Corrective replay fixture; CI import is not implemented.',${JSON.stringify(chunk)}::jsonb
          WHERE NOT EXISTS(SELECT 1 FROM agent_run_events WHERE agent_run_id=${runId} AND step_id=${stepId} AND event_type='deming.fixture.v2' AND detail=${JSON.stringify(chunk)}::jsonb)`;
      }
    });
    return { state: artifact.caseCount>0 ? "stored" : "not_generated", scope: "evaluated_this_run", complete: artifact.complete, bytes: artifact.bytes, chunks: artifact.chunks.length, cases: artifact.caseCount, digest: artifact.digest, ciImport: "not_implemented" };
  } catch { return { state: "unavailable", scope: "evaluated_this_run", complete: false, bytes: 0, chunks: 0, cases: 0, digest: artifact.digest, ciImport: "not_implemented" }; }
}
