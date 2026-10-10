/**
 * Segments named in a question ("all $10B and up institutions", "credit unions under
 * $1 billion in Texas", "the 25 largest banks"): parsing, the fee across the segment, and
 * the sentences and exhibit Hamilton answers with. Pure and client-safe.
 *
 * Decision support only: the answer places the bank inside the segment and names who
 * charges what; it never says what the bank should charge.
 */

import { subjectPossessive } from "./subject";
import { formatFeeAmount } from "@/lib/format";
import { STATE_NAMES } from "@/lib/us-states";
import { plainName, proseFeeName } from "./names";
import { MIN_PEERS_FOR_POSITION, pricePosition } from "./scenario";
import type { AskSegment, Exhibit, Fact, SegmentMember, SegmentResearch, SourceRef } from "./types";

/** Most members an exhibit names. */
export const MAX_SEGMENT_EXHIBIT = 15;
/** Default N for "the largest banks" when the question gives no number. */
export const DEFAULT_LARGEST = 25;
const MAX_LARGEST = 200;

const UNIT: Record<string, number> = {
  k: 1e3, thousand: 1e3,
  m: 1e6, mm: 1e6, mil: 1e6, mn: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, bil: 1e9, billion: 1e9,
  t: 1e12, tn: 1e12, trillion: 1e12,
};
const AMOUNT = String.raw`\$?\s?(\d{1,4}(?:\.\d{1,2})?)\s?(k|thousand|mm|mil|mn|million|m|bn|bil|billion|b|tn|trillion|t)\b`;
const UNIT_OF = (raw: string) => UNIT[raw.toLowerCase()];
/** Every asset amount with a unit in a question ("$10B", "1.5 billion"), for stripping before price parsing. */
export const SEGMENT_AMOUNTS = new RegExp(AMOUNT, "gi");

/** "$10B", "1.5 billion" -> thousands of dollars. */
function thousands(num: string, unit: string): number | null {
  const n = Number(num);
  const mult = UNIT_OF(unit);
  if (!Number.isFinite(n) || !mult) return null;
  return Math.round((n * mult) / 1000);
}

function assetsWords(thousandsValue: number): string {
  const dollars = thousandsValue * 1000;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
  if (dollars >= 1e12) return `$${fmt(dollars / 1e12)} trillion`;
  if (dollars >= 1e9) return `$${fmt(dollars / 1e9)} billion`;
  if (dollars >= 1e6) return `$${fmt(dollars / 1e6)} million`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

const STATE_BY_NAME = Object.entries(STATE_NAMES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => b.name.length - a.name.length);

function stateIn(question: string): string | null {
  for (const { code, name } of STATE_BY_NAME) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question)) return code;
  }
  const m = question.match(/\b(?:in|across|from)\s+([A-Z]{2})\b/);
  return m && STATE_NAMES[m[1]] ? m[1] : null;
}

function charterIn(question: string): AskSegment["charterType"] {
  const cu = /\bcredit unions?\b|\bCUs?\b/.test(question) || /\bcredit unions?\b/i.test(question);
  const withoutCu = question.replace(/credit unions?/gi, "");
  const bank = /\bbanks\b|\bcommercial banks?\b|\bbanks?\s+(?:with|over|above|under|below)\b/i.test(withoutCu);
  if (cu && !bank) return "credit_union";
  if (bank && !cu) return "bank";
  return null;
}

