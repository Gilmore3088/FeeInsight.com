import type { MarketReport } from "@/lib/custom-report/report-data";
import type { LinePosition } from "@/lib/custom-report/analysis";

/** One competitor figure behind a line, with the schedule it was read from. */
export interface SamplePeerFigure {
  name: string;
  amount: number;
  sourceUrl: string | null;
  /** The day the stored copy of the schedule was saved (YYYY-MM-DD), or null when none says. */
  readOn: string | null;
}

/** One fee line of the live sample, as the reports page draws it: the bank's fee on its market's middle half. */
export interface SampleLine {
  key: string;
  label: string;
  own: number;
  /** The bank's own fee as its schedule names it, the date that schedule was read, and where. */
  ownFeeName: string;
  ownSourceUrl: string | null;
  ownReadOn: string | null;
  p25: number;
  median: number;
  p75: number;
  min: number;
  max: number;
  /** Local competitors publishing the line. */
  peers: number;
  /** Local competitors charging strictly less than the bank. */
  chargingLess: number;
  position: LinePosition;
  /** Every competitor figure behind the local numbers, lowest first. */
  peerFigures: SamplePeerFigure[];
}

/** A named competitor of the sample, with its fee on each line it publishes. */
export interface SampleCompetitor {
  name: string;
  fees: Record<string, number>;
}

/** What the reports page shows of the live sample: whose report it is, and its comparable lines. */
export interface SampleExhibit {
  name: string;
  place: string | null;
  /** The local market as the report defines it ("Tallahassee, FL area (4 counties)"), or null. */
  market: string | null;
  competitorsWithData: number;
  competitorsInMarket: number;
  findings: string[];
  lines: SampleLine[];
  /** The report's side-by-side competitors, in the report's order. */
  named: SampleCompetitor[];
  /** The latest day a schedule behind the sample was read (YYYY-MM-DD), or null when none says. */
  readOn: string | null;
}

/** The line the page opens on (James's mockup), when the sample can compare it. */
export const DEFAULT_LINE_KEY = "wire_intl_outgoing";

/**
 * The sample report's comparable lines, in the report's own order. Null when the sample is
 * offline or has no comparable line, so the page shows no figures it can't source.
 */
export function sampleExhibit(report: MarketReport | null): SampleExhibit | null {
  if (!report || !report.analysis.readiness.ready) return null;
  const names = new Map(report.data.competitors.map((c) => [c.institution_id, c.institution_name]));
  const lines: SampleLine[] = [];
  for (const l of report.analysis.lines) {
    if (!l.comparable || !l.own || !l.peers || !l.position || l.chargingLess === null) continue;
    lines.push({
      key: l.key,
      label: l.label,
      own: l.own.amount,
      ownFeeName: l.own.fee_name,
      ownSourceUrl: l.own.source_url,
      ownReadOn: validDay(l.own.schedule_read_on),
      p25: l.peers.p25,
      median: l.peers.median,
      p75: l.peers.p75,
      min: l.peers.min,
      max: l.peers.max,
      peers: l.peers.n,
      chargingLess: l.chargingLess,
      position: l.position,
      // A figure whose institution the market does not name is left out rather than shown unnamed.
      peerFigures: l.peerFigures.flatMap((f) => {
        const name = names.get(f.institution_id);
        return name
          ? [{ name, amount: f.amount, sourceUrl: f.source_url, readOn: validDay(f.schedule_read_on) }]
          : [];
      }),
    });
  }
  if (lines.length === 0) return null;
  const subject = report.data.subject;
  const market = report.data.market;
  return {
    name: subject.institution_name,
    place: subject.city && subject.state_code ? `${titleCase(subject.city)}, ${subject.state_code}` : null,
    market: market?.places[0]
      ? `${placeLabel(market.places[0])} area${market.county_fips.length > 1 ? ` (${market.county_fips.length} counties)` : ""}`
      : null,
    competitorsWithData: report.analysis.readiness.competitorsWithData,
    competitorsInMarket: report.analysis.readiness.competitorsInMarket,
    findings: report.analysis.findings.slice(0, 3),
    lines,
    named: report.analysis.named.map((c) => ({ name: c.institution_name, fees: c.fees })),
    readOn: latestReadOn(report),
  };
}

/** The line the page opens on: the mockup's wire line when comparable, else the report's first. */
export function defaultLine(sample: SampleExhibit): SampleLine {
  return sample.lines.find((l) => l.key === DEFAULT_LINE_KEY) ?? sample.lines[0];
}

