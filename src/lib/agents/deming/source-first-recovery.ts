/**
 * Fee Insight: source-first, obligation-level recovery (read-only, no model calls).
 *
 * Separates a bank's fee obligation from published_fee_records, so an omitted fee
 * can be tracked WITHOUT fabricating a fee_published_id. A stage gap is not a rule
 * verdict: the actual owning attempt must explain a reject/hold.
 *
 * Used by Deming's independent current-source audits; never authorizes mutation.
 * The caller supplies a complete, independently checked official source witness,
 * plus read-only lineage facts. Stored bank text alone is not current-source proof.
 */

export type AmountKind = "flat" | "zero" | "percentage" | "range" | "formula";
export type Charter = "bank" | "credit_union";
export type Stage = "discover" | "capture" | "normalize" | "extract" | "verify" | "publish" | "customer_surface";

export interface OfficialWitness {
  url: string;
  /** Hash of bytes independently fetched from the official bank/CU URL. */
  bytesSha256: string | null;
  /** Checked at a clock time, not inferred from document URL or stored database text. */
  inspectedAt: string;
  inspectedBy: string;
  effectiveDate: string | null;
  currentConfirmed: boolean;
  completeScheduleReviewed: boolean;
  officialInstitutionConfirmed: boolean;
  /** Short excerpt/line citation for this exact fee, rather than an adjacent price. */
  excerptRef: string;
  /** Machine or human checked that the fee belongs to the customer's scope. */
  customerScopeConfirmed: boolean;
}

export interface FeeObligation {
  caseId: string;
  institutionId: number;
  charter: Charter;
  source: OfficialWitness;
  category: string;
  accountProduct: string;
  audience: "consumer" | "business" | "both";
  feeName: string;
  amountKind: AmountKind;
  amount: number | null;
  ratePercent?: number | null;
  /** Must distinguish per-item, monthly, yearly, transaction, etc. */
  chargingUnit: string;
  conditionKey: string;
  /** Stable key for a unique official fee+product+audience+conditions combination. */
  semanticKey: string;
  /** Existing source document in the pipeline if positively identified. */
  sourceDocumentId?: number | null;
  /** A pinned observation ID, only when already established by earlier evidence. */
  rawFeeIds?: number[];
  /** Exact own-row witness for read-only comparison with Rosetta normalized text. */
  normalizedWitnessPhrase?: string;
  /** Independent inspector adjudications for matched published rows, never database self-checks. */
  publishedAdjudications?: Array<{publishedId:number; verdict:"correct"|"incorrect"|"unknown"; inspectedAt:string}>;
  /** Independent public-page sightings for individual published records. */
  customerSightings?: Array<{publishedId:number; seenAt:string; url:string}>;
}

export interface SourceDocumentFact {
  id: number;
  documentUrl: string;
  /** Hash of repository document bytes if meaningfully comparable to the official bytes. */
  contentSha256?: string | null;
  currentEditionConfirmed: boolean | null;
  status: string;
  supersededById?: number | null;
}

export interface NormalizedFact {
  sourceDocumentId: number;
  status: "completed" | "failed" | "pending";
  /** TRUE requires independently witnessed fee phrase survived normalization. */
  exactFeeWitnessSurvived: boolean | null;
  textSha256: string | null;
}

export interface CandidateFact {
  rawId: number;
  sourceDocumentId: number;
  /** Exact source excerpt + fee identity confirmed by the caller; no fuzzy name match. */
  matchesOfficialObligation: boolean;
  retired: boolean;
  flags: string[];
}

export interface VerificationFact {
  verifiedId: number;
  rawId: number;
  status: "approved" | "held" | "rejected" | "unknown";
  /** Actual candidate-level receipt only. A document-level run does not count. */
  candidateReasonCode?: string | null;
}

export interface PublicationFact {
  publishedId: number;
  verifiedId: number;
  rawId: number;
  /** Exact identity includes category, amount-kind, price/rate, product, audience,
   * unit and conditions. A string/amount-only match is not a success. */
  matchesOfficialObligation: boolean;
  live: boolean;
  customerSurfaceConfirmed: boolean;
  surfaceCheckedAt: string | null;
  /** Public customer page observed, not merely view or database row. */
  customerPageUrl: string | null;
}

