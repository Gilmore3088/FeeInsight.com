/**
 * Bounded narrative for Hamilton's supported research tasks (#981, H06-T06): lookup, peer list and
 * comparison. Every sentence of a written narrative that states a dollar figure or a percentage
 * must bind to a validated record in the answer's evidence bundle (evidence-contract.ts):
 *
 * - an observed fee record of the institution the sentence is about, with a source record and a
 *   source document, whose value, unit and period match the figure (`claimBindingMatches`), or
 * - a derivation whose inputs are in the bundle and still recompute to its value, stated as a
 *   comparison or a change in the direction its sign gives, or a peer median stated as the median
 *   (its inputs are one published record per peer; stated as a bank's own fee it is left out).
 *
 * Each sentence ends in one of four places:
 * - `supported`: every figure binds; the sentence keeps the IDs of the records it rests on.
 * - `interpretation`: a figure the bundle does not hold, or holds only without a source. The
 *   sentence may be shown only under the plain label `INTERPRETATION_LABEL`.
 * - `omitted`: a figure the bundle contradicts (another bank's fee, a gap read as a fee, the wrong
 *   direction or year, a dollar figure for a rate fee, one side of a source conflict), advice on a
 *   fee, instruction-like text, or any figure when the bundle holds no evidence at all.
 * - qualitative sentences with no figure stay in `supported` with no record IDs.
 *
 * Missing, unavailable and conflicting evidence each add one plain limitation line. No line here
 * invents a figure, and none tells the bank what to do with a fee. Source text (fee names,
 * conditions, document text) is data: it is never read as an instruction and never copied into a
 * limitation line. Deterministic and pure: no model call, no read, no write.
 */
import { splitIntoSentences } from "./citation-gate";
import { proseFeeName } from "./workspace/names";
import {
  claimBindingMatches,
  medianOf,
  type HamiltonDerivedFact,
  type HamiltonEvidenceBundle,
  type HamiltonEvidenceFact,
} from "./evidence-contract";
import { extractFigures, type NarrativeFigure } from "./figure-check";
import { RECOMMENDATION } from "./workspace/four-roles";

export const NARRATIVE_BINDING_VERSION = 1 as const;

/** The label any shown interpretation sentence sits under. */
export const INTERPRETATION_LABEL = "Hamilton's reading, not tied to a fee record";

export const NO_EVIDENCE_LIMITATION =
  "Hamilton had no fee records for this answer, so its figures are left out.";
export const UNSOURCED_FIGURE_LIMITATION =
  "Some figures have no source document on record, so they are shown as Hamilton's reading only.";
export const INTERPRETATION_LIMITATION =
  "Some sentences state figures that are not tied to a fee record. They are listed separately as Hamilton's reading.";
export const MEDIAN_AS_FEE_LIMITATION =
  "Some sentences were left out because they stated the peer median as an institution's own fee.";
export const CONTRADICTED_LIMITATION =
  "Some sentences were left out because a figure in them did not match its fee record.";

export type OmitReason =
  | "advice"
  | "instruction_text"
  | "no_evidence"
  | "wrong_institution"
  | "gap_as_fee"
  | "wrong_direction"
  | "wrong_period"
  | "wrong_unit"
  | "conflicting_sources"
  | "median_as_fee";

export interface BoundSentence {
  text: string;
  /** Records the sentence rests on; empty for a sentence with no figure. */
  factIds: string[];
}

export interface NarrativeBinding {
  version: typeof NARRATIVE_BINDING_VERSION;
  supported: BoundSentence[];
  interpretation: string[];
  omitted: Array<{ text: string; reason: OmitReason }>;
  limitations: string[];
}

export interface BindNarrativeInput {
  text: string;
  evidence: HamiltonEvidenceBundle | null | undefined;
  /** Institution names as the narrative writes them, by institution ID. */
  names?: ReadonlyMap<number, string>;
  /** The reader's question: a figure it names may be restated. */
  question?: string;
  /** Plain labels of the tools that failed for this answer ("fee lookup"). */
  unavailable?: string[];
}

/** Text that reads as an instruction to the writer, not as a finding. */
const INSTRUCTION_TEXT =
  /\b(?:ignore|disregard|override)\s+(?:all\s+|any\s+|the\s+|previous\s+|prior\s+|above\s+)*(?:instructions?|rules?|prompts?|checks?)\b|\bsystem\s+prompt\b|\b(?:mark|label|treat)\s+(?:every|all|each|this|these)\s+(?:figures?|claims?|answers?|sentences?)\s+as\s+verified\b/i;
