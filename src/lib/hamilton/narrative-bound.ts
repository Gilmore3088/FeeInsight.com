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
 * A filing figure (a credit union's or bank's filed fee income, assets or deposits, or a filed peer
 * median; claim-evidence.ts) binds only to a fact of the institution, metric, quarter and period
 * basis the sentence states (#1077, claim contract step 2): another bank's figure is
 * `wrong_institution`, another quarter's `wrong_period`, a year-to-date total stated as a quarter
 * (or the reverse) `wrong_basis`, and another institution's figure stated as "your" own
 * `account_as_subject`. A sentence that does not name the figure's metric does not bind to it.
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
  normalizeFrequency,
  type HamiltonDerivedFact,
  type HamiltonEvidenceBundle,
  type HamiltonEvidenceFact,
} from "./evidence-contract";
import { extractFigures, type NarrativeFigure } from "./figure-check";
import { findUnrequestedAdvice } from "./workspace/four-roles";

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
export const FILING_CONTRADICTED_LIMITATION =
  "Some sentences were left out because a figure in them did not match its filing for that institution, quarter or period.";

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
  | "median_as_fee"
  /** A year-to-date filing total stated as a quarter, or a quarter as year to date. */
  | "wrong_basis"
  /** Another institution's filing figure stated as the reader's own ("your"). */
  | "account_as_subject";

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
  /**
   * For a written answer: the basis of a reading sentence whose figure is an index statistic
   * (written-answer-binding.ts). The sentence stays Hamilton's reading; this says where its
   * figure comes from.
   */
  readingBasis?: Array<{ text: string; basis: string }>;
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
  /**
   * The reader's own institution: "your", "our" or "we" in a sentence that names no institution
   * means it. Unknown (null or absent), such a sentence binds no filing figure.
   */
  accountInstitutionId?: number | null;
  /**
   * The research subject: a sentence that names no institution and carries none from the one
   * before is about it, for filing figures. With none, such a sentence binds no filing figure.
   */
  researchInstitutionId?: number | null;
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

const QUARTER_END = /^20\d{2}-(?:03-31|06-30|09-30|12-31)$/;
const NCUA_URL = /^https:\/\/(?:www\.)?ncua\.gov\//i;

/**
 * Valid by its evidence class (claim contract 1.4). A fee record needs its catalog row and a source
 * document. A filing needs its institution, a quarter-end date, a metric, a period basis, its table
 * and its natural key; an NCUA call line also its ncua.gov filing URL. No other class is valid
 * as an observed record.
 */
function validObserved(fact: HamiltonEvidenceFact): boolean {
  const valueOk = (fact.status === "published" || fact.status === "verified")
    && typeof fact.value === "number" && Number.isFinite(fact.value) && fact.value >= 0;
  const evidenceClass = fact.source.evidenceClass ?? "fee_record";
  if (evidenceClass === "filing") {
    const owner = fact.scope.institutionId;
    return valueOk && owner !== null && Number.isSafeInteger(owner) && owner > 0
      && typeof fact.scope.reportingDate === "string" && QUARTER_END.test(fact.scope.reportingDate)
      && !!fact.scope.metric && !!fact.scope.periodBasis && !!fact.source.table && fact.source.recordKey === fact.id
      && (fact.source.table !== "institution_call_report_items" || fact.source.urls.some((url) => NCUA_URL.test(url)));
  }
  if (evidenceClass !== "fee_record") return false;
  const rowId = Number(fact.source.recordId);
  return valueOk
    && Number.isSafeInteger(rowId) && rowId > 0
    && fact.source.sourceDocumentIds.length > 0
    && fact.source.sourceDocumentIds.every((id) => Number.isSafeInteger(id) && id > 0);
}

