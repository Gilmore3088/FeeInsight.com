import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { productKeySql } from "@/lib/fee-product";
import type { ExtractedFeeCandidate } from "./rules";
import {
  captureTakedownWitness, MAX_TAKEDOWN_TEXT_CHARS, MAX_TAKEDOWN_WITNESS_BYTES,
  prospectiveTakedownIdentity, readTakedownHeader, readTakedownWitness, takedownIdentityKey,
  TAKEDOWN_ORIGINAL_TEXT_JOIN, TAKEDOWN_WITNESS_COLUMNS,
  type TakedownWitnessHeader, type TakedownWitnessRow,
} from "./takedown-witness";

type SqlTag = typeof sql;
/** Prospective eligibility only. Existing holds and settled extraction fingerprints are unchanged. */
export const TAKEDOWN_LESSONS_VERSION = 2;
export const TAKEN_DOWN_REVIEW_FLAG = "knox_review:taken_down";
export const KNOX_READ_CHECKS = ["hamilton.source_check", "hamilton.limit_guard", "hamilton.business_schedule"] as const;
const TAKEDOWN_LESSON_LIMIT = 20000;
const MAX_MATCHING_LESSONS = 16;

export interface LoadedTakedownLesson {
  feedbackId: number;
  feedbackHash: string;
  publishedHash: string;
  witness: TakedownWitnessHeader;
}
export type TakedownLessons = Map<string, LoadedTakedownLesson[]> & { unknownReasons: Record<string,number>; liveTwins: number };
export function emptyTakedownLessons(): TakedownLessons {
  return Object.assign(new Map<string,LoadedTakedownLesson[]>(), { unknownReasons:{} as Record<string,number>, liveTwins:0 });
}
const count = (counts: Record<string,number>, reason: string) => { counts[reason]=(counts[reason]??0)+1; };
const lessonKey = (w: TakedownWitnessHeader) => JSON.stringify([takedownIdentityKey(w.identity),w.source.hash]);

/** Static internal aliases; the SQL and pure matcher preserve the same complete supported identity. */
export function sameTakedownIdentitySql(pub:string,raw:string,otherPub:string,otherRaw:string): string {
  if (![pub,raw,otherPub,otherRaw].every(a=>/^[a-z][a-z0-9_]*$/.test(a))) throw new Error("Invalid internal lesson alias");
  return [
    `${pub}.institution_id=${otherPub}.institution_id`,`${pub}.canonical_fee_key=${otherPub}.canonical_fee_key`,
    `${pub}.amount IS NOT DISTINCT FROM ${otherPub}.amount`,`${pub}.amount_kind IS NOT DISTINCT FROM ${otherPub}.amount_kind`,
    `${productKeySql(`${pub}.fee_name`)}=${productKeySql(`${otherPub}.fee_name`)}`,
    `${productKeySql(`${raw}.product_name`)}=${productKeySql(`${otherRaw}.product_name`)}`,
    `COALESCE(${pub}.fee_audience,'unknown')=COALESCE(${otherPub}.fee_audience,'unknown')`,
    `${productKeySql(`${pub}.frequency`)}=${productKeySql(`${otherPub}.frequency`)}`,
    `${productKeySql(`${pub}.variant_type`)}=${productKeySql(`${otherPub}.variant_type`)}`,
    `COALESCE(${raw}.fee_treatment,'unknown')=COALESCE(${otherRaw}.fee_treatment,'unknown')`,
    `${productKeySql(`${raw}.conditions`)}=${productKeySql(`${otherRaw}.conditions`)}`,
    `${pub}.rate_percent IS NOT DISTINCT FROM ${otherPub}.rate_percent`,
    `${pub}.rate_min_amount IS NOT DISTINCT FROM ${otherPub}.rate_min_amount`,
    `${pub}.rate_max_amount IS NOT DISTINCT FROM ${otherPub}.rate_max_amount`,
    `${productKeySql(`${pub}.rate_basis`)}=${productKeySql(`${otherPub}.rate_basis`)}`,
  ].join(" AND ");
}
const liveTwin = `EXISTS (SELECT 1 FROM published_fee_records live
  JOIN verified_fee_observations live_verified ON live_verified.fee_verified_id=live.lineage_ref
  JOIN raw_fee_observations live_raw ON live_raw.fee_raw_id=live_verified.fee_raw_id
  WHERE live.rolled_back_at IS NULL AND ${sameTakedownIdentitySql("fp","fr","live","live_raw")})`;
const feedbackHash = `encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex')`;
const publishedHash = `encode(sha256(convert_to(to_jsonb(fp)::text,'UTF8')),'hex')`;

