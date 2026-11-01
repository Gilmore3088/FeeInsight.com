/**
 * A written answer's claims as saved with it (#1077, claim contract step 6; #1899): each sentence's
 * outcome from the sentence binding (supported, Hamilton's reading, left out) and, for a supported
 * sentence, the facts it rests on with their values, so a later read (the board report, a
 * re-check) works from the claims rather than from joined prose.
 *
 * Saved in the analysis row's `response_json` (jsonb) beside `narrativeBinding`: no migration. The
 * claims are built from the same binding the save already computes, so they never say anything the
 * binding does not. Pure: no reads, no model calls.
 *
 * A fact is stored with its value and dates, not only its ID: a filing's natural key keeps its ID
 * when the filing is revised (design, Risks), so a re-check must compare the value. An observed
 * fact also keeps the source identity its evidence carried (table, record, document ids, URL,
 * content hash, verification event), and a calculated one its input fact ids, so a re-check, the
 * sources section or a correction can tell which schedule version was read without joining
 * today's catalog (#1077, Cycle A trace defect 6). Those fields are optional: claims saved before
 * them read back without them.
 */

import type { HamiltonEvidenceBundle, HamiltonEvidenceClass, HamiltonFactUnit, HamiltonPeriodBasis } from "./evidence-contract";
import { NARRATIVE_BINDING_VERSION, type NarrativeBinding, type OmitReason } from "./narrative-bound";
import { isOmitReason } from "./written-answer-binding";

export const SAVED_CLAIMS_VERSION = 1 as const;

/**
 * The most facts one saved answer keeps, as the written calculation ledger is bounded (40). Cited
 * facts are taken one per supported sentence in turn, so every sentence keeps its first fact before
 * any keeps a second; inputs of cited calculated facts fill what is left.
 */
export const SAVED_CLAIM_MAX_FACTS = 40;
/** The most source document ids, and calculated-fact input ids, one saved fact keeps. */
export const SAVED_CLAIM_MAX_IDS = 8;
/** The longest saved URL, hash, date or key; a longer one is not saved. */
const SAVED_CLAIM_MAX_TEXT = 512;

export type SavedClaimOutcome = "supported" | "reading" | "omitted";

export interface SavedClaim {
  text: string;
  outcome: SavedClaimOutcome;
  /** The facts a supported sentence rests on; empty for a supported sentence with no figure, and for the other outcomes. */
  factIds: string[];
  /** Why a sentence was left out. */
  reason?: OmitReason;
  /** Where a reading sentence's index statistic comes from, when the binding says. */
  basis?: string;
}

export interface SavedClaimFact {
  id: string;
  kind: "observed" | "derived";
  value: number | string | null;
  unit: HamiltonFactUnit;
  institutionId: number | null;
  feeCategory: string | null;
  metric: string | null;
  reportingDate: string | null;
  periodBasis: HamiltonPeriodBasis | null;
  asOf: string | null;
  /** Where an observed fact was read; absent on a calculated fact and on claims saved before #1077 defect 6. */
  source?: SavedClaimFactSource;
  /** The facts a calculated fact was made from, at most `SAVED_CLAIM_MAX_IDS`; absent on an observed one. */
  inputFactIds?: string[];
}

/** An observed fact's source identity as its evidence carried it. Empty values are left out. */
export interface SavedClaimFactSource {
  table: string | null;
  recordId: number | string | null;
  recordKey?: string;
  evidenceClass?: HamiltonEvidenceClass;
  /** At most `SAVED_CLAIM_MAX_IDS`; `sourceDocumentIdsTruncated` says when more were carried. */
  sourceDocumentIds: number[];
  sourceDocumentIdsTruncated?: true;
  /** The first source URL. */
  url?: string;
  documentContentHash?: string;
  retrievedAt?: string;
  lastCheckedAt?: string;
  verificationEventId?: string;
}

export interface SavedClaimSet {
  version: typeof SAVED_CLAIMS_VERSION;
  /** The binding version the outcomes come from. */
  bindingVersion: typeof NARRATIVE_BINDING_VERSION;
  claims: SavedClaim[];
  /**
   * The facts the supported claims cite, then the inputs of cited calculated facts, at most
   * `SAVED_CLAIM_MAX_FACTS` in all (see `factsToSave` for the order).
   */
  facts: SavedClaimFact[];
  /** True when a cited fact was left out of `facts` by the bound; an input left out does not count. */
  factsTruncated: boolean;
  /** The binding's correction lines for a premise the records contradict. */
  corrections: string[];
}