/** The quarter end before a quarter end in the same year; null for the first quarter. */
function priorQuarterEnd(date: string): string | null {
  const prior: Record<string, string> = { "06-30": "03-31", "09-30": "06-30", "12-31": "09-30" };
  const end = prior[date.slice(5)];
  return end ? `${date.slice(0, 4)}-${end}` : null;
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
    // A filed peer median: a named group, and every peer's filing of its metric, quarter and basis.
    if (derived.scope.metric && (!derived.scope.cohortKey || inputs.some((fact) => fact!.scope.metric !== derived.scope.metric
      || fact!.scope.periodBasis !== derived.scope.periodBasis || fact!.scope.reportingDate !== derived.scope.reportingDate))) return false;
    const median = medianOf(values);
    return median !== null && Math.abs(median - derived.value) <= 0.005;
  }
  if (derived.derivation.kind === "ytd_to_quarter") {
    // A standalone quarter: this quarter's year-to-date filing less the prior quarter's, same institution and metric.
    const owner = derived.scope.institutionId;
    const date = derived.scope.reportingDate;
    const prior = typeof date === "string" && QUARTER_END.test(date) ? priorQuarterEnd(date) : null;
    if (owner === null || !prior || values.length !== 2 || derived.scope.periodBasis !== "standalone_quarter") return false;
    if (inputs.some((fact) => fact!.scope.institutionId !== owner || fact!.scope.metric !== derived.scope.metric
      || fact!.scope.periodBasis !== "ytd" || fact!.unit !== derived.unit)) return false;
    if (inputs[0]!.scope.reportingDate !== date || inputs[1]!.scope.reportingDate !== prior) return false;
    return Math.abs(values[0] - values[1] - derived.value) <= 0.005;
  }
  if (derived.derivation.kind === "ratio") {
    // Numerator over denominator, both one institution's figures for the same date.
    if (values.length !== 2 || values[1] <= 0) return false;
    const [numerator, denominator] = inputs;
    if (derived.derivation.denominatorFactId !== null && derived.derivation.denominatorFactId !== denominator!.id) return false;
    if (numerator!.scope.institutionId !== denominator!.scope.institutionId || numerator!.scope.reportingDate !== denominator!.scope.reportingDate
      || numerator!.unit !== denominator!.unit) return false;
    if (derived.scope.institutionId !== null && derived.scope.institutionId !== numerator!.scope.institutionId) return false;
    const ratio = values[0] / values[1];
    if (derived.unit === "ratio") return Math.abs(ratio - derived.value) <= 1e-6;
    if (derived.unit === "percent") return Math.abs(ratio * 100 - derived.value) <= 0.05 + 1e-9;
    return false;
  }
  // An institution's own value rests on its validated inputs; a kind this check does not know never holds.
  return derived.derivation.kind === "institution_value";
}

/** A filing figure or filed statistic (claim-evidence.ts): its scope names a metric. Fee records carry none. */
function claimRecord(record: EvidenceRecord): boolean {
  return typeof record.scope.metric === "string" && record.scope.metric.length > 0;
}

/** Narrower income lines the broad filed fee income never stands for (answer-interpretations: overdraft-only income). */
const NARROW_INCOME = /\b(?:overdraft|nsf|insufficient[- ]funds?|interchange|atm|wire)\s+(?:fee\s+)?(?:revenue|income)\b/i;
const FEE_INCOME_WORDS = /\bfee[- ](?:income|revenue)\b|\bservice[- ]charges?\b|\bfee-based income\b/i;
/** The words that name each filing metric. A metric not listed is never named, so it never binds. */
const METRIC_WORDS: Record<string, RegExp> = {
  service_charge_income: FEE_INCOME_WORDS,
  "call:acct_131": FEE_INCOME_WORDS,
  total_revenue: /\btotal (?:revenue|income)\b/i,
  total_assets: /\bassets\b/i,
  total_deposits: /\bdeposits\b/i,
  fee_income_ratio: /\bfee[- ]income ratio\b|\bshare of (?:total )?revenue\b/i,
  "call:acct_902": /\bshare[- ]draft balances?\b|\bchecking balances?\b/i,
  "call:acct_657": /\bregular[- ]share balances?\b|\bsavings balances?\b/i,
  "call:acct_380": /\bdividends?\b/i,
  "call:acct_452": /\bshare[- ]draft accounts?\b|\bchecking accounts?\b/i,
  "call:acct_564a": /\b(?:employees?|staff)\b/i,
};

/** True when the sentence names the metric a filing figure is. */
function metricNamed(text: string, metric: string): boolean {
  const words = METRIC_WORDS[metric];
  if (!words || !words.test(text)) return false;
  return words !== FEE_INCOME_WORDS || !NARROW_INCOME.test(text);
}