function sizeIn(question: string): { min: number | null; max: number | null } | null {
  const range = question.match(new RegExp(`(?:between\\s+)?${AMOUNT}\\s*(?:-|–|to|and)\\s*${AMOUNT}`, "i"));
  if (range) {
    const a = thousands(range[1], range[2]);
    const b = thousands(range[3], range[4]);
    if (a !== null && b !== null && a !== b) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const minAfter = question.match(new RegExp(`${AMOUNT}\\s*(?:\\+|and\\s+(?:up|above|over|larger|bigger)|or\\s+(?:more|larger|bigger|above)|plus)`, "i"));
  if (minAfter) {
    const v = thousands(minAfter[1], minAfter[2]);
    if (v !== null) return { min: v, max: null };
  }
  const minBefore = question.match(new RegExp(`(?:over|above|more than|at least|larger than|bigger than|greater than|exceeding)\\s+${AMOUNT}`, "i"));
  if (minBefore) {
    const v = thousands(minBefore[1], minBefore[2]);
    if (v !== null) return { min: v, max: null };
  }
  const maxBefore = question.match(new RegExp(`(?:under|below|less than|smaller than|up to)\\s+${AMOUNT}`, "i"));
  if (maxBefore) {
    const v = thousands(maxBefore[1], maxBefore[2]);
    if (v !== null) return { min: null, max: v };
  }
  return null;
}

function largestIn(question: string): number | null {
  const top = question.match(/\btop\s+(\d{1,3})\b|\b(\d{1,3})\s+(?:largest|biggest)\b|\b(?:largest|biggest)\s+(\d{1,3})\b/i);
  if (top) {
    const n = Number(top[1] ?? top[2] ?? top[3]);
    return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LARGEST) : null;
  }
  return /\b(?:largest|biggest)\b/i.test(question) ? DEFAULT_LARGEST : null;
}

export function segmentLabel(s: Omit<AskSegment, "label">): string {
  const who = s.charterType === "credit_union" ? "credit unions" : s.charterType === "bank" ? "banks" : "institutions";
  const size =
    s.minAssets !== null && s.maxAssets !== null
      ? ` with ${assetsWords(s.minAssets)} to ${assetsWords(s.maxAssets)} in assets`
      : s.minAssets !== null
        ? ` with ${assetsWords(s.minAssets)} or more in assets`
        : s.maxAssets !== null
          ? ` with under ${assetsWords(s.maxAssets)} in assets`
          : "";
  const where = s.stateCode ? ` in ${STATE_NAMES[s.stateCode] ?? s.stateCode}` : "";
  const head = s.largest !== null ? `the ${s.largest} largest ${who}` : who;
  return `${head}${size}${where}`;
}