const COMPARISON = /\b(?:higher|lower|more|less|above|below|over|under|than|gap|difference|apart|exceeds?|rose|fell|increased?|decreased?|declined?|up|down|change[ds]?)\b/i;
const UP = /\b(?:higher|more|above|over|exceeds?|rose|rises|increased?|increases|up)\b/i;
const DOWN = /\b(?:lower|less|below|under|fell|falls|decreased?|decreases|declined?|declines|down)\b/i;
const YEAR = /\b(20\d{2})\b/g;
/** Words that say a figure is the peers' median (#981, H06-T04). An average or mean is a different figure. */
const MEDIAN_WORD = /\b(?:median|midpoint|middle)\b/i;
const MEAN_WORD = /\b(?:average|mean)\b/i;

type EvidenceRecord = HamiltonEvidenceFact | HamiltonDerivedFact;

function validObserved(fact: HamiltonEvidenceFact): boolean {
  const rowId = Number(fact.source.recordId);
  return (fact.status === "published" || fact.status === "verified")
    && typeof fact.value === "number" && Number.isFinite(fact.value) && fact.value >= 0
    && Number.isSafeInteger(rowId) && rowId > 0
    && fact.source.sourceDocumentIds.length > 0
    && fact.source.sourceDocumentIds.every((id) => Number.isSafeInteger(id) && id > 0);
}

/** A derivation holds when every input is a validated record here and it still recomputes. */
function derivationHolds(derived: HamiltonDerivedFact, byId: ReadonlyMap<string, HamiltonEvidenceFact>): boolean {
  if (typeof derived.value !== "number" || !Number.isFinite(derived.value)) return false;
  const inputs = derived.derivation.inputFactIds.map((id) => byId.get(id));
  if (inputs.length === 0 || inputs.some((fact) => !fact || !validObserved(fact))) return false;
  const values = inputs.map((fact) => fact!.value as number);
  if (derived.derivation.kind === "difference") {
    return values.length === 2 && Math.abs(values[0] - values[1] - derived.value) <= 0.005;
  }
  if (derived.derivation.kind === "percent_change") {
    if (values.length !== 2 || values[1] === 0) return false;
    return Math.abs(((values[0] - values[1]) / values[1]) * 100 - derived.value) <= 0.05 + 1e-9;
  }
  if (derived.derivation.kind === "peer_median") {
    // One record per peer, each a dollar fee of the median's own category, recomputing to its value.
    const peers = inputs.map((fact) => fact!.scope.institutionId);
    if (derived.unit !== "usd" || peers.some((id) => id === null) || new Set(peers).size !== peers.length) return false;
    if (inputs.some((fact) => fact!.unit !== "usd" || fact!.scope.feeCategory !== derived.scope.feeCategory)) return false;
    const median = medianOf(values);
    return median !== null && Math.abs(median - derived.value) <= 0.005;
  }
  return true;
}

/**
 * How the sentence names a figure: "median" when a median word sits within 40 characters of it,
 * "mean" when an average or mean does (a different figure, never bound to the median), else "other".
 */
function medianNear(text: string, figure: NarrativeFigure): "median" | "mean" | "other" {
  const window = text.slice(Math.max(0, figure.index - 40), figure.index + figure.raw.length + 40);
  if (MEAN_WORD.test(window)) return "mean";
  return MEDIAN_WORD.test(window) ? "median" : "other";
}

/** A record's reporting period. A publish or retrieval date is not one, so an undated record states no year. */
function periodOf(fact: EvidenceRecord): string | null {
  return fact.scope.reportingDate;
}

