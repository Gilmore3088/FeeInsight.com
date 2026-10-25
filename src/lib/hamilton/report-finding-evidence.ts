/**
 * What a finding added to a report carries with it (#1899): its chart, sources, method, dates and
 * limitations, built on the server only, never taken from the browser. Pure: no reads.
 *
 * - A Position finding is re-read when the report is made: the institution's published fee in the
 *   category against the report's peer group. Its title and detail are rewritten from that read, so
 *   no figure the browser sent reaches the report.
 * - A Test finding is the reader's own proposed fee (labelled as such) against the same peer read.
 * - An Ask finding is the saved answer: its saved figures, sources, save date and saved limits.
 *
 * A peer median is shown only when 10 or more peers publish the fee (MIN_PEERS_FOR_POSITION).
 */

import type { IndexEntry } from "@/lib/data-store/fee-index";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { ownFeeLabel, ownFeeList, type InstitutionOwnFee } from "@/lib/own-fee";
import { readStampedFigures } from "@/lib/dataset-note";
import { readerAsOf, savedAnswerLimits, savedDatasetSource } from "./board-brief";
import { MIN_PEERS_FOR_POSITION } from "./workspace/scenario";
import type { AnalyzeResponse } from "./types";

/** One fee on a range: the subject's fee (or proposed fee) against the peers' middle half and median. */
export interface FindingRangeChart {
  feeCategory: string;
  feeName: string;
  /** "Lakeshore Test Credit Union" for Position, "Tested" for Test: the legend reads "<label> fee". */
  subjectLabel: string;
  /** The fee drawn as the dot; null draws none (several fees, no single price). */
  subject: number | null;
  /** Test only: the institution's current published fee. */
  current?: number | null;
  p25: number | null;
  median: number;
  p75: number | null;
  peerCount: number;
  peerLabel: string;
}

export interface AddedFindingEvidence {
  chart: FindingRangeChart | null;
  /** A saved answer's own figures as saved (label, value, note). */
  figures: Array<{ label: string; value: string; note?: string }>;
  sources: Array<{ label: string; detail: string }>;
  method: string;
  /** When the figures were read or saved, in a reader's words. */
  dates: string;
  limitations: string[];
}

export interface RebuiltFinding {
  title: string;
  detail: string;
  evidence: AddedFindingEvidence;
}

export const CATALOG_SOURCE_LABEL = "Bank Fee Index published fee catalog";
export const NO_MEDIAN_LIMIT = `Hamilton gives a peer group median only when ${MIN_PEERS_FOR_POSITION} or more institutions in the group publish the fee.`;
export const READ_AT_REPORT_LIMIT = "Figures are as read when this report was made, which can differ from what the screen showed when the finding was added.";
export const PROPOSED_FEE_LIMIT = "The tested fee is a figure you entered in Test. It is not a published fee.";
export const PROVISIONAL_PEERS_LIMIT = "Fewer of the peer group's fees in this category are verified, so its figures are provisional.";

type PeerRead = Pick<IndexEntry, "fee_category" | "median_amount" | "p25_amount" | "p75_amount" | "institution_count" | "maturity_tier" | "last_updated">;

export interface PeerFindingInput {
  feeCategory: string;
  institutionName: string;
  own: Pick<InstitutionOwnFee, "price" | "low" | "high" | "fees"> | null;
  peer: PeerRead | null;
  peerLabel: string;
  /** When the report read the figures (ISO). */
  readAt: string;
}

/** "12 institutions in the peer group (Similar credit unions)". */
function inGroup(count: number, label: string): string {
  return `${count} ${count === 1 ? "institution" : "institutions"} in the peer group (${label})`;
}

/** "12 institutions in the peer group (...) publish one", with the verb agreeing. */
function publishOne(count: number, label: string): string {
  return `${inGroup(count, label)} ${count === 1 ? "publishes" : "publish"} one.`;
}

function datesLine(readAt: string, peer: PeerRead | null): string {
  const newest = peer?.last_updated ? ` Newest peer group fee record: ${readerAsOf(peer.last_updated)}.` : "";
  return `Read from published fee schedules on ${readerAsOf(readAt)}, when this report was made.${newest}`;
}

function peerSources(input: PeerFindingInput, count: number): AddedFindingEvidence["sources"] {
  const fee = getDisplayName(input.feeCategory);
  return [{
    label: CATALOG_SOURCE_LABEL,
    detail: `${input.institutionName}'s published ${fee} fee and the published ${fee} fees of ${inGroup(count, input.peerLabel)}.`,
  }];
}