function assetsShort(thousandsValue: number): string {
  const dollars = thousandsValue * 1000;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
  if (dollars >= 1e12) return `$${fmt(dollars / 1e12)}T`;
  if (dollars >= 1e9) return `$${fmt(dollars / 1e9)}B`;
  if (dollars >= 1e6) return `$${fmt(dollars / 1e6)}M`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

/** The segment in a few words for titles and table lines: "$10B+ institutions", "the 20 largest banks in Texas". */
export function shortSegmentLabel(s: AskSegment): string {
  const who = s.charterType === "credit_union" ? "credit unions" : s.charterType === "bank" ? "banks" : "institutions";
  const size =
    s.minAssets !== null && s.maxAssets !== null
      ? `${assetsShort(s.minAssets)} to ${assetsShort(s.maxAssets)} `
      : s.minAssets !== null
        ? `${assetsShort(s.minAssets)}+ `
        : s.maxAssets !== null
          ? `under-${assetsShort(s.maxAssets)} `
          : "";
  const where = s.stateCode ? ` in ${STATE_NAMES[s.stateCode] ?? s.stateCode}` : "";
  return s.largest !== null ? `the ${s.largest} largest ${size}${who}${where}` : `${size}${who}${where}`;
}

/**
 * The segment a question names, or null when it names none. A charter or a state alone
 * is a segment only with a size or "largest": "banks in Texas" stays with the default peers'
 * market layers, which already cover the state.
 */
export function parseSegment(question: string): AskSegment | null {
  const size = sizeIn(question);
  const largest = largestIn(question);
  if (!size && largest === null) return null;
  const s = {
    minAssets: size?.min ?? null,
    maxAssets: size?.max ?? null,
    charterType: charterIn(question),
    stateCode: stateIn(question),
    largest,
  };
  return { ...s, label: segmentLabel(s) };
}

/** Does an institution of this size, charter and state fit the segment (ignoring "largest")? */
export function fitsSegment(
  segment: AskSegment,
  inst: { totalAssets: number | null; charterType: string | null; stateCode: string | null },
): boolean {
  if (segment.minAssets !== null && (inst.totalAssets === null || inst.totalAssets < segment.minAssets)) return false;
  if (segment.maxAssets !== null && (inst.totalAssets === null || inst.totalAssets >= segment.maxAssets)) return false;
  if (segment.charterType && inst.charterType !== segment.charterType) return false;
  if (segment.stateCode && inst.stateCode !== segment.stateCode) return false;
  return true;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const SEGMENT_SOURCE: SourceRef = {
  label: "Bank Fee Index, published fee schedules; asset sizes from FDIC and NCUA filings",
  table: "published_fee_catalog",
};

export function buildSegmentResearch(input: {
  segment: AskSegment;
  feeCategory: string;
  institutionsInSegment: number;
  members: SegmentMember[];
  current: number | null;
  ownInSegment: boolean;
}): SegmentResearch {
  const members = [...input.members].sort(
    (a, b) => (b.totalAssets ?? -1) - (a.totalAssets ?? -1) || a.institutionName.localeCompare(b.institutionName),
  );
  const amounts = members.map((m) => m.amount).sort((a, b) => a - b);
  const band =
    amounts.length >= MIN_PEERS_FOR_POSITION
      ? { p25: quantile(amounts, 0.25), median: quantile(amounts, 0.5), p75: quantile(amounts, 0.75), n: amounts.length }
      : null;
  const name = proseFeeName(input.feeCategory);
  const problem =
    input.institutionsInSegment === 0
      ? `No institution in the registry fits ${input.segment.label}.`
      : members.length === 0
        ? `None of the ${count(input.institutionsInSegment)} ${input.segment.label} publishes ${article(name)} ${name} fee in the index yet.`
        : null;
  const asOf = members.map((m) => m.publishedAt).filter((d): d is string => !!d).sort().pop()?.slice(0, 10) ?? null;
  return {
    segment: input.segment,
    institutionsInSegment: input.institutionsInSegment,
    members,
    band,
    zeroCount: members.filter((m) => m.amount === 0).length,
    withDailyCap: members.filter((m) => m.dailyCap !== null).length,
    withDailyFeeLimit: members.filter((m) => m.dailyFeeLimit !== null).length,
    ownPosition: input.current !== null && band ? pricePosition(input.current, amounts) : null,
    ownInSegment: input.ownInSegment,
    problem,
    source: { ...SEGMENT_SOURCE, asOf },
  };
}

// ─── Sentences ────────────────────────────────────────────────────────────────

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function money(n: number): string {
  return formatFeeAmount(n) ?? `$${n}`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function capitalize(text: string): string {
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

export function segmentHeadline(seg: SegmentResearch, feeCategory: string, current: number | null, research?: { subjectName?: string }): string {
  const name = proseFeeName(feeCategory);
  if (seg.problem) return seg.problem;
  const n = seg.members.length;
  if (!seg.band) {
    return `Only ${count(n)} of ${count(seg.institutionsInSegment)} ${shortSegmentLabel(seg.segment)} publish ${article(name)} ${name} fee, too few for a median.`;
  }
  if (current !== null && seg.ownPosition !== null) {
    const where = seg.ownPosition <= 0 ? "at the bottom" : seg.ownPosition >= 100 ? "at the top" : `at the ${ordinal(seg.ownPosition)} percentile`;
    return `${subjectPossessive(research)} ${money(current)} ${name} fee is ${where} of ${count(n)} ${shortSegmentLabel(seg.segment)} (median ${money(seg.band.median)}).`;
  }
  return `${count(n)} ${shortSegmentLabel(seg.segment)} publish ${article(name)} ${name} fee; median ${money(seg.band.median)}, middle half ${money(seg.band.p25)} to ${money(seg.band.p75)}.`;
}

/** The claims that describe the segment, each with its source. */
export function segmentClaims(seg: SegmentResearch, feeCategory: string, current: number | null, research?: { subjectName?: string }): Fact[] {
  const name = proseFeeName(feeCategory);
  const source = seg.source;
  if (seg.problem) return [{ text: `${seg.problem} The figures below are for ${subjectPossessive(research, false)} default peer group instead.`, source }];
  const out: Fact[] = [];
  const n = seg.members.length;
  out.push({
    text: `${count(n)} of the ${count(seg.institutionsInSegment)} ${shortSegmentLabel(seg.segment)} publish ${article(name)} ${name} fee in the index.`,
    source,
    sampleSize: n,
  });
  if (seg.band) {
    out.push({
      text: `Their median is ${money(seg.band.median)}, and the middle half runs ${money(seg.band.p25)} to ${money(seg.band.p75)}.`,
      source,
      sampleSize: seg.band.n,
    });
  }
  if (seg.zeroCount > 0) {
    const zeros = seg.members.filter((m) => m.amount === 0).slice(0, 4).map((m) => m.institutionName);
    const more = seg.zeroCount > zeros.length ? ` and ${count(seg.zeroCount - zeros.length)} more` : "";
    out.push({ text: `${count(seg.zeroCount)} charge $0: ${zeros.join(", ")}${more}.`, source, sampleSize: seg.zeroCount });
  }
  const priced = seg.members.filter((m) => m.amount > 0);
  if (priced.length > 0) {
    const top = [...priced].sort((a, b) => b.amount - a.amount)[0];
    out.push({ text: `The highest is ${top.institutionName} at ${money(top.amount)}.`, source: { ...source, url: top.documentUrls[0] } });
  }
  const largest = seg.members.slice(0, 3);
  if (largest.length > 0) {
    out.push({
      text: `The largest by assets: ${largest.map((m) => `${plainName(m.institutionName)} (${money(m.amount)})`).join(", ")}.`,
      source,
    });
  }
  if (seg.withDailyCap > 0) {
    out.push({ text: `${count(seg.withDailyCap)} of them publish a daily cap on this fee.`, source, sampleSize: seg.withDailyCap });
  }
  if (seg.withDailyFeeLimit > 0) {
    const counts = seg.members.flatMap((m) => (m.dailyFeeLimit ? [m.dailyFeeLimit.count] : []));
    const tally = new Map<number, number>();
    for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
    const [common] = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    out.push({
      text: `${count(seg.withDailyFeeLimit)} of them limit how many ${name} fees they charge in a day; the most common limit is ${common}.`,
      source,
      sampleSize: seg.withDailyFeeLimit,
    });
  }
  if (current !== null && !seg.ownInSegment) {
    out.push({ text: `${research?.subjectName ?? "Your institution"} is outside this segment; ${subjectPossessive(research, false)} ${money(current)} is placed against it for comparison.`, source });
  }
  return out;
}

/** The segment's largest members by assets (up to MAX_SEGMENT_EXHIBIT), lowest fee first, with the bank's own. */
export function segmentExhibit(seg: SegmentResearch, feeCategory: string, current: number | null, ownLabel: string): Exhibit | null {
  if (seg.members.length === 0) return null;
  const name = proseFeeName(feeCategory);
  const items = seg.members
    .slice(0, MAX_SEGMENT_EXHIBIT)
    .sort((a, b) => a.amount - b.amount || a.institutionName.localeCompare(b.institutionName))
    .map((m) => ({ name: m.institutionName, amount: m.amount, url: m.documentUrls[0] ?? null }));
  return {
    kind: "competitor_range",
    title: `${capitalize(name)} fees at the ${items.length} largest ${shortSegmentLabel({ ...seg.segment, largest: null })}`,
    unit: "dollars",
    own: current,
    ownLabel,
    items,
    sources: [seg.source],
    note:
      seg.members.length > MAX_SEGMENT_EXHIBIT
        ? `The ${MAX_SEGMENT_EXHIBIT} largest by assets of ${count(seg.members.length)} that publish this fee.`
        : `All ${count(seg.members.length)} that publish this fee.`,
  };
}
