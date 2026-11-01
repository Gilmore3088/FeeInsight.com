/**
 * The answer page of a Hamilton report, for the paid answer eval (#1079): the same inputs
 * (`assembleReportInputs`), section call (`generateVerifiedSection`) and partner review as the
 * Reports screen, for one institution as the reader's own, with the Peer Benchmarking template.
 *
 * Only the answer page is written (the page a buyer reads first; the other two sections pass the
 * same figure check), and only its first verified draft: the live report rewrites once when the
 * partner review finds problems, which would not fit the eval's 300 s run. So the form rate this
 * gives is a floor for the live answer page. Nothing is saved. Server only.
 *
 * Correctness re-reads the comparison the page was written from (the same reads and reduction as the
 * screen) and checks each fee the page names still has the bank's amount and peer median it was
 * given. It catches a page built on values the catalog no longer holds. It also ties each figure to
 * the fee its sentence names (#1414 item 8): a sentence about one fee that states another fee's
 * figure, or states the peer median as the bank's own fee, fails.
 */

import { getFeesByInstitution } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { isProviderLimitError } from "@/lib/ai-provider";
import { generateVerifiedSection, type SectionGateShadow, type SectionTracking } from "./generate";
import { SECTION_GATE_HELD } from "./output-gate-enforce";
import { reviewAnswerPage } from "./partner-review";
import { HAMILTON_PAUSED_MESSAGE } from "./provider-paused";
import { extractFigures, type NarrativeFigure } from "./figure-check";
import { splitIntoSentences } from "./citation-gate";
import { assembleReportInputs } from "./report-inputs";
import { compareSelectedInstitutionFees, type SelectedInstitutionFeeDelta } from "./report-evidence";
import { resolveHamiltonPeerIndex } from "./peer-index";
import type { HamiltonEvidencePolicy } from "./request-contract";
import type { SectionInput } from "./types";

/** A report answer page ready to write: the section input and what the review and tie-out need. */
export interface PreparedReportAnswer {
  institutionId: number;
  institutionName: string;
  input: SectionInput;
  deltas: SelectedInstitutionFeeDelta[];
  competitorNames: string[];
  /** What the comparison was read with, so correctness can re-read it the same way. */
  selectedInstitution: Parameters<typeof resolveHamiltonPeerIndex>[0]["selectedInstitution"];
  evidencePolicy: HamiltonEvidencePolicy;
}

/** The window the Reports screen offers by default: the last three months. */
function defaultPeriod(now: Date): { dateFrom: string; dateTo: string } {
  const from = new Date(now);
  from.setMonth(from.getMonth() - 3);
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: now.toISOString().slice(0, 10) };
}

/**
 * Reads only: the answer page's input for the institution, or null when the Reports screen would
 * write no paid report for it (not found, or too little evidence for a comparison).
 */
export async function prepareReportAnswer(institutionId: number, institutionName: string, now = new Date()): Promise<PreparedReportAnswer | null> {
  const assembled = await assembleReportInputs({
    // The screen's defaults: Peer Benchmarking, the last three months, consulting tone, balanced goal.
    params: {
      templateType: "peer_benchmarking",
      institutionId,
      ...defaultPeriod(now),
      evidencePolicy: "provisional-first",
      narrativeTone: "consulting",
      clientGoal: "balanced",
    },
    // No reader: the institution's default peers, and no saved peer group.
    userId: null,
    loadAccountContext: async () => ({ status: "identified", institution: { id: institutionId, name: institutionName }, profileLabel: null }),
    resolveFindings: async () => [],
  });
  if (assembled.kind !== "ready") return null;
  return {
    institutionId,
    institutionName: assembled.institutionName,
    input: assembled.sectionInputs[0],
    deltas: assembled.selectedFeeDeltas,
    competitorNames: assembled.exhibitSet.data.local_market?.comparisons.flatMap((row) => row.competitors.map((c) => c.name)) ?? [],
    selectedInstitution: assembled.selectedInstitution,
    evidencePolicy: assembled.evidencePolicy,
  };
}

export type ReportAnswerResult =
  | {
      status: "written";
      narrative: string;
      /** True when every figure traces to the section's data and the partner review found nothing. */
      passed: boolean;
      /** Untraced figures and partner-review problems; empty when passed. */
      problems: string[];
      /** The one output gate's shadow verdict on the section as returned (#1077), for the caller to record. */
      gateShadow?: SectionGateShadow;
    }
  | { status: "unavailable"; reason: string };

