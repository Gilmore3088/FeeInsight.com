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
 * when the filing is revised (design, Risks), so a re-check must compare the value.
 */

import type { HamiltonEvidenceBundle, HamiltonFactUnit, HamiltonPeriodBasis } from "./evidence-contract";
import { NARRATIVE_BINDING_VERSION, type NarrativeBinding, type OmitReason } from "./narrative-bound";
import { isOmitReason } from "./written-answer-binding";

export const SAVED_CLAIMS_VERSION = 1 as const;

/** The most facts one saved answer keeps, as the written calculation ledger is bounded (40). */
export const SAVED_CLAIM_MAX_FACTS = 40;

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
}

export interface SavedClaimSet {
  version: typeof SAVED_CLAIMS_VERSION;
  /** The binding version the outcomes come from. */
  bindingVersion: typeof NARRATIVE_BINDING_VERSION;
  claims: SavedClaim[];
  /** The facts the supported claims cite, at most `SAVED_CLAIM_MAX_FACTS`. */
  facts: SavedClaimFact[];
  /** True when a cited fact was left out of `facts` by the bound. */
  factsTruncated: boolean;
  /** The binding's correction lines for a premise the records contradict. */
  corrections: string[];
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
  };
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
  const cited = [...new Set(binding.supported.flatMap((s) => s.factIds))].filter((id) => byId.has(id));
  return {
    version: SAVED_CLAIMS_VERSION,
    bindingVersion: NARRATIVE_BINDING_VERSION,
    claims,
    facts: cited.slice(0, SAVED_CLAIM_MAX_FACTS).map((id) => byId.get(id) as SavedClaimFact),
    factsTruncated: cited.length > SAVED_CLAIM_MAX_FACTS,
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