/** Same institution, fee, product, frequency and unit, different values from different documents. */
function conflictGroups(facts: HamiltonEvidenceFact[]): Map<string, HamiltonEvidenceFact[]> {
  const groups = new Map<string, HamiltonEvidenceFact[]>();
  for (const fact of facts) {
    const key = [fact.scope.institutionId, fact.scope.feeCategory, fact.scope.product?.trim().toLowerCase(),
      fact.frequency?.trim().toLowerCase(), fact.unit].join("|");
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  const conflicts = new Map<string, HamiltonEvidenceFact[]>();
  for (const [key, members] of groups) {
    const values = new Set(members.map((fact) => fact.value));
    const documents = new Set(members.flatMap((fact) => fact.source.sourceDocumentIds));
    if (values.size > 1 && documents.size > 1) conflicts.set(key, members);
  }
  return conflicts;
}

function money(value: number): string {
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

/** Institutions the sentence names, in the order it names them. */
function namedIn(text: string, names: ReadonlyMap<number, string>): number[] {
  const lower = text.toLowerCase();
  return [...names.entries()]
    .map(([id, name]) => ({ id, at: name.trim() ? lower.indexOf(name.trim().toLowerCase()) : -1 }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((hit) => hit.id);
}

/** The direction words next to a figure: just after it first ("$25 lower"), then just before it ("rose 10%"). */
function directionNear(text: string, figure: NarrativeFigure): 1 | -1 | 0 {
  const after = text.slice(figure.index + figure.raw.length, figure.index + figure.raw.length + 30);
  const before = text.slice(Math.max(0, figure.index - 30), figure.index);
  for (const window of [after, before]) {
    const up = UP.exec(window);
    const down = DOWN.exec(window);
    if (up && (!down || up.index < down.index)) return 1;
    if (down) return -1;
  }
  return 0;
}

type FigureOutcome =
  | { kind: "bound"; ids: string[] }
  | { kind: "asked" }
  | { kind: "unsourced" }
  | { kind: "unmatched" }
  | { kind: "contradicted"; reason: OmitReason };

export function bindNarrative(input: BindNarrativeInput): NarrativeBinding {
  const names = input.names ?? new Map<number, string>();
  const facts = input.evidence?.facts ?? [];
  const derivations = input.evidence?.derivations ?? [];
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const validFacts = facts.filter(validObserved);
  const unsourcedFacts = facts.filter((fact) => !validObserved(fact));
  const validDerivations = derivations.filter((derived) => derivationHolds(derived, byId));
  const conflicts = conflictGroups(validFacts);
  const conflicted = new Set([...conflicts.values()].flat().map((fact) => fact.id));
  const asked = input.question ? extractFigures(input.question) : [];
  const hasEvidence = validFacts.length + validDerivations.length + unsourcedFacts.length > 0;

  const binding: NarrativeBinding = { version: NARRATIVE_BINDING_VERSION, supported: [], interpretation: [], omitted: [], limitations: [] };
  const limitations: string[] = [];
  for (const label of input.unavailable ?? []) {
    limitations.push(`The ${label.trim()} was not available for this answer, so figures that depend on it are left out.`);
  }
  if (!hasEvidence) limitations.push(NO_EVIDENCE_LIMITATION);
  const conflictLines = new Map<string, string>();

  let carried: number[] = [];
  for (const { text } of splitIntoSentences(input.text)) {
    const named = namedIn(text, names);
    const subjects = named.length > 0 ? named : carried;
    if (named.length > 0) carried = named;

    if (INSTRUCTION_TEXT.test(text)) {
      binding.omitted.push({ text, reason: "instruction_text" });
      continue;
    }
    if (RECOMMENDATION.test(text.replace(/"[^"]*"/g, ""))) {
      binding.omitted.push({ text, reason: "advice" });
      continue;
    }
    const figures = extractFigures(text);
    if (figures.length === 0) {
      binding.supported.push({ text, factIds: [] });
      continue;
    }
    const years = [...text.matchAll(YEAR)].map((m) => m[1]);

    const outcome = (figure: NarrativeFigure): FigureOutcome => {
      const tolerance = Math.max(figure.tolerance, 0.005);
      const unit = figure.kind === "usd" ? "usd" : "percent";
      if (asked.some((q) => q.kind === figure.kind && Math.abs(q.value - figure.value) <= tolerance)) return { kind: "asked" };
      const sameValue = (record: EvidenceRecord) =>
        typeof record.value === "number" && Math.abs(Math.abs(record.value) - figure.value) <= tolerance;
      // "yes" when the sentence names no year or the record's own; "no" when the record has another;
      // "unknown" when the record is undated, so it neither supports nor contradicts the year.
      const inPeriod = (record: EvidenceRecord): "yes" | "no" | "unknown" => {
        if (years.length === 0) return "yes";
        const period = periodOf(record);
        if (period === null) return "unknown";
        return years.includes(period.slice(0, 4)) ? "yes" : "no";
      };

      const ids: string[] = [];
      const found: { reason: OmitReason | null } = { reason: null };
      const contradict = (reason: OmitReason) => { found.reason ??= reason; };

      for (const fact of validFacts.filter(sameValue)) {
        // A dollar figure for a rate fee contradicts it; a percent that happens to equal a dollar fee is a coincidence.
        if (fact.unit !== unit) { if (fact.unit === "percent") contradict("wrong_unit"); continue; }
        const subject = subjects.length === 0 ? undefined : fact.scope.institutionId;
        if (subject !== undefined && !subjects.includes(subject as number)) { contradict("wrong_institution"); continue; }
        if (!claimBindingMatches(fact, { unit, value: figure.value })) continue;
        const factPeriod = inPeriod(fact);
        if (factPeriod === "no") { contradict("wrong_period"); continue; }
        if (factPeriod === "unknown") continue;
        if (conflicted.has(fact.id)) { contradict("conflicting_sources"); continue; }
        ids.push(fact.id);
      }
      for (const derived of validDerivations.filter(sameValue)) {
        if (derived.unit !== unit) { if (derived.unit === "percent") contradict("wrong_unit"); continue; }
        if (!claimBindingMatches({ ...derived, value: Math.abs(derived.value as number) }, { unit, value: figure.value })) continue;
        const derivedPeriod = inPeriod(derived);
        if (derivedPeriod === "no") { contradict("wrong_period"); continue; }
        if (derivedPeriod === "unknown") continue;
        const kind = derived.derivation.kind;
        // A peer median binds only where the sentence says it is the median; stated as a bank's
        // own fee it is left out (#1414 item 8, #981 H06-T04).
        if (kind === "peer_median") {
          const named = medianNear(text, figure);
          if (named === "mean") continue;
          if (named === "other") { contradict("median_as_fee"); continue; }
          ids.push(derived.id, ...derived.derivation.inputFactIds);
          continue;
        }
        if (kind === "institution_value") {
          const owner = derived.scope.institutionId;
          if (subjects.length > 0 && owner !== null && !subjects.includes(owner)) { contradict("wrong_institution"); continue; }
          ids.push(derived.id, ...derived.derivation.inputFactIds);
          continue;
        }
        // A gap or a change is never a fee: it binds only to a sentence that states a comparison.
        if (!COMPARISON.test(text)) { contradict("gap_as_fee"); continue; }
        const inputs = derived.derivation.inputFactIds.map((id) => byId.get(id)!);
        const [first, second] = inputs.map((fact) => fact.scope.institutionId);
        let sign = Math.sign(derived.value as number);
        if (kind === "difference" && subjects.length > 0) {
          if (subjects[0] === second && second !== first) sign = -sign;
          else if (subjects[0] !== first) { contradict("wrong_institution"); continue; }
        }
        if (kind === "percent_change" && subjects.length > 0 && !subjects.includes(first as number)) {
          contradict("wrong_institution");
          continue;
        }
        const stated = directionNear(text, figure);
        if (sign !== 0 && stated !== 0 && stated !== sign) { contradict("wrong_direction"); continue; }
        if (sign !== 0 && stated === 0) continue;
        ids.push(derived.id, ...derived.derivation.inputFactIds);
      }
      if (ids.length > 0) return { kind: "bound", ids };
      if (found.reason) return { kind: "contradicted", reason: found.reason };
      if (unsourcedFacts.some((fact) => sameValue(fact) && fact.unit === unit)) return { kind: "unsourced" };
      return { kind: "unmatched" };
    };

    if (!hasEvidence) {
      binding.omitted.push({ text, reason: "no_evidence" });
      continue;
    }
    const outcomes = figures.map(outcome);
    const contradicted = outcomes.find((o): o is Extract<FigureOutcome, { kind: "contradicted" }> => o.kind === "contradicted");
    if (contradicted) {
      binding.omitted.push({ text, reason: contradicted.reason });
      if (contradicted.reason === "conflicting_sources") {
        for (const [key, members] of conflicts) {
          if (conflictLines.has(key) || !members.some((fact) => figures.some((f) => Math.abs((fact.value as number) - f.value) <= Math.max(f.tolerance, 0.005)))) continue;
          const id = members[0].scope.institutionId;
          const who = id === null ? "one institution" : names.get(id) ?? `Institution ${id}`;
          const fee = members[0].scope.feeCategory ? proseFeeName(members[0].scope.feeCategory) : "this";
          const values = [...new Set(members.map((fact) => fact.value as number))].sort((a, b) => a - b).map(money);
          conflictLines.set(key, `Sources disagree on the ${fee} fee for ${who}: ${values.join(" and ")}. Hamilton does not pick one.`);
        }
      }
      continue;
    }
    if (outcomes.every((o) => o.kind === "bound" || o.kind === "asked")) {
      binding.supported.push({ text, factIds: [...new Set(outcomes.flatMap((o) => (o.kind === "bound" ? o.ids : [])))] });
      continue;
    }
    binding.interpretation.push(text);
    if (outcomes.some((o) => o.kind === "unsourced")) limitations.push(UNSOURCED_FIGURE_LIMITATION);
  }

  if (binding.omitted.some((o) => o.reason === "median_as_fee")) limitations.push(MEDIAN_AS_FEE_LIMITATION);
  if (binding.omitted.some((o) => o.reason !== "advice" && o.reason !== "instruction_text" && o.reason !== "no_evidence" && o.reason !== "conflicting_sources" && o.reason !== "median_as_fee")) {
    limitations.push(CONTRADICTED_LIMITATION);
  }
  limitations.push(...conflictLines.values());
  if (binding.interpretation.length > 0) limitations.push(INTERPRETATION_LIMITATION);
  binding.limitations = [...new Set(limitations)];
  return binding;
}

/** The narrative a reader may see as Hamilton's finding: the supported sentences, in order. */
export function supportedText(binding: NarrativeBinding): string {
  return binding.supported.map((s) => s.text).join(" ");
}