export type ReportAnswerWriter = (prepared: PreparedReportAnswer, tracking: SectionTracking) => Promise<ReportAnswerResult>;

/** One paid answer page (up to two calls: the draft and its figure-check retry). */
export const writeReportAnswer: ReportAnswerWriter = async (prepared, tracking) => {
  try {
    const result = await generateVerifiedSection(prepared.input, tracking);
    const review = reviewAnswerPage({
      institutionName: prepared.institutionName,
      feeNames: prepared.deltas.map((d) => getDisplayName(d.fee_category)),
      competitorNames: prepared.competitorNames,
      narrative: result.section.narrative,
    });
    // A section the one output gate held (HAMILTON_ANSWER_GATE_ENFORCE on) names no figure.
    const figures = result.status === "needs_review" ? result.unmatched.filter((line) => line !== SECTION_GATE_HELD) : [];
    const gateHeld = result.status === "needs_review" && figures.length < result.unmatched.length ? ["held by the one output gate"] : [];
    const untraced = [...(figures.length > 0 ? [`figures not in the report data: ${figures.join(", ")}`] : []), ...gateHeld];
    const problems = [...untraced, ...review];
    return { status: "written", narrative: result.section.narrative, passed: problems.length === 0, problems, ...(result.gateShadow ? { gateShadow: result.gateShadow } : {}) };
  } catch (error) {
    if (isProviderLimitError(error) || isProviderLimitError((error as { cause?: unknown })?.cause)) {
      return { status: "unavailable", reason: HAMILTON_PAUSED_MESSAGE };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", reason: /budget|usage limit/i.test(message) ? "Hamilton's writing budget for today is used up." : "Hamilton's writer could not be reached." };
  }
};

/** Re-reads the page's fee comparison now; null when it could not be read. */
export type ComparisonReader = (prepared: PreparedReportAnswer) => Promise<SelectedInstitutionFeeDelta[] | null>;

/** The same reads and reduction as `assembleReportInputs`: the bank's visible fees against the same peer index. */
export const liveReportComparison: ComparisonReader = async (prepared) => {
  try {
    const [fees, peerIndex] = await Promise.all([
      getFeesByInstitution(prepared.institutionId),
      resolveHamiltonPeerIndex({ userId: null, peerSetId: null, selectedInstitution: prepared.selectedInstitution, approvedOnly: true, minUsableCategories: 3 }),
    ]);
    return compareSelectedInstitutionFees({
      selectedFees: fees.filter((fee) => fee.review_status !== "rejected"),
      indexEntries: peerIndex.entries,
      evidencePolicy: prepared.evidencePolicy,
    }).deltas;
  } catch {
    return null;
  }
};

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** The fee's name as a page writes it: "Overdraft (OD)" is matched as "overdraft" (#1414). */
const plainName = (category: string) => getDisplayName(category).replace(/\s*\([A-Z]{2,6}\)$/, "").toLowerCase();

const money = (value: number) => `$${value.toFixed(2)}`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Whether a sentence names the fee, by any part of its label: "NSF / Returned Item" is named by
 * "NSF" or "returned item", "Overdraft (OD)" by "overdraft" or "OD". Broad on purpose: a sentence
 * that may name two fees is not read for placement.
 */
function namesFee(sentence: string, category: string): boolean {
  const label = getDisplayName(category);
  const parts = [plainName(category), ...label.split(/\s*\/\s*/), ...[...label.matchAll(/\(([^)]+)\)/g)].map((m) => m[1])]
    .map((part) => part.replace(/\s*\([^)]*\)/g, "").trim().toLowerCase())
    .filter((part) => part.length >= 2);
  return [...new Set(parts)].some((part) => new RegExp(`\\b${escape(part)}\\b`, "i").test(sentence));
}
const MEDIAN_LABEL_BEFORE = /\b(?:median|midpoint|middle|typical|peers?|peer group)\b[^$]{0,25}$/i;
const MEDIAN_LABEL_AFTER = /^[^$.;]{0,20}\b(?:median|peers?)\b/i;

/** True when the sentence labels this figure as the peers' figure ("peer median of $30", "$30 at peers"). */
function labeledAsPeers(sentence: string, figure: NarrativeFigure): boolean {
  const before = sentence.slice(Math.max(0, figure.index - 40), figure.index);
  const after = sentence.slice(figure.index + figure.raw.length, figure.index + figure.raw.length + 25);
  return MEDIAN_LABEL_BEFORE.test(before) || MEDIAN_LABEL_AFTER.test(after);
}