export interface AttemptFact {
  stage: "extract" | "verify" | "publish";
  strategy: string;
  strategyVersion: number;
  attemptedAt: string;
  outcome: string;
  /** Document/run-level attempt CANNOT prove a particular row was rejected. */
  scope: "document" | "candidate";
  rawId?: number | null;
  reasonCode?: string | null;
}

export interface LineageFacts {
  sourceDocument: SourceDocumentFact | null;
  normalized: NormalizedFact | null;
  candidates: CandidateFact[];
  verifications: VerificationFact[];
  publications: PublicationFact[];
  attempts: AttemptFact[];
  /** True only when all IDs in a bounded source-document trace were read. */
  traceComplete: boolean;
  observedAt: string;
}

export type RecoveryCode =
  | "OFFICIAL_SOURCE_UNPROVEN"
  | "NO_CURRENT_DOCUMENT"
  | "DOCUMENT_CURRENTNESS_UNKNOWN"
  | "TEXT_NOT_READY"
  | "TEXT_WITNESS_MISSING"
  | "NORMALIZED_WITNESS_UNPROVEN"
  | "EXTRACTION_NOT_ESTABLISHED"
  | "RAW_RETIRED"
  | "VERIFY_REJECTED"
  | "VERIFY_HELD"
  | "VERIFY_OUTCOME_UNRESOLVED"
  | "VERIFIED_NOT_PUBLISHED"
  | "PUBLICATION_WRONG_OR_WITHDRAWN"
  | "DUPLICATE_PUBLICATION"
  | "CUSTOMER_SURFACE_UNVERIFIED"
  | "RECOVERED_CONFIRMED";

export interface RecoveryDiagnosis {
  caseId: string;
  institutionId: number;
  code: RecoveryCode;
  earliestObservedStage: Stage;
  /** A rule reason is proven only by a candidate-specific receipt. */
  causeProven: boolean;
  candidateReasonCodes: string[];
  blockers: string[];
  affectedRawIds: number[];
  affectedVerifiedIds: number[];
  affectedPublishedIds: number[];
  /** Always a proposal, never a permit to act. */
  suggestedOwner: "magellan" | "rosetta" | "knox" | "darwin" | "gutenberg" | "site" | "audit";
  /** No system using this result may silently schedule reprocessing. */
  mayExecuteProductionMutation: false;
}

const sha = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{64}$/i.test(value);
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const filled = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const sourceUrl = (value: unknown) => typeof value === "string" && /^https:\/\/[^/]+/i.test(value);

/** A source-first case can be unverified without being wrong; don't silently score it. */
export function officialWitnessProblems(fee: FeeObligation): string[] {
  const w = fee.source;
  const errors: string[] = [];
  if (!filled(fee.caseId) || !positive(fee.institutionId) || !filled(fee.semanticKey)) errors.push("case_identity_missing");
  if (!sourceUrl(w?.url) || w?.officialInstitutionConfirmed !== true) errors.push("official_origin_unproven");
  if (!sha(w?.bytesSha256) || !time(w?.inspectedAt) || !filled(w?.inspectedBy)) errors.push("source_bytes_or_inspection_unpinned");
  if (w?.currentConfirmed !== true || w?.completeScheduleReviewed !== true) errors.push("source_currentness_or_completeness_unproven");
  if (!filled(w?.excerptRef) || w?.customerScopeConfirmed !== true) errors.push("fee_scope_or_excerpt_unproven");
  if (!["flat", "zero", "percentage", "range", "formula"].includes(fee.amountKind) ||
      !filled(fee.accountProduct) || !filled(fee.category) || !filled(fee.feeName) ||
      !filled(fee.chargingUnit) || !filled(fee.conditionKey) || !["consumer", "business", "both"].includes(fee.audience))
    errors.push("fee_product_unit_category_or_audience_unresolved");
  if ((fee.amountKind === "flat" && !(typeof fee.amount === "number" && Number.isFinite(fee.amount) && fee.amount >= 0)) ||
      (fee.amountKind === "zero" && fee.amount !== 0) ||
      (fee.amountKind === "percentage" && !(typeof fee.ratePercent === "number" && fee.ratePercent >= 0)))
    errors.push("amount_kind_invalid");
  return errors;
}

