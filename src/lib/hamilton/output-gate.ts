/**
 * Hamilton's one output gate (#1077, claim contract step 4; design 2026-10-25, section 2).
 *
 * `gateAnswer` runs the checks every surface runs today and combines them into one verdict with
 * reasons: the shared evidence gate (`checkAnswerEvidence`: figures, advice, internal names, house
 * wording, interpretation rules), the sentence binding (fee records, filings, the question's
 * premises), the broad cause rule step 3 runs in shadow (its `shadowProblems`, as an input) and the
 * account-institution rule that only the memo ran. Pure and synchronous: no reads, no model calls.
 *
 * Step 4 runs it in SHADOW: callers compute the verdict and record it beside today's decision
 * (output-gate-shadow.ts); today's gates still decide what a reader is shown or held. A later step
 * switches enforcement on once the recorded disagreements have been counted.
 *
 * Status (design 2.3): `held` on any critical failure or when nothing is left to show;
 * `ready_partial` when only non-critical failures remain and they can be cut sentence by sentence;
 * `validated` with no failures. Untraced figures stay critical (James's line of 2026-10-15,
 * answer-gate.ts) until he decides otherwise.
 */

import { parseAnalyzeResponse } from "@/components/hamilton/analyze/parse-response";
import { CHEAP_WORDING, checkAnswerEvidence, type AnswerEvidenceCheck } from "./answer-gate";
import { writtenAnswerBinding, writtenAnswerCheck } from "./answer-save";
import { claimEvidenceFacts } from "./claim-evidence";
import type { HamiltonEvidenceBundle } from "./evidence-contract";
import type { HamiltonBriefingEvidence } from "./institution-briefing";
import { bindNarrative, type NarrativeBinding, type OmitReason } from "./narrative-bound";
import { causeLines, causeShadowInput, PREMISE_REASONS } from "./output-gate-signals";
import { PIPELINE_TERMS, findUnrequestedAdvice } from "./workspace/four-roles";
import {
  indexStatisticsStated,
  localCompetitorPrices,
  withoutOmitted,
  withoutSentences,
  writtenAnswerFeeEvidence,
  writtenAnswerIndexStats,
  writtenAnswerProse,
  type WrittenAnswerSections,
} from "./written-answer-binding";
import { MIN_LOCAL_PEERS_FOR_POSITION, MIN_PEERS_FOR_POSITION } from "./workspace/scenario";
import { proseFeeName } from "./workspace/names";
import { extractFigures } from "./figure-check";
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import type { AnswerToolEvidence } from "./written-answer-evidence";

/** 2: the `thin_peer_group` failure code (T5, #1726). A version 1 record is still read (output-gate-shadow.ts). */
export const OUTPUT_GATE_VERSION = 2 as const;
/** Every version a stored shadow record may carry. */
export const OUTPUT_GATE_VERSIONS = [1, 2] as const;
export type OutputGateVersion = (typeof OUTPUT_GATE_VERSIONS)[number];

/** `ask` is the free Ask bar's storyline, gated only by the replay (gate-replay.ts): the live Ask bar shows it with no gate. */
export type GateSurface = "written_answer" | "memo" | "report_section" | "simulate" | "ask";

/** What the answer was written from. Tool reads are server-observed, never browser text. */
export type GateEvidence =
  | { kind: "tool_reads"; toolOutputs: readonly unknown[]; reads: readonly AnswerToolEvidence[]; briefingEvidence?: readonly HamiltonBriefingEvidence[] }
  | {
    kind: "data"; data: unknown; bundle?: HamiltonEvidenceBundle | null; names?: ReadonlyMap<number, string>;
    /** False when the surface's check takes no question today (the memo's `checkAnswerEvidence(all, payload)`). */
    checkQuestion?: boolean;
    /** False when the surface's binding takes no account or research institution today (`memoBinding`). */
    bindIdentity?: boolean;
  };

export interface GateIdentity {
  researchInstitutionId: number | null;
  accountInstitutionId: number | null;
  accountInstitutionName?: string | null;
}