/**
 * Each dollar figure tied to the fee its sentence names (#1414 item 8). Only a sentence that names
 * exactly one of the page's fees is read. A figure that is none of that fee's own amount, peer median,
 * quartiles or gap, but is another fee's amount or median, is on the wrong fee. The fee's peer median
 * stated without a median or peer word beside it is the median stated as the bank's own fee. A
 * figure that matches nothing is left to the figure check.
 */
export function misplacedReportFigures(narrative: string, deltas: readonly SelectedInstitutionFeeDelta[]): string[] {
  const failures: string[] = [];
  for (const { text } of splitIntoSentences(narrative)) {
    const named = deltas.filter((d) => namesFee(text, d.fee_category));
    if (named.length !== 1) continue;
    const fee = named[0];
    const own = [fee.institution_amount, fee.peer_median, fee.peer_p25, fee.peer_p75, Math.abs(fee.institution_amount - fee.peer_median)]
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    for (const figure of extractFigures(text).filter((f) => f.kind === "usd")) {
      const name = getDisplayName(fee.fee_category);
      if (!own.some((v) => near(v, figure.value))) {
        const other = deltas.find((d) => d !== fee && (near(d.institution_amount, figure.value) || near(d.peer_median, figure.value)));
        if (other) {
          const what = near(other.institution_amount, figure.value) ? "the bank's amount" : "the peer median";
          failures.push(`${name}: the page states ${money(figure.value)}, which is ${what} for ${getDisplayName(other.fee_category)}`);
        }
        continue;
      }
      if (near(figure.value, fee.peer_median) && !near(figure.value, fee.institution_amount) && !labeledAsPeers(text, figure)) {
        failures.push(`${name}: the page states the peer median ${money(fee.peer_median)} as the bank's own fee ${money(fee.institution_amount)}`);
      } else if (near(figure.value, fee.institution_amount) && !near(figure.value, fee.peer_median) && /\bmedian\b[^$]{0,20}$/i.test(text.slice(Math.max(0, figure.index - 30), figure.index))) {
        failures.push(`${name}: the page states the bank's ${money(fee.institution_amount)} as the peer median ${money(fee.peer_median)}`);
      }
    }
  }
  return [...new Set(failures)];
}

/**
 * Correctness of an answer page: each figure sits on the fee its sentence names
 * (misplacedReportFigures), and each verified fee the page names (by name or by the bank's amount)
 * still has, on a fresh read, the bank's amount and peer median the page was written from.
 * Provisional fees have no published row to hold them to.
 */
export async function reconcileReportAnswer(
  prepared: PreparedReportAnswer,
  narrative: string,
  read: ComparisonReader = liveReportComparison,
): Promise<{ checked: boolean; figures: number; failures: string[] }> {
  const lower = narrative.toLowerCase();
  const stated = extractFigures(narrative).filter((f) => f.kind === "usd").map((f) => f.value);
  const named = prepared.deltas.filter((d) =>
    d.evidence_tier === "verified"
    && (lower.includes(plainName(d.fee_category)) || stated.some((v) => near(v, d.institution_amount))));
  // A figure on the wrong fee is wrong whatever the catalog holds now, so it needs no fresh read.
  const misplaced = misplacedReportFigures(narrative, prepared.deltas);
  if (named.length === 0) return misplaced.length ? { checked: true, figures: 0, failures: misplaced } : { checked: false, figures: 0, failures: [] };
  const fresh = await read(prepared);
  if (!fresh) return misplaced.length ? { checked: true, figures: 0, failures: misplaced } : { checked: false, figures: 0, failures: [] };
  const now = new Map(fresh.map((d) => [d.fee_category, d]));
  const failures: string[] = [...misplaced];
  for (const d of named) {
    const name = getDisplayName(d.fee_category);
    const current = now.get(d.fee_category);
    if (!current) failures.push(`${name}: the report compares $${d.institution_amount.toFixed(2)}, and a fresh read has no comparison for it`);
    else if (!near(current.institution_amount, d.institution_amount)) failures.push(`${name}: the report uses $${d.institution_amount.toFixed(2)}, the catalog has $${current.institution_amount.toFixed(2)}`);
    else if (!near(current.peer_median, d.peer_median)) failures.push(`${name}: the report's peer median is $${d.peer_median.toFixed(2)}, the catalog's is $${current.peer_median.toFixed(2)}`);
  }
  return { checked: true, figures: named.length, failures };
}