/** Skinny index: original full snapshots are fetched only for an actual potential match. */
export async function loadTakedownLessons(db:SqlTag,institutionIds?:readonly number[]): Promise<TakedownLessons> {
  const lessons=emptyTakedownLessons();
  const ids=institutionIds ? [...new Set(institutionIds.filter(i=>Number.isSafeInteger(i)&&i>0))] : null;
  if (ids && ids.length===0) return lessons;
  try {
    return await inSavepoint(db,async scope=>{
      if (!(await feedbackSchemaReady(scope))) return lessons;
      const rows=await scope<Array<{feedback_id:number|string;check_name:string;witness_header:unknown;feedback_hash:string;published_hash:string;has_live_twin:boolean}>>`
        SELECT f.id AS feedback_id,f.check_name,${scope.unsafe(feedbackHash)} AS feedback_hash,
               ${scope.unsafe(publishedHash)} AS published_hash,${scope.unsafe(liveTwin)} AS has_live_twin,
               CASE WHEN jsonb_typeof(f.evidence->'takedown_witness')='object'
                          AND octet_length((f.evidence->'takedown_witness')::text)<=${MAX_TAKEDOWN_WITNESS_BYTES}
                    THEN (f.evidence->'takedown_witness') - ARRAY['publishedState','verifiedState','rawState'] END AS witness_header
          FROM pipeline_feedback f JOIN published_fee_records fp ON fp.fee_published_id=f.fee_published_id
          LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id=fp.lineage_ref
          LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
         WHERE f.kind='takedown_confirmed' AND f.check_name=ANY(${[...KNOX_READ_CHECKS]}::text[])
           AND fp.rolled_back_at IS NOT NULL
           ${ids ? scope`AND fp.institution_id=ANY(${ids}::bigint[])` : scope``}
         ORDER BY f.created_at DESC,f.id DESC LIMIT ${TAKEDOWN_LESSON_LIMIT}`;
      for (const row of rows) {
        if (row.check_name!=="hamilton.limit_guard") { count(lessons.unknownReasons,"unsupported_producer");continue; }
        const witness=readTakedownHeader(row.witness_header);
        if (!witness) { count(lessons.unknownReasons,"missing_or_invalid_original_witness");continue; }
        if (row.has_live_twin) { lessons.liveTwins+=1;continue; }
        const key=lessonKey(witness),group=lessons.get(key)??[];
        if (group.length>=MAX_MATCHING_LESSONS) { count(lessons.unknownReasons,"matching_lesson_budget");continue; }
        group.push({feedbackId:Number(row.feedback_id),feedbackHash:row.feedback_hash,publishedHash:row.published_hash,witness});
        lessons.set(key,group);
      }
      return lessons;
    });
  } catch (error) {
    console.error("loadTakedownLessons failed:",error);
    const unavailable=emptyTakedownLessons();count(unavailable.unknownReasons,"lesson_read_failed");return unavailable;
  }
}

export interface CandidateTextContext {
  document_text_id:number|string;
  source_document_id:number|string;
  institution_id:number|string;
  text_hash:string|null;
}
export function takedownLessonsFor(candidate:ExtractedFeeCandidate,lessons:TakedownLessons,context:CandidateTextContext): LoadedTakedownLesson[] {
  const identity=prospectiveTakedownIdentity(Number(context.institution_id),candidate);
  if (!identity || !context.text_hash || !/^[a-f0-9]{64}$/.test(context.text_hash)) return [];
  return lessons.get(JSON.stringify([takedownIdentityKey(identity),context.text_hash]))??[];
}
export function takedownLessonFlag(check:string): string { return `knox_lesson:taken_down:${check}`; }

class UnavailableLesson extends Error { constructor(readonly reason:string) { super(reason); } }
type FreshLessonRow=TakedownWitnessRow & {evidence:Record<string,unknown>;feedback_hash:string;published_hash:string;kind:string;check_name:string;
  is_down:boolean;closure_batch:string|null;closure_reason:string|null;has_live_twin:boolean};

/**
 * Shares the raw INSERT transaction. NOWAIT avoids existing inverse feedback→publication
 * lock orders. Unavailable proof rolls back this savepoint before ordinary verification.
 * This protects the selected rows, not invisible new-row phantoms.
 */
