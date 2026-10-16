import type { MarketReport } from "@/lib/custom-report/report-data";
import type { LinePosition } from "@/lib/custom-report/analysis";

/** A state's verified-fee coverage, from the cached catalog read. */
export interface StateCoverage {
  state_code: string;
  institution_count: number;
  fee_count: number;
}

/** One fee line of the live sample, as the reports page draws it: the bank's dot on its market's middle half. */
export interface SampleLine {
  key: string;
  label: string;
  own: number;
  p25: number;
  median: number;
  p75: number;
  /** Local competitors publishing the line. */
  peers: number;
  /** Local competitors charging strictly less than the bank. */
  chargingLess: number;
  position: LinePosition;
}

/** What the reports page shows of the live sample: whose report it is, and its comparable lines. */
export interface SampleExhibit {
  name: string;
  place: string | null;
  competitorsWithData: number;
  competitorsInMarket: number;
  findings: string[];
  lines: SampleLine[];
  /** The latest day a schedule behind the sample was read (YYYY-MM-DD), or null when none says. */
  readOn: string | null;
}

/** Lines the exhibit draws; the full sample has the rest. */
export const SAMPLE_LINES_SHOWN = 8;

/**
 * The sample report's comparable lines, in the report's own order. Null when the sample is
 * offline or has no comparable line, so the page shows no figures it can't source.
 */
export function sampleExhibit(report: MarketReport | null): SampleExhibit | null {
  if (!report || !report.analysis.readiness.ready) return null;
  const lines: SampleLine[] = [];
  for (const l of report.analysis.lines) {
    if (!l.comparable || !l.own || !l.peers || !l.position || l.chargingLess === null) continue;
    lines.push({
      key: l.key,
      label: l.label,
      own: l.own.amount,
      p25: l.peers.p25,
      median: l.peers.median,
      p75: l.peers.p75,
      peers: l.peers.n,
      chargingLess: l.chargingLess,
      position: l.position,
    });
  }
  if (lines.length === 0) return null;
  const subject = report.data.subject;
  return {
    name: subject.institution_name,
    place: subject.city && subject.state_code ? `${titleCase(subject.city)}, ${subject.state_code}` : null,
    competitorsWithData: report.analysis.readiness.competitorsWithData,
    competitorsInMarket: report.analysis.readiness.competitorsInMarket,
    findings: report.analysis.findings.slice(0, 3),
    lines: lines.slice(0, SAMPLE_LINES_SHOWN),
    readOn: latestReadOn(report),
  };
}

/** One axis per line: the market's middle half, widened so the bank's own dot always fits. */
export function lineScale(l: Pick<SampleLine, "own" | "p25" | "p75">): (v: number) => number {
  const lo = Math.min(l.own, l.p25);
  const hi = Math.max(l.own, l.p75);
  const pad = Math.max((hi - lo) * 0.2, 1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  return (v: number) => ((v - min) / (max - min)) * 100;
}

function latestReadOn(report: MarketReport): string | null {
  let latest: string | null = null;
  for (const line of report.data.lines) {
    const day = line.schedule_read_on;
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day) && (!latest || day > latest)) latest = day;
  }
  return latest;
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

/** The states the map lights, keyed by code, with their counts. */
export interface MapState {
  code: string;
  name: string;
  institutions: number;
  fees: number;
  /** 0..4, by institutions with verified fees, for the map's shade. */
  shade: 0 | 1 | 2 | 3 | 4;
  /** Whether a market in the state has enough data for a local competitor report today. */
  reportReady: boolean;
}

/** Shade steps by institutions with verified fees; a state needs 5 for a median at all. */
export const MAP_SHADE_STEPS = [5, 25, 75, 150] as const;

export function mapStates(
  coverage: StateCoverage[],
  names: Record<string, string>,
  readyStates: ReadonlySet<string> = new Set(),
): MapState[] {
  return coverage
    .filter((s) => names[s.state_code])
    .map((s) => ({
      code: s.state_code,
      name: names[s.state_code],
      institutions: s.institution_count,
      fees: s.fee_count,
      shade: MAP_SHADE_STEPS.filter((step) => s.institution_count >= step).length as MapState["shade"],
      reportReady: readyStates.has(s.state_code),
    }));
}
