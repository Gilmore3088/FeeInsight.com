import type { MarketReport } from "@/lib/custom-report/report-data";
import type { LinePosition } from "@/lib/custom-report/analysis";
import { STATE_NAMES } from "@/lib/us-states";

/** One line of the anonymous institution view: the bank's dot on its local market's middle half. */
export interface TeaserLine {
  key: string;
  label: string;
  own: number;
  p25: number;
  median: number;
  p75: number;
  peers: number;
  chargingLess: number;
  position: LinePosition;
}

/** What the report shows of one real institution, without its name. */
export interface InstitutionTeaser {
  /** "A bank in Florida": the charter and state, never the name. */
  who: string;
  competitors: number;
  lines: TeaserLine[];
  /** Lines where the institution charges more than the local middle half. */
  above: number;
}

export const TEASER_LINES = 5;

/**
 * The live sample report, stripped of the institution's name: the same lines a buyer's own
 * report shows. Null when the sample is offline or has nothing comparable, so the page shows
 * no figure it can't source.
 */
export function institutionTeaser(report: MarketReport | null): InstitutionTeaser | null {
  if (!report || !report.analysis.readiness.ready) return null;
  const lines: TeaserLine[] = [];
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
  const charter = subject.charter_type === "credit_union" ? "A credit union" : "A bank";
  const state = subject.state_code ? STATE_NAMES[subject.state_code] : null;
  const shown = lines.slice(0, TEASER_LINES);
  return {
    who: state ? `${charter} in ${state}` : charter,
    competitors: report.analysis.readiness.competitorsWithData,
    lines: shown,
    above: shown.filter((l) => l.position === "above_market").length,
  };
}

/** One axis per line: the market's middle half, widened so the institution's dot always fits. */
export function teaserScale(l: Pick<TeaserLine, "own" | "p25" | "p75">): (v: number) => number {
  const lo = Math.min(l.own, l.p25);
  const hi = Math.max(l.own, l.p75);
  const pad = Math.max((hi - lo) * 0.2, 1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  return (v: number) => ((v - min) / (max - min)) * 100;
}