function gapWords(subject: number, median: number): string {
  const gap = subject - median;
  if (Math.abs(gap) < 0.005) return "At the median";
  const pct = median === 0 ? "" : ` (${Math.round(Math.abs(gap / median) * 100)}%)`;
  return `${formatAmount(Math.abs(gap))}${pct} ${gap > 0 ? "above" : "below"} the median`;
}

function chartFor(input: PeerFindingInput, subjectLabel: string, subject: number | null, current?: number | null): FindingRangeChart | null {
  const peer = input.peer;
  if (!peer || peer.median_amount === null || peer.institution_count < MIN_PEERS_FOR_POSITION) return null;
  return {
    feeCategory: input.feeCategory,
    feeName: getDisplayName(input.feeCategory),
    subjectLabel,
    subject,
    ...(current !== undefined ? { current } : {}),
    p25: peer.p25_amount,
    median: peer.median_amount,
    p75: peer.p75_amount,
    peerCount: peer.institution_count,
    peerLabel: input.peerLabel,
  };
}

function commonLimits(input: PeerFindingInput): string[] {
  const peer = input.peer;
  return [
    ...(peer && peer.institution_count < MIN_PEERS_FOR_POSITION ? [NO_MEDIAN_LIMIT] : []),
    ...(peer && peer.institution_count >= MIN_PEERS_FOR_POSITION && peer.maturity_tier !== "strong" ? [PROVISIONAL_PEERS_LIMIT] : []),
    READ_AT_REPORT_LIMIT,
  ];
}

/** A Position finding, re-read for the report: the institution's published fee against the report's peers. */
export function positionFinding(input: PeerFindingInput): RebuiltFinding {
  const fee = getDisplayName(input.feeCategory);
  const own = input.own;
  const peer = input.peer;
  const count = peer?.institution_count ?? 0;
  const method = `${input.institutionName}'s published ${fee} fee placed against the median and middle half (25th to 75th percentile) of the published ${fee} fees of the institutions in the peer group (${input.peerLabel}), one value per institution.`;
  if (!own) {
    return {
      title: `${fee}: no published fee found`,
      detail: `Hamilton found no published ${fee} fee for ${input.institutionName} when this report was made, so no comparison is shown.`,
      evidence: { chart: null, figures: [], sources: peerSources(input, count), method, dates: datesLine(input.readAt, peer), limitations: [READ_AT_REPORT_LIMIT] },
    };
  }
  const yours = ownFeeLabel(own);
  const chart = chartFor(input, input.institutionName, own.price);
  const limitations = [
    ...(own.price === null ? [`${input.institutionName} lists several ${fee} fees (${ownFeeList(own)}), so no single price is placed against the median.`] : []),
    ...commonLimits(input),
  ];
  if (!chart) {
    return {
      title: `${fee}: ${yours}; too few in the peer group for a median`,
      detail: `${NO_MEDIAN_LIMIT} ${publishOne(count, input.peerLabel)}`,
      evidence: { chart: null, figures: [], sources: peerSources(input, count), method, dates: datesLine(input.readAt, peer), limitations },
    };
  }
  return {
    title: `${fee}: ${yours} against a peer group median of ${formatAmount(chart.median)}`,
    detail: own.price === null
      ? `Compared with the published fees of ${inGroup(count, input.peerLabel)}.`
      : `${gapWords(own.price, chart.median)} of ${inGroup(count, input.peerLabel)}.`,
    evidence: { chart, figures: [], sources: peerSources(input, count), method, dates: datesLine(input.readAt, peer), limitations },
  };
}

/** A Test finding: the reader's proposed fee against the report's peers, beside the current published fee. */
export function testFinding(input: PeerFindingInput & { proposedFee: number | null }): RebuiltFinding {
  const fee = getDisplayName(input.feeCategory);
  const peer = input.peer;
  const count = peer?.institution_count ?? 0;
  const current = input.own?.price ?? null;
  const method = `The fee you entered in Test for ${fee}, placed against the median and middle half (25th to 75th percentile) of the published ${fee} fees of the institutions in the peer group (${input.peerLabel}), one value per institution.`;
  const chart = input.proposedFee === null ? null : chartFor(input, "Tested", input.proposedFee, current);
  const currentWords = current === null ? "no single current published fee" : `a current published fee of ${formatAmount(current)}`;
  const title = input.proposedFee === null
    ? `${fee}: a test with no fee recorded`
    : `${fee}: test of ${formatAmount(input.proposedFee)} against ${currentWords}`;
  const detail = chart && input.proposedFee !== null
    ? `${gapWords(input.proposedFee, chart.median)} of ${inGroup(count, input.peerLabel)}, if adopted.`
    : `${NO_MEDIAN_LIMIT} ${publishOne(count, input.peerLabel)}`;
  return {
    title,
    detail,
    evidence: {
      chart,
      figures: [],
      sources: peerSources(input, count),
      method,
      dates: datesLine(input.readAt, peer),
      limitations: [PROPOSED_FEE_LIMIT, ...commonLimits(input)],
    },
  };
}

