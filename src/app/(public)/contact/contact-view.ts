import type { MarketReport } from "@/lib/custom-report/report-data";
import type { LinePosition } from "@/lib/custom-report/analysis";

/** One line of the Hamilton screen beside the form: the bank's fee on its local middle half. */
export interface ScreenLine {
  key: string;
  label: string;
  own: number;
  p25: number;
  median: number;
  p75: number;
  peers: number;
  position: LinePosition;
}

export interface HamiltonScreen {
  institution: string;
  competitors: number;
  lines: ScreenLine[];
}

export const SCREEN_LINES = 4;

/**
 * The live sample report as Hamilton shows it: the first comparable lines the institution
 * publishes. Null when the sample is offline or has nothing to compare, so the page draws no
 * figure it can't source.
 */
export function hamiltonScreen(report: MarketReport | null): HamiltonScreen | null {
  if (!report || !report.analysis.readiness.ready) return null;
  const lines: ScreenLine[] = [];
  for (const l of report.analysis.lines) {
    if (lines.length === SCREEN_LINES) break;
    if (!l.comparable || !l.own || !l.peers || !l.position) continue;
    lines.push({
      key: l.key,
      label: l.label,
      own: l.own.amount,
      p25: l.peers.p25,
      median: l.peers.median,
      p75: l.peers.p75,
      peers: l.peers.n,
      position: l.position,
    });
  }
  if (lines.length === 0) return null;
  return {
    institution: report.data.subject.institution_name,
    competitors: report.analysis.readiness.competitorsWithData,
    lines,
  };
}

/** One axis per line: the local middle half, widened so the institution's dot always fits. */
export function screenScale(l: Pick<ScreenLine, "own" | "p25" | "p75">): (v: number) => number {
  const lo = Math.min(l.own, l.p25);
  const hi = Math.max(l.own, l.p75);
  const pad = Math.max((hi - lo) * 0.2, 1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  return (v: number) => ((v - min) / (max - min)) * 100;
}