/**
 * Diagnose earliest *observable* loss with exact candidate identity.
 * Failure to find a row in a partial read is UNKNOWN, not an extraction failure.
 * A Darwin attempt for the whole document does not explain a single raw fee.
 */
export function diagnoseRecovery(fee: FeeObligation, facts: LineageFacts): RecoveryDiagnosis {
  const blockers: string[] = [];
  const raw = (facts?.candidates ?? []).filter(x => x.matchesOfficialObligation);
  const rawIds = raw.map(x => x.rawId);
  const verify = (facts?.verifications ?? []).filter(x => rawIds.includes(x.rawId));
  const approved=verify.filter(x=>x.status==="approved");
  const verIds = approved.map(x => x.verifiedId);
  const pubs = (facts?.publications ?? []).filter(x => verIds.includes(x.verifiedId));
  const pubIds = pubs.map(x => x.publishedId);
  const result = (code: RecoveryCode, stage: Stage, owner: RecoveryDiagnosis["suggestedOwner"], causeProven = false): RecoveryDiagnosis => ({
    caseId:fee.caseId, institutionId:fee.institutionId, code, earliestObservedStage:stage,
    causeProven, candidateReasonCodes: verify.map(v=>v.candidateReasonCode).filter(filled),
    blockers, affectedRawIds:rawIds, affectedVerifiedIds:verIds, affectedPublishedIds:pubIds,
    suggestedOwner:owner, mayExecuteProductionMutation:false,
  });
  blockers.push(...officialWitnessProblems(fee));
  if (!facts || !time(facts.observedAt) || !facts.traceComplete) blockers.push("lineage_snapshot_partial_or_undated");
  if (blockers.length) return result("OFFICIAL_SOURCE_UNPROVEN", "discover", "audit");
  const doc=facts.sourceDocument;
  if (!doc) return result("NO_CURRENT_DOCUMENT", "discover", "magellan");
  if (fee.sourceDocumentId && doc.id !== fee.sourceDocumentId) {
    blockers.push("source_document_identity_does_not_match_audit");
    return result("DOCUMENT_CURRENTNESS_UNKNOWN", "capture", "magellan");
  }
  if (doc.currentEditionConfirmed !== true || doc.supersededById != null) {
    blockers.push("document_edition_unverified_or_superseded");
    return result("DOCUMENT_CURRENTNESS_UNKNOWN", "capture", "magellan");
  }
  const norm=facts.normalized;
  if (!norm || norm.status !== "completed") return result("TEXT_NOT_READY", "normalize", "rosetta");
  if (norm.sourceDocumentId !== doc.id || norm.exactFeeWitnessSurvived === null) {
    blockers.push("normalized_source_exact_witness_not_examined");
    return result("NORMALIZED_WITNESS_UNPROVEN", "normalize", "rosetta");
  }
  if (!norm.exactFeeWitnessSurvived) return result("TEXT_WITNESS_MISSING", "normalize", "rosetta");
  if (!raw.length) {
    blockers.push("no_source_bound_exact_raw_observation_identified");
    return result("EXTRACTION_NOT_ESTABLISHED", "extract", "knox");
  }
  if (raw.every(x=>x.retired)) return result("RAW_RETIRED", "extract", "knox",true);
  if (!verify.length) {
    const explicit = (facts.attempts??[]).filter(a=>a.scope==="candidate" && rawIds.includes(a.rawId ?? -1) && a.stage==="verify");
    const rejected = explicit.filter(a=>a.outcome==="rejected" && filled(a.reasonCode));
    const held = explicit.filter(a=>a.outcome==="held" && filled(a.reasonCode));
    if (rejected.length) { blockers.push(...rejected.map(a=>`candidate_rejected:${a.reasonCode}`)); return result("VERIFY_REJECTED", "verify", "darwin",true); }
    if (held.length) { blockers.push(...held.map(a=>`candidate_held:${a.reasonCode}`)); return result("VERIFY_HELD", "verify", "darwin",true); }
    blockers.push("candidate_level_verify_outcome_unproven");
    return result("VERIFY_OUTCOME_UNRESOLVED", "verify", "darwin");
  }
  if (!approved.length) {
    const reasons=verify.filter(v=>v.status==="held"||v.status==="rejected").map(v=>v.candidateReasonCode).filter(filled);
    if(reasons.length) {blockers.push(...reasons); return result(verify.some(v=>v.status==="rejected")?"VERIFY_REJECTED":"VERIFY_HELD", "verify", "darwin", true);}
    blockers.push("unapproved_verified_observation_without_candidate_reason");
    return result("VERIFY_OUTCOME_UNRESOLVED", "verify", "darwin");
  }
  if (!pubs.length) return result("VERIFIED_NOT_PUBLISHED", "publish", "gutenberg");
  const correctLive = pubs.filter(x=>x.live && x.matchesOfficialObligation);
  if (correctLive.length>1) {
    blockers.push("more_than_one_live_publication_for_same_semantic_obligation");
    return result("DUPLICATE_PUBLICATION", "publish", "gutenberg",true);
  }
  if (!correctLive.length) return result("PUBLICATION_WRONG_OR_WITHDRAWN", "publish", "gutenberg");
  const visible = correctLive[0];
  if (!visible.customerSurfaceConfirmed || !time(visible.surfaceCheckedAt) || !sourceUrl(visible.customerPageUrl)) {
    blockers.push("public_customer_page_not_independently_observed");
    return result("CUSTOMER_SURFACE_UNVERIFIED", "customer_surface", "site");
  }
  return result("RECOVERED_CONFIRMED", "customer_surface", "audit", true);
}