const ORDINAL_QUARTER: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };
const QUARTER_END_MONTH: Record<string, number> = { march: 1, june: 2, september: 3, december: 4 };
const YTD_WORDS = /\byear[- ]to[- ]date\b|\bytd\b|\bfirst (?:half|six months|nine months)\b|\bso far this year\b|\bthrough (?:the )?(?:end of the )?(?:first|second|third|fourth) quarter\b/i;
const QUARTER_WORDS = /\bquarter(?:ly)?\b|\bQ[1-4]\b|\bstandalone\b/i;

/** The quarters a sentence states ("Q2 2026", "the second quarter of 2026", "June 30, 2026"), as "2026-Q2". */
function statedQuarters(text: string, years: readonly string[]): string[] {
  const only = new Set(years).size === 1 ? years[0] : null;
  const out = new Set<string>();
  for (const m of text.matchAll(/\bQ([1-4])(?:\s*(?:of\s+)?(20\d{2}))?\b/gi)) {
    const year = m[2] ?? only;
    if (year) out.add(`${year}-Q${m[1]}`);
  }
  for (const m of text.matchAll(/\b(20\d{2})[\s-]?Q([1-4])\b/gi)) out.add(`${m[1]}-Q${m[2]}`);
  for (const m of text.matchAll(/\b(first|second|third|fourth)[\s-]quarter(?:\s+of)?(?:\s+(20\d{2}))?/gi)) {
    const year = m[2] ?? only;
    if (year) out.add(`${year}-Q${ORDINAL_QUARTER[m[1].toLowerCase()]}`);
  }
  for (const m of text.matchAll(/\b(March|June|September|December)\s+(?:30|31),?\s+(20\d{2})\b/gi)) {
    out.add(`${m[2]}-Q${QUARTER_END_MONTH[m[1].toLowerCase()]}`);
  }
  for (const m of text.matchAll(/\bfirst (half|nine months)(?:\s+of)?(?:\s+(20\d{2}))?/gi)) {
    const year = m[2] ?? only;
    if (year) out.add(`${year}-Q${m[1].toLowerCase() === "half" ? 2 : 3}`);
  }
  return [...out];
}