/** The sources a saved answer cites: its storyline's, once each, then its dataset stamps' entry. */
function savedAnswerSources(analysis: AnalyzeResponse): AddedFindingEvidence["sources"] {
  const story = analysis.storyline;
  const refs = story ? [
    ...story.keyFigures, ...story.situation, ...story.complication,
    ...story.lenses.finance, ...story.lenses.market, ...story.watch,
  ].map((f) => f.source) : [];
  const unique = [...new Map(refs.map((s) => [`${s.label}|${s.asOf ?? ""}`, s])).values()];
  const dataset = savedDatasetSource(readStampedFigures(analysis.datasetStamps));
  return [
    ...unique.map((s) => ({ label: s.label, detail: s.asOf ? `As of ${readerAsOf(s.asOf)}` : "As cited in the saved answer" })),
    ...(dataset ? [{ label: dataset.label, detail: dataset.detail }] : []),
  ];
}

export const SAVED_ANSWER_NO_LIMITS = "Hamilton recorded no limits when this answer was saved.";
export const SAVED_ANSWER_METHOD ="Quoted from your saved Hamilton answer. Only its sentences tied to a fee record or filing are quoted here; Hamilton's reading is kept apart.";

/** An Ask finding: the saved answer's own figures, sources, save date and limits, as saved. */
export function savedAnswerEvidence(analysis: AnalyzeResponse, savedAt: string | null | undefined): AddedFindingEvidence {
  const sources = savedAnswerSources(analysis);
  const metrics = Array.isArray(analysis.evidence?.metrics) ? analysis.evidence.metrics : [];
  let limitations: string[] = [];
  try {
    // An answer saved before the confidence basis has no limits recorded; say none rather than fail.
    limitations = Array.isArray(analysis.confidence?.basis) ? savedAnswerLimits(analysis) : [];
  } catch {
    limitations = [];
  }
  return {
    chart: null,
    figures: metrics.map((m) => ({ label: m.label, value: m.value, ...(m.note ? { note: m.note } : {}) })),
    sources: sources.length ? sources : [{ label: "Saved Hamilton answer", detail: "Open the saved answer in Hamilton to see the record behind each figure." }],
    method: SAVED_ANSWER_METHOD,
    dates: savedAt ? `Answer saved ${readerAsOf(savedAt)}. Figures are as saved and were not refreshed.` : "Save date not recorded. Figures are as saved and were not refreshed.",
    limitations: limitations.length ? limitations : [SAVED_ANSWER_NO_LIMITS],
  };
}

export const FINDING_EVIDENCE_LABELS = {
  method: "Method",
  sources: "Sources",
  dates: "Dates",
  limits: "Limits",
  figures: "Figures as saved",
} as const;

/** The chart's words, read aloud in place of the drawing and printed under it. */
export function findingChartCaption(chart: FindingRangeChart): string {
  const band = chart.p25 !== null && chart.p75 !== null ? `; middle half ${formatAmount(chart.p25)} to ${formatAmount(chart.p75)}` : "";
  const subject = chart.subject === null ? "" : `${chart.subjectLabel} fee ${formatAmount(chart.subject)}; `;
  const current = chart.current === undefined || chart.current === null ? "" : `current fee ${formatAmount(chart.current)}; `;
  return `${chart.feeName}: ${subject}${current}peer group median ${formatAmount(chart.median)} across ${chart.peerCount} institutions${band}.`;
}

/** Reads the evidence block of a stored report finding; anything malformed reads as none. */
export function readAddedFindingEvidence(value: unknown): AddedFindingEvidence | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<AddedFindingEvidence>;
  if (typeof v.method !== "string" || typeof v.dates !== "string" || !Array.isArray(v.sources) || !Array.isArray(v.limitations)) return null;
  return {
    chart: v.chart && typeof v.chart === "object" && typeof v.chart.median === "number" ? v.chart : null,
    figures: Array.isArray(v.figures) ? v.figures : [],
    sources: v.sources,
    method: v.method,
    dates: v.dates,
    limitations: v.limitations,
  };
}