export async function withCurrentTakedownLesson<T>(db:SqlTag,lesson:LoadedTakedownLesson,context:CandidateTextContext,work:(scope:SqlTag,check:string)=>Promise<T>): Promise<{value:T;reason:"matched"}|{reason:string}> {
  if (typeof (db as unknown as {savepoint?:unknown}).savepoint!=="function") return {reason:"transaction_required"};
  let writing=false;
  try {
    return await inSavepoint(db,async scope=>{
      const w=lesson.witness;
      const pub=await scope<{lineage_ref:number|string}[]>`SELECT lineage_ref FROM published_fee_records
        WHERE fee_published_id=${w.publishedId} ORDER BY fee_published_id FOR UPDATE NOWAIT`;
      if (Number(pub[0]?.lineage_ref)!==w.verifiedId) throw new UnavailableLesson("lineage_changed");
      const verified=await scope<{fee_raw_id:number|string}[]>`SELECT fee_raw_id FROM verified_fee_observations
        WHERE fee_verified_id=${w.verifiedId} ORDER BY fee_verified_id FOR UPDATE NOWAIT`;
      if (Number(verified[0]?.fee_raw_id)!==w.rawId) throw new UnavailableLesson("lineage_changed");
      await scope`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=${w.rawId} ORDER BY fee_raw_id FOR UPDATE NOWAIT`;
      await scope`SELECT id FROM pipeline_feedback WHERE id=${lesson.feedbackId} ORDER BY id FOR UPDATE NOWAIT`;
      const textIds=[...new Set([w.source.artifactId,Number(context.document_text_id)])].sort((a,b)=>a-b);
      if (textIds.some(i=>!Number.isSafeInteger(i)||i<=0)) throw new UnavailableLesson("candidate_source_unknown");
      await scope`SELECT id FROM agent_source_texts WHERE id=ANY(${textIds}::bigint[]) ORDER BY id FOR SHARE NOWAIT`;
      const rows=await scope<FreshLessonRow[]>`SELECT ${scope.unsafe(TAKEDOWN_WITNESS_COLUMNS)},f.evidence,f.kind,f.check_name,
          ${scope.unsafe(feedbackHash)} AS feedback_hash,${scope.unsafe(publishedHash)} AS published_hash,
          fp.rolled_back_at IS NOT NULL AS is_down,fp.rolled_back_by_batch_id::text AS closure_batch,
          fp.rolled_back_reason AS closure_reason,${scope.unsafe(liveTwin)} AS has_live_twin
        FROM pipeline_feedback f JOIN published_fee_records fp ON fp.fee_published_id=f.fee_published_id
        JOIN verified_fee_observations fv ON fv.fee_verified_id=fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
        ${scope.unsafe(TAKEDOWN_ORIGINAL_TEXT_JOIN)}
        WHERE f.id=${lesson.feedbackId} AND fp.fee_published_id=${w.publishedId}`;
      const current=rows[0],saved=readTakedownWitness(current?.evidence?.takedown_witness);
      if (!current || !saved || current.kind!=="takedown_confirmed" || current.check_name!==w.check || !current.is_down
        || current.feedback_hash!==lesson.feedbackHash || current.published_hash!==lesson.publishedHash
        || current.closure_batch!==w.closureBatchId || current.closure_reason!==current.evidence.confirm_reason
        || Number(current.evidence.confirm_run_id)!==w.judgeRunId || current.has_live_twin) throw new UnavailableLesson("lesson_state_changed");
      const actual=captureTakedownWitness(current,{runId:saved.judgeRunId,batchId:saved.closureBatchId});
      if (!actual || lessonKey(actual)!==lessonKey(w) || actual.publishedState!==saved.publishedState
        || actual.verifiedState!==saved.verifiedState || actual.rawState!==saved.rawState
        || actual.source.artifactId!==saved.source.artifactId || actual.source.sourceDocumentId!==saved.source.sourceDocumentId
        || actual.publishedId!==saved.publishedId || actual.verifiedId!==saved.verifiedId || actual.rawId!==saved.rawId)
        throw new UnavailableLesson("original_identity_or_source_changed");
      const source=await scope<{id:number|string}[]>`SELECT id FROM agent_source_texts
        WHERE id=${Number(context.document_text_id)} AND institution_id=${Number(context.institution_id)}
          AND source_document_id=${Number(context.source_document_id)} AND status='completed'
          AND text_hash=${context.text_hash} AND text_hash=${w.source.hash}
          AND char_length(normalized_text)<=${MAX_TAKEDOWN_TEXT_CHARS}
          AND text_hash=encode(sha256(convert_to(normalized_text,'UTF8')),'hex')`;
      if (source.length!==1) throw new UnavailableLesson("candidate_source_changed");
      writing=true;
      return {value:await work(scope,w.check),reason:"matched" as const};
    });
  } catch (error) {
    if (writing) throw error;
    if (error instanceof UnavailableLesson) return {reason:error.reason};
    if (error && typeof error==="object" && "code" in error && error.code==="55P03") return {reason:"lesson_contended"};
    console.error("takedown lesson guard failed:",error);return {reason:"lesson_guard_failed"};
  }
}