/** A record's quarter ("2026-Q2") from its quarter-end reporting date; null when it has none. */
function quarterOf(record: EvidenceRecord): string | null {
  const date = record.scope.reportingDate;
  if (!date || !QUARTER_END.test(date)) return null;
  return `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
}

/** Year to date when the sentence says so; a standalone quarter when it says quarter and not year to date. */
function statedBasis(text: string): "ytd" | "standalone_quarter" | null {
  if (YTD_WORDS.test(text)) return "ytd";
  return QUARTER_WORDS.test(text) ? "standalone_quarter" : null;
}

/** "Your", "our" or "we": the reader's own institution, in a sentence that names none. */
const PERSONAL = /\b(?:your|yours|our|ours|we|us)\b/i;

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
      normalizeFrequency(fact.frequency), fact.unit].join("|");
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
  | { kind: "contradicted"; reason: OmitReason; filing: boolean };

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
  const filingOmitted = new Set<number>();
  const account = input.accountInstitutionId ?? null;
  const research = input.researchInstitutionId ?? null;

  let carried: number[] = [];
  for (const { text } of splitIntoSentences(input.text)) {
    const named = namedIn(text, names);
    const subjects = named.length > 0 ? named : carried;
    if (named.length > 0) carried = named;
    // Whose filing figure the sentence states: "your" with no institution named is the reader's own,
    // no subject at all is the research subject's; null when that institution is not known.
    const personal = named.length === 0 && PERSONAL.test(text);
    const claimSubjects: number[] | null = personal ? (account !== null ? [account] : null)
      : subjects.length > 0 ? subjects : research !== null ? [research] : null;

    if (INSTRUCTION_TEXT.test(text)) {
      binding.omitted.push({ text, reason: "instruction_text" });
      continue;
    }
    if (findUnrequestedAdvice(text.replace(/"[^"]*"/g, ""))) {
      binding.omitted.push({ text, reason: "advice" });
      continue;
    }
    const figures = extractFigures(text);
    if (figures.length === 0) {
      binding.supported.push({ text, factIds: [] });
      continue;
    }
    const years = [...text.matchAll(YEAR)].map((m) => m[1]);
    const quarters = statedQuarters(text, years);
    const basis = statedBasis(text);

    /**
     * Whether a filing figure fits the sentence: "skip" when the sentence does not name its metric
     * or its owner is unknown, an omit reason when its institution, quarter, year or basis is not
     * the one the sentence states, else null.
     */
    const claimFit = (record: EvidenceRecord, owner: number | null): OmitReason | "skip" | null => {
      if (!metricNamed(text, record.scope.metric as string)) return "skip";
      if (owner !== null) {
        if (claimSubjects === null) return "skip";
        if (claimSubjects.length > 0 && !claimSubjects.includes(owner)) return personal ? "account_as_subject" : "wrong_institution";
      }
      const quarter = quarterOf(record);
      if (quarters.length > 0 ? !quarter || !quarters.includes(quarter) : years.length > 0 && !years.includes(String(record.scope.reportingDate).slice(0, 4))) {
        return "wrong_period";
      }
      // A first quarter's year-to-date total is that quarter, so only later quarters can be the wrong basis.
      const firstQuarter = quarter?.endsWith("Q1") ?? false;
      if (basis && !firstQuarter && (record.scope.periodBasis === "ytd" || record.scope.periodBasis === "standalone_quarter")
        && record.scope.periodBasis !== basis) return "wrong_basis";
      return null;
    };

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
      const found: { reason: OmitReason | null; filing: boolean } = { reason: null, filing: false };
      const contradict = (reason: OmitReason, filing = false) => {
        if (found.reason) return;
        found.reason = reason;
        found.filing = filing;
      };

      for (const fact of validFacts.filter(sameValue)) {
        // A dollar figure for a rate fee contradicts it; a percent that happens to equal a dollar fee is a coincidence.
        if (fact.unit !== unit) { if (fact.unit === "percent") contradict("wrong_unit"); continue; }
        if (claimRecord(fact)) {
          const fit = claimFit(fact, fact.scope.institutionId);
          if (fit === "skip") continue;
          if (fit) { contradict(fit, true); continue; }
          if (!claimBindingMatches(fact, { unit, value: figure.value })) continue;
          ids.push(fact.id);
          continue;
        }
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
        const kind = derived.derivation.kind;
        if (claimRecord(derived)) {
          // A filed peer median names a group, not an institution; a quarter or ratio is its institution's own figure.
          const fit = claimFit(derived, kind === "peer_median" ? null : derived.scope.institutionId);
          if (fit === "skip") continue;
          if (fit) { contradict(fit, true); continue; }
          if (kind === "peer_median") {
            const named = medianNear(text, figure);
            if (named === "mean") continue;
            if (named === "other") { contradict("median_as_fee", true); continue; }
          } else if (kind !== "ytd_to_quarter" && kind !== "ratio") continue;
          ids.push(derived.id, ...derived.derivation.inputFactIds);
          continue;
        }
        const derivedPeriod = inPeriod(derived);
        if (derivedPeriod === "no") { contradict("wrong_period"); continue; }
        if (derivedPeriod === "unknown") continue;
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
      if (found.reason) return { kind: "contradicted", reason: found.reason, filing: found.filing };
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
      if (contradicted.filing) filingOmitted.add(binding.omitted.length);
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
  const contradictedBy = (filing: boolean) => binding.omitted.some((o, index) => filingOmitted.has(index) === filing
    && o.reason !== "advice" && o.reason !== "instruction_text" && o.reason !== "no_evidence" && o.reason !== "conflicting_sources" && o.reason !== "median_as_fee");
  if (contradictedBy(false)) limitations.push(CONTRADICTED_LIMITATION);
  if (contradictedBy(true)) limitations.push(FILING_CONTRADICTED_LIMITATION);
  limitations.push(...conflictLines.values());
  if (binding.interpretation.length > 0) limitations.push(INTERPRETATION_LIMITATION);
  binding.limitations = [...new Set(limitations)];
  return binding;
}

/** The narrative a reader may see as Hamilton's finding: the supported sentences, in order. */
export function supportedText(binding: NarrativeBinding): string {
  return binding.supported.map((s) => s.text).join(" ");
}