export interface GateInput {
  surface: GateSurface;
  /** Everything the reader would see. */
  text: string;
  /** The text the sentence binding reads, when it is not all of `text` (a memo binds its prose, not its questions). */
  bindText?: string;
  /** A written answer's sections; parsed from `text` when absent. */
  sections?: WrittenAnswerSections;
  evidence: GateEvidence;
  identity: GateIdentity;
  question?: string;
  /**
   * The broad cause rule's lines (shadow input). Defaults to the shared gate's `shadowProblems` (step 3,
   * read through `causeShadowInput`). "off" leaves every stated-cause
   * failure out, today's cause problem lines included, so a replay can tell what the rule alone decides.
   */
  cause?: readonly string[] | "off";
  /** A surface's own problem lines (the memo's fact-ID and wording checks). Each holds: none can be cut by sentence. */
  extra?: readonly string[];
}

export type GateStatus = "validated" | "ready_partial" | "held";

export type GateFailureCode =
  | OmitReason
  | "untraced_figure"
  | "internal_name"
  | "house_wording"
  | "interpretation_rule"
  | "filed_peer_conflict"
  | "causal_unsupported"
  | "account_identity"
  | "surface_rule"
  | "thin_peer_group"
  | "nothing_left";

export interface GateFailure {
  code: GateFailureCode;
  /** The problem line or the left-out sentence; written so it can be fed back to the model. */
  message: string;
  critical: boolean;
  /** Which check found it: the shared evidence gate, the binding, the cause rule (shadow input) or the identity rule. */
  source: "check" | "binding" | "cause" | "identity" | "surface" | "peers" | "status";
  /** The sentences a non-critical failure cuts from the view. */
  sentences?: string[];
}

export interface GateVerdict {
  version: typeof OUTPUT_GATE_VERSION;
  surface: GateSurface;
  status: GateStatus;
  /** `checkAnswerEvidence`'s result, exactly as today's gate computes it. */
  check: AnswerEvidenceCheck;
  /** The sentence binding, exactly as today's path computes it; null when there is none. */
  binding: NarrativeBinding | null;
  failures: GateFailure[];
  /** Correction lines for a premise the records contradict (the binding's). */
  corrections: string[];
  /** True when a rewrite could pass: there are failures and none needs fresh reads. */
  repairable: boolean;
}

/** The problem line that comes from conflicting filed peer reads (answer-interpretations.ts). */
const FILED_PEER_CONFLICT = /^Conflicting filed financial peer reads/;
/** Omit reasons the design (2.3) treats as critical; `premise_contradicted` only without a correction line. */
const CRITICAL_OMIT = new Set<OmitReason>(["account_as_subject", "instruction_text"]);
const LIST_MARKER = /^\s*(?:[-*+]|\d+\.)\s+|^\s*>\s*/;

