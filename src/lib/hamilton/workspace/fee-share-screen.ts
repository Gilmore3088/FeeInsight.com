/**
 * Fee-share screens (#2028): "Which credit unions in the top 25 of the $1 billion to $10 billion
 * tier run a fee share below 4%?", "banks where service charges are below 3% of revenue", "fee
 * income share under 2%". The question screens institutions by filed fee income as a share of
 * total revenue, so it is answered from call reports: the threshold, how many institutions in the
 * peer set meet it, the peer set, the filing date and the source. Never with one fee's price
 * position in its place, and when the filings can't be read the answer says so plainly.
 *
 * Pure and client-safe: ask-service reads the filings (fee-share-screen-read.ts) and hands the
 * rows here.
 */

import { MIN_PEERS_FOR_MEDIAN } from "@/lib/research/fee-income-peers";
import { neverNamed } from "@/lib/never-named";
import { theCountedGroup } from "@/lib/segment-words";
import { ANSWERABLE } from "./ask";
import type { AskResponse, AskSegment, Fact, SourceRef } from "./types";

/** How a screen compares a share with its threshold. */
export type FeeShareComparison = "below" | "at_most" | "above" | "at_least";

export interface FeeShareScreenAsk {
  /** The threshold in percent (4 = 4%). */
  thresholdPct: number;
  comparison: FeeShareComparison;
}

/** Words before a percent ("below 4%"), longest alternatives first. */
const BEFORE: { re: string; comparison: FeeShareComparison }[] = [
  { re: String.raw`at most|no more than|not more than`, comparison: "at_most" },
  { re: String.raw`at least|no less than|not less than`, comparison: "at_least" },
  { re: String.raw`below|under|less than|lower than|beneath|<`, comparison: "below" },
  { re: String.raw`above|over|more than|greater than|higher than|exceeding|>`, comparison: "above" },
];
/** Words after a percent ("4% or less"). */
const AFTER: { re: string; comparison: FeeShareComparison }[] = [
  { re: String.raw`or (?:less|lower|below|under)`, comparison: "at_most" },
  { re: String.raw`or (?:more|higher|above|over|greater)`, comparison: "at_least" },
];
const PERCENT = String.raw`(\d{1,2}(?:\.\d{1,2})?)\s?(?:%|percent\b|pct\b)`;

/** "fee share", "fee-share", "fee income share", "fee shares". */
const FEE_SHARE = /\bfee[- ](?:income[- ])?shares?\b/i;
/** The income a share is taken of: service charges, fee income or fee revenue. */
const FEE_INCOME = /\b(?:service[- ]charges?|service[- ]charge income|fee income|fee revenue|non-?interest fee income)\b/i;
/** "of revenue", "of total revenue", "share of income". */
const OF_REVENUE = /\bof (?:total |their |its |our |net |operating )?(?:revenues?|income)\b/i;
/** The question asks for a set of institutions: "which", "how many", "list", or a plural group. */
const ASKS_FOR_SET = /\b(?:which|what|any|list|how many|show|name|find)\b|\b(?:banks|credit unions|institutions|peers|competitors|lenders|CUs)\b/i;
/**
 * The share measured is the asker's own: "is our fee income above 5%", "what share of our revenue",
 * "do we run a fee share below 4%". "Which of our peers ..." measures the peers, so it is a screen.
 */
const FIRST_PERSON_MEASURE =
  /\b(?:our|my)\s+(?:own\s+)?(?:fee|service|revenue|non-?interest|income|share)|\bof (?:our|my) (?:total |net |operating )?(?:revenues?|income)\b|\b(?:we|i)\s+(?:have|run|earn|get|make|are|am|sit|stand)\b/i;

interface Found {
  index: number;
  thresholdPct: number;
  comparison: FeeShareComparison;
}

function thresholdsIn(text: string): Found[] {
  const out: Found[] = [];
  for (const { re, comparison } of BEFORE) {
    for (const m of text.matchAll(new RegExp(`(?:^|[^a-z])(?:${re})\\s*${PERCENT}`, "gi"))) out.push({ index: m.index ?? 0, thresholdPct: Number(m[1]), comparison });
  }
  for (const { re, comparison } of AFTER) {
    for (const m of text.matchAll(new RegExp(`${PERCENT}\\s*(?:${re})\\b`, "gi"))) out.push({ index: m.index ?? 0, thresholdPct: Number(m[1]), comparison });
  }
  return out.filter((f) => Number.isFinite(f.thresholdPct) && f.thresholdPct > 0 && f.thresholdPct < 100);
}

/**
 * The screen a question asks for, or null when it asks for none. It needs a share of revenue
 * ("fee share", or service charges or fee income "of revenue"), a threshold in percent with a
 * direction ("below 4%", "under 3 percent", "at least 5%", "4% or less"), and a set of
 * institutions to screen ("which", "how many", "banks", "peers"). A question about the asker's own
 * share ("is our fee income above 5% of revenue?") is not a screen: it stays on the income answer.
 * The threshold is the one first after the share phrase, else the nearest before it, so "banks
 * with a fee share above 4% that grew deposits by less than 10%" screens above 4%. The caller
 * checks that it names no single fee: "overdraft income below 2% of revenue" is about that fee.
 */
