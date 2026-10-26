/**
 * READ-ONLY stage receipt materializer for source-first fee obligations.
 *
 * Uses existing semantic tables and source-document IDs; no migrations, UPDATE,
 * INSERT, DELETE, extractions, provider calls or issue creation. All queries are
 * parameterized, identity-bounded, and cap their result sizes. No cross-bank scan.
 *
 * Import this in Deming's existing run only when a manually approved, independently
 * source-adjudicated obligation manifest exists. A missing/ambiguous identity stays
 * UNKNOWN. Never infer official currentness from the stored schedule itself.
 */
import type { sql } from "@/lib/data-store/connection";
import type { FeeObligation, LineageFacts, CandidateFact, VerificationFact, PublicationFact, AttemptFact } from "./source-first-recovery";

type SqlTag = typeof sql;
export const MAX_OWN_OBSERVATIONS = 25;
export const MAX_OWN_PUBLISHED = 200;
export const MAX_STAGE_ATTEMPTS = 60;
const clean = (s: string) => s.replace(/\s+/g," ").trim();
const sha = (s:unknown):s is string => typeof s === "string" && /^[a-f\d]{64}$/i.test(s);
const when = (s:unknown)=>s!=null && Number.isFinite(Date.parse(String(s)));

export interface SourceFirstDbRead {
  obligation: FeeObligation;
  lineage: LineageFacts;
  warnings: string[];
}

interface SourceRow { id:number|string; institution_id:number|string; document_url:string; content_hash:string|null; status:string; superseded_by_id:number|string|null; }
interface TextRow { source_document_id:number|string; status:string; text_hash:string|null; exact_witness_present:boolean|null; text_bytes:number|null; }
interface RawRow { fee_raw_id:number|string; source_document_id:number|string; outlier_flags:unknown; }
interface VerifiedRow { fee_verified_id:number|string; fee_raw_id:number|string; review_status:string|null; }
interface PublishedRow { fee_published_id:number|string; lineage_ref:number|string; rolled_back_at:string|null; quarantined_at:string|null; published_at:string|null; live_in_catalog:boolean|null; }
interface AttemptRow { stage:string; strategy:string; strategy_version:number|null; created_at:string; outcome:string; }

/** Source phrase survival check is lexical, never consumer-fee adjudication. */
export function sourceLineSurvived(text: string|null, phrase:string|undefined):boolean|null {
  if(!text || !phrase || clean(phrase).length<10) return null;
  return clean(text).includes(clean(phrase));
}
/** One-of-many same hash only valid if both represent the same official bytes. */
export function editionMatches(docHash:string|null,officialHash:string|null):boolean|null {
  if(!sha(docHash) || !sha(officialHash))return null;
  return docHash.toLowerCase()===officialHash.toLowerCase();
}
export function flagsOf(input: unknown): string[] {
  if(Array.isArray(input))return input.filter(x=>typeof x==="string") as string[];
  if(typeof input==="string") {try{return flagsOf(JSON.parse(input))}catch{return []}}
  return [];
}