const savedText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= SAVED_CLAIM_MAX_TEXT ? value : undefined;
const documentId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const EVIDENCE_CLASSES: readonly string[] = ["fee_record", "filing", "filing_statistic", "index_statistic"];

/** A source identity with its bounds applied; also how a saved one is read back, so both agree. */
function boundedSource(raw: Record<string, unknown>): SavedClaimFactSource {
  const ids = Array.isArray(raw.sourceDocumentIds) ? raw.sourceDocumentIds.filter(documentId) : [];
  const recordId = raw.recordId;
  const optional = {
    recordKey: savedText(raw.recordKey),
    evidenceClass: typeof raw.evidenceClass === "string" && EVIDENCE_CLASSES.includes(raw.evidenceClass) ? raw.evidenceClass as HamiltonEvidenceClass : undefined,
    sourceDocumentIdsTruncated: ids.length > SAVED_CLAIM_MAX_IDS || raw.sourceDocumentIdsTruncated === true ? (true as const) : undefined,
    url: savedText(Array.isArray(raw.urls) ? raw.urls[0] : raw.url),
    documentContentHash: savedText(raw.documentContentHash),
    retrievedAt: savedText(raw.retrievedAt),
    lastCheckedAt: savedText(raw.lastCheckedAt),
    verificationEventId: savedText(raw.verificationEventId),
  };
  return {
    table: savedText(raw.table) ?? null,
    recordId: (typeof recordId === "number" && Number.isFinite(recordId)) ? recordId : savedText(recordId) ?? null,
    sourceDocumentIds: ids.slice(0, SAVED_CLAIM_MAX_IDS),
    ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
  };
}

function savedFact(fact: HamiltonEvidenceBundle["facts"][number] | HamiltonEvidenceBundle["derivations"][number]): SavedClaimFact {
  return {
    id: fact.id,
    kind: fact.kind,
    value: fact.value,
    unit: fact.unit,
    institutionId: fact.scope.institutionId,
    feeCategory: fact.scope.feeCategory,
    metric: fact.scope.metric ?? null,
    reportingDate: fact.scope.reportingDate,
    periodBasis: fact.scope.periodBasis ?? null,
    asOf: fact.kind === "observed" ? fact.source.asOf : null,
    ...(fact.kind === "observed"
      ? { source: boundedSource(fact.source as unknown as Record<string, unknown>) }
      : { inputFactIds: [...new Set(fact.derivation.inputFactIds)].slice(0, SAVED_CLAIM_MAX_IDS) }),
  };
}

/**
 * The fact ids to save, in order: each supported sentence's first cited fact, then each one's
 * second, and so on, so a sentence late in a long answer is not the one the bound drops; then the
 * inputs of the cited calculated facts, while there is room. Only ids the evidence holds count.
 */
function factsToSave(binding: NarrativeBinding, byId: ReadonlyMap<string, SavedClaimFact>): { ids: string[]; truncated: boolean } {
  const lists = binding.supported.map((s) => s.factIds.filter((id) => byId.has(id)));
  const cited: string[] = [];
  const seen = new Set<string>();
  for (let round = 0; lists.some((list) => list.length > round); round++) {
    for (const list of lists) {
      const id = list[round];
      if (id !== undefined && !seen.has(id)) { seen.add(id); cited.push(id); }
    }
  }
  const ids = cited.slice(0, SAVED_CLAIM_MAX_FACTS);
  for (const id of [...ids]) {
    for (const input of byId.get(id)?.inputFactIds ?? []) {
      if (ids.length >= SAVED_CLAIM_MAX_FACTS) break;
      if (byId.has(input) && !ids.includes(input)) ids.push(input);
    }
  }
  return { ids, truncated: cited.length > SAVED_CLAIM_MAX_FACTS };
}

/**
 * The claims of a bound written answer, from its binding and the evidence it was bound against
 * (the fee bundle and the claim facts). Null with no binding.
 */