export function parseFeeShareScreen(question: string): FeeShareScreenAsk | null {
  const text = question.replace(/[’`]/g, "'");
  const share = FEE_SHARE.exec(text) ?? (OF_REVENUE.test(text) ? FEE_INCOME.exec(text) : null);
  if (!share) return null;
  if (!ASKS_FOR_SET.test(text) || FIRST_PERSON_MEASURE.test(text)) return null;
  const found = thresholdsIn(text);
  if (found.length === 0) return null;
  const at = share.index;
  const after = found.filter((f) => f.index >= at).sort((a, b) => a.index - b.index);
  const pick = after[0] ?? found.sort((a, b) => Math.abs(a.index - at) - Math.abs(b.index - at))[0];
  return { thresholdPct: pick.thresholdPct, comparison: pick.comparison };
}

/** Whether a share (a fraction, 0.031 = 3.1%) meets the screen; the threshold is turned into a fraction, never the share into a percent. */
export function meetsScreen(share: number, screen: FeeShareScreenAsk): boolean {
  const t = screen.thresholdPct / 100;
  return screen.comparison === "below" ? share < t : screen.comparison === "at_most" ? share <= t : screen.comparison === "above" ? share > t : share >= t;
}

/** One filer in the peer set; money in whole dollars (call-report-dollars.ts). */
export interface FeeShareScreenRow {
  institutionId: number;
  name: string;
  stateCode: string | null;
  totalAssets: number | null;
  serviceCharges: number | null;
  revenue: number | null;
  /** Fee income over total revenue as filed, a fraction (0.031 = 3.1%); null when not filed. */
  share: number | null;
}

export interface FeeShareScreenData {
  source: "fdic" | "ncua";
  /** The filing date every row comes from, "YYYY-MM-DD". */
  reportDate: string;
  /** The peer set the rows are, with its words. */
  peerSet: AskSegment;
  /** Where the charter came from: the question, or the researched institution when the question named none. */
  charterFrom: "question" | "subject";
  /** The researched institution, when the peer set is its size band. */
  sizeOf?: string;
  /** Every filer in the peer set, largest by filed assets first. */
  rows: FeeShareScreenRow[];
}

/** Why a screen could not be answered. */
export type FeeShareScreenGap = "charter" | "quarter" | "read";

/** Most institutions an answer names. */
export const MAX_SCREEN_NAMES = 10;

const COMPARISON_WORDS: Record<FeeShareComparison, string> = {
  below: "below",
  at_most: "at or below",
  above: "above",
  at_least: "at or above",
};

function pct(share: number): string {
  return `${(Math.round(share * 1000) / 10).toFixed(1)}%`;
}

/**
 * A listed share, with two decimals when one decimal would round it onto the threshold, so a
 * share just below 4% never reads "4.0%" in a list of shares below 4%.
 */
function listedPct(share: number, screen: FeeShareScreenAsk): string {
  const one = Math.round(share * 1000) / 10;
  return Math.abs(one - screen.thresholdPct) < 1e-9 ? `${(Math.round(share * 10000) / 100).toFixed(2)}%` : pct(share);
}

function thresholdWords(screen: FeeShareScreenAsk): string {
  return `${COMPARISON_WORDS[screen.comparison]} ${screen.thresholdPct}%`;
}

function dateWords(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** What the share measures and over which period: banks file quarters, credit unions the year to date. */
function measureOf(source: "fdic" | "ncua", reportDate: string) {
  return source === "ncua"
    ? { income: "fee income", period: `in the year to date through ${dateWords(reportDate)}`, kind: "credit unions", one: "credit union", other: "banks" }
    : { income: "deposit service charges", period: `in the quarter ending ${dateWords(reportDate)}`, kind: "banks", one: "bank", other: "credit unions" };
}

export function feeShareSource(source: "fdic" | "ncua", reportDate: string): SourceRef {
  return {
    label:
      source === "ncua"
        ? `NCUA 5300 call reports: fee income as a share of total revenue, year to date through ${dateWords(reportDate)}`
        : `FDIC call reports: service charges on deposit accounts as a share of total revenue, quarter ending ${dateWords(reportDate)}`,
    table: "institution_financial_records",
    asOf: reportDate,
  };
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * A screen that could not be read says so plainly and says what Hamilton can answer. It never
 * answers a fee's price in the screen's place (#2028).
 */
export function feeShareScreenUnavailable(screen: FeeShareScreenAsk, gap: FeeShareScreenGap, peerLabel?: string): AskResponse {
  const what = `fee income as a share of revenue ${thresholdWords(screen)}`;
  const lead =
    gap === "charter"
      ? `Hamilton can't screen for ${what} without knowing whether to screen banks or credit unions: they file different fee income measures, so Hamilton never pools them. Ask again naming banks or credit unions.`
      : gap === "quarter"
        ? `Hamilton can't screen for ${what}: it found no call report filing date to read${peerLabel ? ` for ${peerLabel}` : ""}.`
        : `Hamilton can't screen for ${what}: it could not read the call report filings${peerLabel ? ` for ${peerLabel}` : ""} just now.`;
  return { kind: "research", shortAnswer: `${lead} ${ANSWERABLE}`, pageChange: { screen: "none" } };
}

/**
 * The screen's answer: how many in the peer set meet the threshold, the peer set, the filing
 * date and the source, the median when at least MIN_PEERS_FOR_MEDIAN have a share on file, and
 * the institutions that meet it by name (at most MAX_SCREEN_NAMES).
 */
export function buildFeeShareScreen(screen: FeeShareScreenAsk, data: FeeShareScreenData): AskResponse {
  const { source, reportDate, peerSet } = data;
  const m = measureOf(source, reportDate);
  const ref = feeShareSource(source, reportDate);
  // A zero share is a missing service-charge line, not an institution that charges nothing (the
  // cohort strip's rule), so only a share above zero is screened.
  const filed = data.rows.filter((r): r is FeeShareScreenRow & { share: number } => r.share !== null && Number.isFinite(r.share) && r.share > 0);
  const missing = data.rows.length - filed.length;
  const n = filed.length;
  const threshold = thresholdWords(screen);
  const facts: Fact[] = [];

  const scope = `The peer set is ${theCountedGroup(data.rows.length, peerSet.label)}${data.sizeOf ? `, the size band of ${data.sizeOf},` : ""} that filed call reports for the quarter ending ${dateWords(reportDate)}${peerSet.largest !== null ? ", ranked by filed assets" : ""}.`;
  const pooled = data.charterFrom === "subject"
    ? ` Only ${m.kind} are screened: ${m.other} file a different fee income measure, so the two are never pooled.`
    : "";
  if (data.rows.length === 0) {
    const text = `No ${peerSet.label} filed call reports for the quarter ending ${dateWords(reportDate)}, so Hamilton can't screen them for a share ${threshold}.`;
    facts.push({ text, source: ref, sampleSize: 0 });
    return { kind: "research", shortAnswer: `${text}${pooled}`, pageChange: { screen: "none" }, facts };
  }
  if (n === 0) {
    const text = `None of ${theCountedGroup(data.rows.length, peerSet.label)} has ${m.income} as a share of total revenue on file ${m.period}, so Hamilton can't screen them for a share ${threshold}.`;
    facts.push({ text, source: ref, sampleSize: 0 });
    return { kind: "research", shortAnswer: `${text}${pooled}`, pageChange: { screen: "none" }, facts };
  }

  const meeting = filed.filter((r) => meetsScreen(r.share, screen)).sort((a, b) => (screen.comparison === "below" || screen.comparison === "at_most" ? a.share - b.share : b.share - a.share));
  const count = meeting.length;
  const measured = `had ${m.income} ${threshold} of total revenue ${m.period}.`;
  const head =
    count === 0
      ? n === 1
        ? `The one ${m.one} screened did not have ${m.income} ${threshold} of total revenue ${m.period}.`
        : `None of the ${n.toLocaleString("en-US")} ${m.kind} screened ${measured}`
      : count === n
        ? n === 1
          ? `The one ${m.one} screened ${measured}`
          : `All ${n.toLocaleString("en-US")} ${m.kind} screened ${measured}`
        : `${count.toLocaleString("en-US")} of the ${n.toLocaleString("en-US")} ${m.kind} screened ${measured}`;
  facts.push({ text: head, source: ref, sampleSize: n });

  const notCounted = missing > 0 ? ` ${missing.toLocaleString("en-US")} had no fee income or revenue on file and ${missing === 1 ? "is" : "are"} not counted.` : "";
  facts.push({ text: `${scope}${notCounted}`.trim(), source: ref, sampleSize: data.rows.length });

  const sorted = filed.map((r) => r.share).sort((a, b) => a - b);
  const medianLine =
    n >= MIN_PEERS_FOR_MEDIAN
      ? `Their median share was ${pct(median(sorted))}.`
      : `With fewer than ${MIN_PEERS_FOR_MEDIAN} institutions screened, no median is given.`;
  facts.push({ text: medianLine, source: ref, sampleSize: n });

  // Counted, but never named (never-named.ts, the cohort list's rule).
  const named = meeting.filter((r) => !neverNamed(r.name));
  const shown = named.slice(0, MAX_SCREEN_NAMES);
  const rest = count - shown.length;
  const namesLine =
    shown.length > 0
      ? `${threshold[0].toUpperCase()}${threshold.slice(1)}: ${shown.map((r) => `${r.name} (${listedPct(r.share, screen)})`).join(", ")}${rest > 0 ? `, and ${rest.toLocaleString("en-US")} more` : ""}.`
      : "";
  if (namesLine) facts.push({ text: namesLine, source: ref, sampleSize: count });

  const shortAnswer = [head, `${scope}${notCounted}`, medianLine, namesLine].filter(Boolean).join(" ") + pooled;
  return { kind: "research", shortAnswer, pageChange: { screen: "none" }, facts };
}