/** The text's sentences, split as the binding splits them (withoutSentences). */
export function gateSentences(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => line.replace(LIST_MARKER, "").trim().split(/(?<=[.!?])\s+(?=[A-Z("'])/))
    .map((part) => part.trim()).filter(Boolean);
}

function institutionIdsOf(bundle: HamiltonEvidenceBundle | null | undefined): Set<number> {
  const ids = new Set<number>();
  for (const fact of [...(bundle?.facts ?? []), ...(bundle?.derivations ?? [])]) if (typeof fact.scope.institutionId === "number") ids.add(fact.scope.institutionId);
  return ids;
}

interface Evaluated {
  check: AnswerEvidenceCheck;
  binding: NarrativeBinding | null;
  /** The prose a reader would see once the binding's omitted sentences go. */
  shown: string;
  /** Institutions the evidence holds a fact for. */
  factInstitutions: Set<number>;
}

function evaluate(input: GateInput): Evaluated {
  const { evidence, identity, question } = input;
  if (evidence.kind === "tool_reads") {
    const sections = input.sections ?? parseAnalyzeResponse(input.text);
    const check = writtenAnswerCheck(input.text, evidence.toolOutputs, question,
      { briefingEvidence: evidence.briefingEvidence, toolResults: evidence.reads, institutionId: identity.researchInstitutionId });
    const binding = writtenAnswerBinding(input.text, evidence.toolOutputs, question,
      { toolResults: evidence.reads, institutionId: identity.researchInstitutionId, accountInstitutionId: identity.accountInstitutionId });
    const factInstitutions = new Set([
      ...institutionIdsOf(writtenAnswerFeeEvidence(evidence.toolOutputs)?.evidence),
      ...institutionIdsOf(evidence.reads.length ? claimEvidenceFacts(evidence.reads, identity.researchInstitutionId) : null),
    ]);
    return { check, binding, shown: writtenAnswerProse(withoutOmitted(sections, binding)), factInstitutions };
  }
  // A surface that runs today's checks with fewer inputs (the memo) says so, so the shadow compares like with like.
  const check = checkAnswerEvidence(input.text, evidence.data, evidence.checkQuestion === false ? {} : { question });
  const binding = evidence.bundle
    ? bindNarrative({ text: input.bindText ?? input.text, evidence: evidence.bundle, names: evidence.names, question,
      ...(evidence.bindIdentity === false ? {} : { accountInstitutionId: identity.accountInstitutionId, researchInstitutionId: identity.researchInstitutionId }) })
    : null;
  const omitted = new Set((binding?.omitted ?? []).map((o) => o.text.trim()));
  return { check, binding, shown: withoutSentences(input.text, omitted), factInstitutions: institutionIdsOf(evidence.bundle) };
}

/** Sentences a text-level problem can be pinned to, so it can be cut instead of holding the answer. */
export function sentencesFor(code: GateFailureCode, sentences: readonly string[]): string[] {
  switch (code) {
    case "advice": return sentences.filter((s) => findUnrequestedAdvice(s) !== null);
    case "internal_name": return sentences.filter((s) => PIPELINE_TERMS.test(s));
    case "house_wording": return sentences.filter((s) => CHEAP_WORDING.test(s));
    case "causal_unsupported": return sentences.filter((s) => causeLines(s).length > 0);
    default: return [];
  }
}

function checkCode(problem: string, figureProblem: boolean, cause: ReadonlySet<string>): GateFailureCode {
  if (figureProblem) return "untraced_figure";
  if (problem.startsWith("This reads as advice:")) return "advice";
  if (problem.startsWith("Internal name in the text:")) return "internal_name";
  if (problem.includes("is not house wording")) return "house_wording";
  if (FILED_PEER_CONFLICT.test(problem)) return "filed_peer_conflict";
  if (cause.has(problem)) return "causal_unsupported";
  return "interpretation_rule";
}

/** Words that call a figure a group's middle. "The middle 50%" is a band, not a median. */
const MEDIAN_WORDS = /\b(?:median|midpoint|typical|middle(?!\s*(?:50|half|fifty)\b))\b/gi;
/** Words that put the group in the bank's own market. */
const LOCAL_WORD = /\b(?:local|competitors?|competitor's|competitors'|market|nearby|area|peers\s+in\s+(?:the|its|their|your)\s+(?:county|city|market|area))\b/i;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * The names a reader may use for a fee: its prose name, its slug in words, and each part of its
 * taxonomy display name ("Wire Transfer (Domestic Out)" gives "Wire Transfer"), as infer-category.ts
 * reads them. Acronyms match case-sensitively ("NSF"); words do not.
 */
function feeNamePatterns(category: string): RegExp[] {
  const parts = (DISPLAY_NAMES[category] ?? "").replace(/\(([^)]*)\)/g, "/$1").split("/").map((part) => part.trim()).filter((part) => part.length >= 3);
  return [proseFeeName(category), category.replace(/_/g, " "), ...parts].filter((name) => name.trim())
    .map((name) => new RegExp(`\\b${escapeRegExp(name.trim())}\\b`, name === name.toUpperCase() ? "" : "i"));
}

/** The fee categories a span names, each on word boundaries ("transfer" never names NSF). */
function categoriesNamed(span: string, categories: Iterable<string>): string[] {
  return [...categories].filter((category) => feeNamePatterns(category).some((pattern) => pattern.test(span)));
}

/**
 * Sentences that state a peer figure over too few institutions (#1726, T5; house rule: a median
 * only at 10 or more peers, 5 or more local competitors, otherwise name the peers). Read from a
 * written answer's own tool reads, for a surface with none it finds nothing:
 * - an index statistic (searchIndex, searchFees) the sentence states whose institution count is
 *   under 10;
 * - a dollar figure the sentence calls the local competitors' middle, when fewer than five of them
 *   state that fee. A median word (median, midpoint, middle, typical) names the dollar figure nearest
 *   it in the sentence, before or after it; the sentence puts the group locally (local, competitors,
 *   market, nearby, area, peers in the county). The fee is the one named between the word and the
 *   figure, else in the sentence, else in the reader's question, else the read's thinnest fee.
 *   Two things clear the figure: it is an index statistic for that same fee (a national median
 *   beside the local prices), or the sentence names every competitor's price for that fee (naming
 *   the peers is the house rule's alternative).
 */
export function thinPeerSentences(input: GateInput, sentences: readonly string[]): Array<{ sentence: string; count: number; minimum: number }> {
  if (input.evidence.kind !== "tool_reads") return [];
  const outputs = input.evidence.toolOutputs;
  const stats = writtenAnswerIndexStats(outputs);
  const local = localCompetitorPrices(outputs);
  const out: Array<{ sentence: string; count: number; minimum: number }> = [];
  for (const sentence of sentences) {
    const thinStat = indexStatisticsStated(sentence, stats).find((stat) => stat.institutionCount < MIN_PEERS_FOR_POSITION);
    if (thinStat) {
      out.push({ sentence, count: thinStat.institutionCount, minimum: MIN_PEERS_FOR_POSITION });
      continue;
    }
    if (local.length === 0 || !LOCAL_WORD.test(sentence)) continue;
    const figures = extractFigures(sentence).filter((figure) => figure.kind === "usd");
    if (figures.length === 0) continue;
    const near = (figure: (typeof figures)[number], value: number) => Math.abs(figure.value - value) <= Math.max(figure.tolerance, 0.005);
    const thin = [...sentence.matchAll(MEDIAN_WORDS)].flatMap((word) => {
      const start = word.index ?? 0;
      const end = start + word[0].length;
      const distance = (f: (typeof figures)[number]) => (f.index >= end ? f.index - end : start - (f.index + f.raw.length));
      // The figure the word names: the nearest in the sentence, the later one on a tie.
      const figure = [...figures].sort((a, b) => distance(a) - distance(b) || b.index - a.index)[0];
      const span = sentence.slice(Math.min(end, figure.index + figure.raw.length), Math.max(start, figure.index));
      return local.flatMap((prices) => {
        const categories = [...prices.keys()];
        const thinnest = [...prices].sort((a, b) => a[1].length - b[1].length)[0]?.[0];
        const named = [categoriesNamed(span, categories), categoriesNamed(sentence, categories), categoriesNamed(input.question ?? "", categories),
          thinnest ? [thinnest] : []].find((list) => list.length > 0) ?? [];
        return named.flatMap((category) => {
          const stated = prices.get(category) ?? [];
          if (stated.length >= MIN_LOCAL_PEERS_FOR_POSITION) return [];
          // The index's own figure for this fee, not the competitors'.
          if (stats.some((stat) => stat.feeCategory === category && near(figure, stat.value))) return [];
          // Every competitor's price named: the peers are named, not summarised.
          if (stated.length > 0 && stated.every((price) => figures.some((f) => near(f, price)))) return [];
          return [stated.length];
        });
      });
    });
    if (thin.length > 0) out.push({ sentence, count: Math.min(...thin), minimum: MIN_LOCAL_PEERS_FOR_POSITION });
  }
  return out;
}

/** The one output gate. */
export function gateAnswer(input: GateInput): GateVerdict {
  const { check, binding, shown, factInstitutions } = evaluate(input);
  const causeOff = input.cause === "off";
  const cause = new Set(causeOff ? [] : input.cause ?? causeShadowInput(check));
  // Today's cause problem lines are recognised as causes even when the shadow input is replaced or off.
  const causeKnown = new Set([...causeLines(input.text), ...cause]);
  const shownSentences = gateSentences(shown);
  const failures: GateFailure[] = [];

  // 1. The shared evidence gate, problem by problem, in its own order.
  const figureLine = check.figureCheck.unmatched.length > 0 ? check.problems[0] : null;
  for (const problem of check.problems) {
    const code = checkCode(problem, problem === figureLine, causeKnown);
    if (causeOff && code === "causal_unsupported") continue;
    const cut = sentencesFor(code, shownSentences);
    // Untraced figures stay critical (James, 2026-10-15). A problem that cannot be pinned to a sentence cannot be cut.
    const critical = code === "untraced_figure" || code === "filed_peer_conflict" || cut.length === 0;
    failures.push({ code, message: problem, critical, source: "check", ...(critical ? {} : { sentences: cut }) });
  }
  // 2. The cause rule as a shadow input: what it flags that today's gate does not already.
  for (const line of cause) {
    if (check.problems.includes(line)) continue;
    const cut = sentencesFor("causal_unsupported", shownSentences);
    failures.push({ code: "causal_unsupported", message: line, critical: cut.length === 0, source: "cause", ...(cut.length ? { sentences: cut } : {}) });
  }
  // 3. The sentence binding: each left-out sentence. It is already out of the view.
  const corrections = binding?.corrections ?? [];
  for (const omitted of binding?.omitted ?? []) {
    const critical = CRITICAL_OMIT.has(omitted.reason) || (omitted.reason === "premise_contradicted" && corrections.length === 0);
    failures.push({ code: omitted.reason, message: omitted.text, critical, source: "binding" });
  }
  // 4. The account institution named with no fact about it (the memo's rule, for every surface).
  const { accountInstitutionId, accountInstitutionName, researchInstitutionId } = input.identity;
  if (accountInstitutionName && accountInstitutionId !== null && accountInstitutionId !== researchInstitutionId
    && input.text.includes(accountInstitutionName) && !factInstitutions.has(accountInstitutionId)) {
    failures.push({ code: "account_identity", critical: true, source: "identity",
      message: `The answer names ${accountInstitutionName}, the reader's own institution, with no fact about it in the evidence.` });
  }

  for (const problem of input.extra ?? []) failures.push({ code: "surface_rule", message: problem, critical: true, source: "surface" });

  // 5. The peer minimum (#1726, T5): a peer figure over too few institutions is cut, never shown.
  for (const thin of thinPeerSentences(input, shownSentences)) {
    failures.push({ code: "thin_peer_group", critical: false, source: "peers", sentences: [thin.sentence],
      message: `A peer figure over ${thin.count} institution${thin.count === 1 ? "" : "s"} is stated as a benchmark; it needs ${thin.minimum} or more. Name the peers and their prices instead.` });
  }

  const cut = new Set(failures.flatMap((f) => f.sentences ?? []));
  const left = shownSentences.filter((s) => !cut.has(s));
  if (left.length === 0 && input.text.trim()) {
    failures.push({ code: "nothing_left", critical: true, source: "status", message: "Nothing is left to show once the failing sentences go." });
  }
  const status: GateStatus = failures.some((f) => f.critical) ? "held" : failures.length > 0 ? "ready_partial" : "validated";
  return {
    version: OUTPUT_GATE_VERSION,
    surface: input.surface,
    status,
    check,
    binding,
    failures,
    corrections,
    repairable: failures.length > 0 && !failures.some((f) => f.code === "filed_peer_conflict"),
  };
}

/** The premise reasons in a verdict (step 3, read through output-gate-signals.ts). */
export function premiseFailures(verdict: GateVerdict): GateFailure[] {
  return verdict.failures.filter((f) => PREMISE_REASONS.has(f.code as OmitReason));
}