export interface RecoveryBatchPlan {
  planVersion: 1;
  mode: "read_only_preview";
  ownedBy: "existing_data_quality_builder";
  canonicalIssue: number;
  cases: RecoveryDiagnosis[];
  stages: Record<Stage, number>;
  outcomes: Record<string,number>;
  sourceFirstSuccessCount: number;
  pendingOrUnprovenCount: number;
  /** Blocks ALL production action absent exact source revision, population, reviews, separate authorization. */
  canExecute: false;
  requiredAuthorization: "separate_james_production_mutation_authorization";
  acceptance: string[];
}

export function compileRecoveryPlan(rows: Array<{ obligation: FeeObligation; lineage: LineageFacts }>, canonicalIssue=1918): RecoveryBatchPlan {
  const seen=new Set<string>();
  const cases:RecoveryDiagnosis[]=[];
  const stages = {discover:0,capture:0,normalize:0,extract:0,verify:0,publish:0,customer_surface:0};
  const outcomes:Record<string,number>={};
  for(const item of rows){
    const key=`${item.obligation.institutionId}:${item.obligation.semanticKey}`;
    if(seen.has(key)) throw new Error(`duplicate_semantic_obligation:${key}`);
    seen.add(key);
    const verdict=diagnoseRecovery(item.obligation,item.lineage);
    cases.push(verdict);stages[verdict.earliestObservedStage]++;
    outcomes[verdict.code]=(outcomes[verdict.code]??0)+1;
  }
  return {planVersion:1,mode:"read_only_preview",ownedBy:"existing_data_quality_builder",canonicalIssue,cases,stages,outcomes,
    sourceFirstSuccessCount:outcomes.RECOVERED_CONFIRMED??0,
    pendingOrUnprovenCount:cases.length-(outcomes.RECOVERED_CONFIRMED??0),canExecute:false,
    requiredAuthorization:"separate_james_production_mutation_authorization",
    acceptance:[
      "All source-first obligations independently current, source bytes SHA256 pinned and scopes resolved",
      "Every affected raw/verified/published record identified with exact versioned stage receipt",
      "One existing owner, no overlapping active implementation, code fix tested on positives and adversarial negatives",
      "Bounded population replay authorized separately by James, no paid calls or silent writes",
      "All recovered obligations appear on actual public institution pages with source-correct amount/category/audience/product/charging unit",
      "No previously valid fee/variant disappears; customer-visible accuracy and recall improve together on frozen cohort and fresh independent holdout",
    ]};
}