/** A dollar axis from $0 to a round top that holds every figure drawn, with its ticks. */
export function dollarAxis(values: number[]): { max: number; ticks: number[] } {
  const top = Math.max(...values, 1) * 1.15;
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find((s) => top / s <= 5) ?? 1000;
  const max = Math.ceil(top / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  return { max, ticks };
}

/** The homepage's headline serif (src/app/landing-serif.ts), loaded by the page's wrapper. */
export const SERIF = { fontFamily: "var(--fi-home-serif, Georgia), Georgia, serif" } as const;

export function money(n: number): string {
  return Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

/** The position, in words, as the badge shows it. */
export const POSITION_LABEL: Record<LinePosition, string> = {
  above_market: "Above the middle half",
  in_market: "Inside the middle half",
  below_market: "Below the middle half",
  free: "Free",
};

/**
 * One or two sentences on what the line shows, from the same figures the chart draws. It says
 * where the fee sits, never that it should change: a fee above the local median can be right.
 */
/** Each line's name as it reads inside a sentence ("its $36 NSF fee"). */
const IN_SENTENCE: Record<string, string> = {
  monthly_maintenance: "monthly maintenance",
  overdraft: "overdraft",
  nsf: "NSF",
  atm_non_network: "out-of-network ATM",
  wire_domestic_outgoing: "outgoing domestic wire",
  wire_intl_outgoing: "outgoing international wire",
  wire_domestic_incoming: "incoming domestic wire",
  stop_payment: "stop payment",
  cashiers_check: "cashier's check",
  od_protection_transfer: "overdraft protection transfer",
  paper_statement: "paper statement",
  card_replacement: "debit card replacement",
  deposited_item_return: "deposited item return",
};

export function feeInSentence(l: Pick<SampleLine, "key" | "label">): string {
  return IN_SENTENCE[l.key] ?? l.label.replace(/\s*\(.*?\)/g, "").toLowerCase();
}

export function lineInsight(name: string, l: SampleLine): string {
  const fee = feeInSentence(l);
  const counted = `${l.chargingLess} of the ${l.peers} local competitors publishing this fee charge less.`;
  if (l.position === "free") {
    return `${name} charges no ${fee} fee. The local median is ${money(l.median)}, across ${l.peers} competitors.`;
  }
  const gap = Math.abs(l.own - l.median);
  const vsMedian =
    gap === 0 ? "matches the local median" : `is ${money(gap)} ${l.own > l.median ? "higher" : "lower"} than the local median`;
  const band =
    l.position === "above_market"
      ? "above the middle half of published competitor prices"
      : l.position === "below_market"
        ? "below the middle half of published competitor prices"
        : "inside the middle half of published competitor prices";
  return `${name}'s ${money(l.own)} ${fee} fee ${vsMedian} and sits ${band}. ${counted}`;
}

/** What to look at first on this kind of fee. */
const FIRST_STEP: Record<string, string> = {
  wire_intl_outgoing: "Review wire volume and customer mix",
  wire_domestic_outgoing: "Review wire volume and customer mix",
  wire_domestic_incoming: "Review wire volume and customer mix",
  monthly_maintenance: "Review how many accounts pay it",
  overdraft: "Review how often it is charged, and to whom",
  nsf: "Review how often it is charged, and to whom",
  od_protection_transfer: "Review how often it is charged, and to whom",
};

/** Up to three things to look into before deciding anything; never a recommendation to change the price. */
export function nextSteps(l: SampleLine): string[] {
  return [
    l.position === "free" ? "Review what offering it free costs and earns" : (FIRST_STEP[l.key] ?? "Review how often it is charged"),
    "Check waivers and exceptions",
    "Weigh revenue before changing the price",
  ];
}

function latestReadOn(report: MarketReport): string | null {
  let latest: string | null = null;
  for (const line of report.data.lines) {
    const day = validDay(line.schedule_read_on);
    if (day && (!latest || day > latest)) latest = day;
  }
  return latest;
}

function validDay(day: string | null | undefined): string | null {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** "October 3, 2026" from a YYYY-MM-DD day, read as a calendar date (no time zone shift). */
export function formatReadOn(day: string): string {
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** "TALLAHASSEE, FL" -> "Tallahassee, FL". */
function placeLabel(place: string): string {
  const [city, state] = place.split(",").map((s) => s.trim());
  return state ? `${titleCase(city)}, ${state}` : titleCase(city);
}