/** Query a bounded known observation, not a fuzzy name/amount match. */
export async function readSourceFirstLineage(db:SqlTag, fee:FeeObligation, observedAt=new Date().toISOString()):Promise<SourceFirstDbRead> {
  const warnings:string[]=[];
  const docId=fee.sourceDocumentId;
  const ids=fee.rawFeeIds??[];
  const valid=Number.isSafeInteger(fee.institutionId) && fee.institutionId>0 &&
    Number.isSafeInteger(docId) && (docId as number)>0 &&
    ids.length<=MAX_OWN_OBSERVATIONS && ids.every(i=>Number.isSafeInteger(i)&&i>0) && new Set(ids).size===ids.length;
  const empty:LineageFacts={sourceDocument:null,normalized:null,candidates:[],verifications:[],publications:[],attempts:[],traceComplete:false,observedAt};
  if(!valid){warnings.push("missing_document_identity_or_unbounded_observation_ids");return {obligation:fee,lineage:empty,warnings};}
  const source=(await db<SourceRow[]>`
    SELECT id,institution_id,document_url,content_hash,status,superseded_by_id
      FROM source_documents
     WHERE id=${docId!}::bigint AND institution_id=${fee.institutionId}::bigint LIMIT 1
  `)[0];
  if(!source){warnings.push("source_document_missing_at_institution");return {obligation:fee,lineage:{...empty,traceComplete:true},warnings};}
  const currentHash=editionMatches(source.content_hash,fee.source.bytesSha256);
  if(!["success","unchanged"].includes(source.status))warnings.push("source_document_not_successfully_captured");
  const witnessPhrase=(fee.normalizedWitnessPhrase??"").trim();
  const texts=await db<TextRow[]>`
    SELECT source_document_id,status,text_hash,octet_length(normalized_text) AS text_bytes,
      CASE WHEN ${witnessPhrase}::text <> '' AND normalized_text IS NOT NULL
                     AND octet_length(normalized_text) <= 500000
           THEN position(${witnessPhrase}::text in normalized_text) > 0
           ELSE NULL END AS exact_witness_present
      FROM agent_source_texts
     WHERE institution_id=${fee.institutionId}::bigint AND source_document_id=${docId!}::bigint
     ORDER BY updated_at DESC,id DESC LIMIT 1
  `;
  if(currentHash===null)warnings.push("document_bytes_hash_not_comparable_to_external_sha");
  if(!fee.normalizedWitnessPhrase)warnings.push("normalized_exact_source_phrase_unpinned");
  if(texts[0]?.exact_witness_present!==true)warnings.push("normalized_exact_fee_witness_not_positively_established");
  if((texts[0]?.text_bytes??0)>500000)warnings.push("normalized_text_too_large_for_exact_witness_read");
  const lineage:LineageFacts={
    ...empty,traceComplete:true,
    sourceDocument:{id:Number(source.id),documentUrl:source.document_url,contentSha256:source.content_hash,
      currentEditionConfirmed:currentHash===true && fee.source.currentConfirmed===true && ["success","unchanged"].includes(source.status),
      status:source.status,supersededById:source.superseded_by_id==null?null:Number(source.superseded_by_id)},
    normalized:texts[0]?{sourceDocumentId:Number(texts[0].source_document_id),
      status:texts[0].status==="completed"?"completed":texts[0].status==="failed"?"failed":"pending",
      // Literal evidence establishes presence; absence requires a separate full-layout adjudication.
      exactFeeWitnessSurvived:texts[0].exact_witness_present===true?true:null,
      textSha256:texts[0].text_hash}:null,
  };
  if(!ids.length){lineage.traceComplete=false;warnings.push("no_pinned_raw_ids_candidate_search_not_attempted");return {obligation:fee,lineage,warnings};}
  const raw=await db<RawRow[]>`
    SELECT fee_raw_id,source_document_id,outlier_flags FROM raw_fee_observations
     WHERE institution_id=${fee.institutionId}::bigint AND source_document_id=${docId!}::bigint
       AND fee_raw_id=ANY(${ids}::bigint[]) ORDER BY fee_raw_id LIMIT ${MAX_OWN_OBSERVATIONS+1}
  `;
  if(raw.length>MAX_OWN_OBSERVATIONS){lineage.traceComplete=false;warnings.push("raw_limit_exceeded");return {obligation:fee,lineage,warnings};}
  const candidates:CandidateFact[]=raw.map(row=>({rawId:Number(row.fee_raw_id),sourceDocumentId:Number(row.source_document_id),matchesOfficialObligation:true,
    retired:flagsOf(row.outlier_flags).some(x=>["superseded_by_reread","superseded_by_newer_copy"].includes(x)),flags:flagsOf(row.outlier_flags)}));
  lineage.candidates=candidates;
  const matchedIds=candidates.map(x=>x.rawId);
  if(!matchedIds.length){warnings.push("pinned_raw_ids_not_present_in_current_document");return {obligation:fee,lineage,warnings};}
  const verified=await db<VerifiedRow[]>`
    SELECT fee_verified_id,fee_raw_id,review_status FROM verified_fee_observations
     WHERE institution_id=${fee.institutionId}::bigint AND fee_raw_id=ANY(${matchedIds}::bigint[])
     ORDER BY fee_verified_id LIMIT ${MAX_OWN_PUBLISHED+1}
  `;
  if(verified.length>MAX_OWN_PUBLISHED){lineage.traceComplete=false;warnings.push("verified_limit_exceeded");return {obligation:fee,lineage,warnings};}
  lineage.verifications=verified.map(v=>({verifiedId:Number(v.fee_verified_id),rawId:Number(v.fee_raw_id),
    status:["verified","approved"].includes(v.review_status??"")?"approved":v.review_status==="held"?"held":v.review_status==="rejected"?"rejected":"unknown"} as VerificationFact));
  const verIds=lineage.verifications.map(x=>x.verifiedId);
  if(verIds.length){
    const published=await db<PublishedRow[]>`
      SELECT p.fee_published_id,p.lineage_ref,p.rolled_back_at,p.quarantined_at,p.published_at,
             (c.fee_published_id IS NOT NULL) AS live_in_catalog
        FROM published_fee_records p LEFT JOIN published_fee_catalog c ON c.fee_published_id=p.fee_published_id
       WHERE p.institution_id=${fee.institutionId}::int AND p.lineage_ref=ANY(${verIds}::bigint[])
       ORDER BY p.fee_published_id LIMIT ${MAX_OWN_PUBLISHED+1}
    `;
    if(published.length>MAX_OWN_PUBLISHED){lineage.traceComplete=false;warnings.push("publication_limit_exceeded");return {obligation:fee,lineage,warnings};}
    lineage.publications=published.map((p):PublicationFact=>{
      const id=Number(p.fee_published_id);
      // A prepublication check cannot independently prove a postpublication correction.
      const publishedAt=p.published_at && when(p.published_at)?Date.parse(String(p.published_at)):Number.POSITIVE_INFINITY;
      const adjudication=fee.publishedAdjudications?.find(x=>x.publishedId===id && when(x.inspectedAt) && Date.parse(x.inspectedAt)>=publishedAt);
      const surface=fee.customerSightings?.find(x=>x.publishedId===id && when(x.seenAt) && Date.parse(x.seenAt)>=publishedAt
        && /^https:\/\/(www\.)?feeinsight\.com\//i.test(x.url));
      return {publishedId:id,verifiedId:Number(p.lineage_ref),rawId:lineage.verifications.find(x=>x.verifiedId===Number(p.lineage_ref))?.rawId??0,
        matchesOfficialObligation:adjudication?.verdict==="correct",live:p.rolled_back_at===null && p.quarantined_at===null && p.live_in_catalog===true,
        customerSurfaceConfirmed:!!surface,surfaceCheckedAt:surface?.seenAt??null,customerPageUrl:surface?.url??null};
    });
  }
  const attemptRows=await db<AttemptRow[]>`
    SELECT stage,strategy,strategy_version,created_at,outcome FROM pipeline_attempts
     WHERE institution_id=${fee.institutionId}::bigint AND source_document_id=${docId!}::bigint
       AND stage=ANY(${["extract","verify","publish"]}::text[])
     ORDER BY created_at DESC,id DESC LIMIT ${MAX_STAGE_ATTEMPTS+1}
  `;
  if(attemptRows.length>MAX_STAGE_ATTEMPTS){warnings.push("document_attempt_history_truncated");/* Stage attempts are advisory; never invent candidate-specific outcomes. */}
  lineage.attempts=attemptRows.slice(0,MAX_STAGE_ATTEMPTS).map((row):AttemptFact=>({stage:row.stage==="verify"?"verify":row.stage==="publish"?"publish":"extract",
    strategy:row.strategy,strategyVersion:Number(row.strategy_version??0),attemptedAt:row.created_at,outcome:row.outcome,scope:"document"}));
  return {obligation:fee,lineage,warnings};
}