export function savedClaimsFrom(binding: NarrativeBinding | null | undefined, evidence: ReadonlyArray<HamiltonEvidenceBundle | null | undefined> = []): SavedClaimSet | null {
  if (!binding) return null;
  const basis = new Map((binding.readingBasis ?? []).map((item) => [item.text.trim(), item.basis]));
  const claims: SavedClaim[] = [
    ...binding.supported.map((s): SavedClaim => ({ text: s.text, outcome: "supported", factIds: [...s.factIds] })),
    ...binding.interpretation.map((text): SavedClaim => {
      const line = basis.get(text.trim());
      return { text, outcome: "reading", factIds: [], ...(line ? { basis: line } : {}) };
    }),
    ...binding.omitted.map((o): SavedClaim => ({ text: o.text, outcome: "omitted", factIds: [], reason: o.reason })),
  ];
  const byId = new Map<string, SavedClaimFact>();
  for (const bundle of evidence) {
    for (const fact of [...(bundle?.facts ?? []), ...(bundle?.derivations ?? [])]) if (!byId.has(fact.id)) byId.set(fact.id, savedFact(fact));
  }
  const saved = factsToSave(binding, byId);
  return {
    version: SAVED_CLAIMS_VERSION,
    bindingVersion: NARRATIVE_BINDING_VERSION,
    claims,
    facts: saved.ids.map((id) => byId.get(id) as SavedClaimFact),
    factsTruncated: saved.truncated,
    corrections: [...(binding.corrections ?? [])],
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const OUTCOMES: readonly string[] = ["supported", "reading", "omitted"];

/** Saved claims read back defensively: anything malformed, or of another version, reads as none. */
export function readSavedClaims(value: unknown): SavedClaimSet | null {
  const obj = record(value);
  if (!obj || obj.version !== SAVED_CLAIMS_VERSION || obj.bindingVersion !== NARRATIVE_BINDING_VERSION) return null;
  if (!Array.isArray(obj.claims) || !Array.isArray(obj.facts) || !strings(obj.corrections)) return null;
  const claims: SavedClaim[] = [];
  for (const raw of obj.claims) {
    const c = record(raw);
    if (!c || typeof c.text !== "string" || typeof c.outcome !== "string" || !OUTCOMES.includes(c.outcome) || !strings(c.factIds)) return null;
    if (c.outcome === "omitted" && !isOmitReason(c.reason)) return null;
    claims.push({
      text: c.text, outcome: c.outcome as SavedClaimOutcome, factIds: [...c.factIds],
      ...(c.outcome === "omitted" ? { reason: c.reason as OmitReason } : {}),
      ...(typeof c.basis === "string" ? { basis: c.basis } : {}),
    });
  }
  const facts: SavedClaimFact[] = [];
  for (const raw of obj.facts) {
    const f = record(raw);
    if (!f || typeof f.id !== "string" || (f.kind !== "observed" && f.kind !== "derived") || typeof f.unit !== "string") return null;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    facts.push({
      id: f.id, kind: f.kind, value: typeof f.value === "string" ? f.value : num(f.value), unit: f.unit as HamiltonFactUnit,
      institutionId: num(f.institutionId), feeCategory: str(f.feeCategory), metric: str(f.metric), reportingDate: str(f.reportingDate),
      periodBasis: str(f.periodBasis) as HamiltonPeriodBasis | null, asOf: str(f.asOf),
      // Absent on claims saved before #1077 defect 6; a malformed source reads as none, not as a bad set.
      ...(f.kind === "observed" && record(f.source) ? { source: boundedSource(record(f.source) as Record<string, unknown>) } : {}),
      ...(f.kind === "derived" && strings(f.inputFactIds) ? { inputFactIds: f.inputFactIds.slice(0, SAVED_CLAIM_MAX_IDS) } : {}),
    });
  }
  return { version: SAVED_CLAIMS_VERSION, bindingVersion: NARRATIVE_BINDING_VERSION, claims, facts, factsTruncated: obj.factsTruncated === true, corrections: [...obj.corrections] };
}

/**
 * The sentence binding the saved claims describe, so every reader of a saved answer (the screen's
 * `applyNarrativeBinding`, the report) applies one rule. Limitations are not part of the claims; a
 * caller that prints them reads the saved binding.
 */
export function bindingFromClaims(set: SavedClaimSet): NarrativeBinding {
  const readingBasis = set.claims.flatMap((c) => (c.outcome === "reading" && c.basis ? [{ text: c.text, basis: c.basis }] : []));
  return {
    version: NARRATIVE_BINDING_VERSION,
    supported: set.claims.filter((c) => c.outcome === "supported").map((c) => ({ text: c.text, factIds: [...c.factIds] })),
    interpretation: set.claims.filter((c) => c.outcome === "reading").map((c) => c.text),
    omitted: set.claims.filter((c) => c.outcome === "omitted").map((c) => ({ text: c.text, reason: c.reason as OmitReason })),
    limitations: [],
    ...(readingBasis.length ? { readingBasis } : {}),
    ...(set.corrections.length ? { corrections: [...set.corrections] } : {}),
  };
}
