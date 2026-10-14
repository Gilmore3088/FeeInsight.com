import type { LinePosition } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";

/**
 * The sizzle's real example: the live sample report's institution (a real community bank,
 * named publicly since the 2026-10-07 decision), its own published fees with the line of
 * its schedule that states each one, its local market and the report's own findings.
 */
export interface SampleStory {
  institutionId: number;
  name: string;
  place: string;
  stateCode: string | null;
  lines: SampleLine[];
  /** The fee line the sizzle follows: the one the report's first finding is about. */
  story: SampleLine;
  /** Named local competitors with a figure on the story line, lowest fee first, each with its schedule line. */
  competitors: { name: string; amount: number; sourceLine: string | null }[];
  findings: string[];
}

export interface SampleLine {
  key: string;
  label: string;
  amount: number;
  sourceLine: string;
  /** When the schedule copy was saved, e.g. "Oct 8, 2026". */
  readOn: string | null;
  market: { n: number; min: number; q1: number; median: number; q3: number; max: number } | null;
  position: LinePosition | null;
}

const MAX_LINES = 3;
const MAX_COMPETITORS = 4;
const MAX_FINDINGS = 3;

export function buildSampleStory(report: MarketReport | null): SampleStory | null {
  if (!report) return null;
  const { data, analysis } = report;
  const all = analysis.lines
    .filter((line) => line.own && line.comparable)
    .map((line): SampleLine => ({
      key: line.key,
      label: line.label,
      amount: line.own!.amount,
      sourceLine: line.own!.source_line,
      readOn: readableDate(line.own!.schedule_read_on),
      market: line.peers
        ? { n: line.peers.n, min: line.peers.min, q1: line.peers.p25, median: line.peers.median, q3: line.peers.p75, max: line.peers.max }
        : null,
      position: line.position,
    }));
  if (all.length === 0) return null;
  const story = pickStoryLine(all, analysis.findings[0] ?? "");
  const lines = [story, ...all.filter((line) => line.key !== story.key)].slice(0, MAX_LINES);
  const competitors = analysis.named
    .filter((c) => typeof c.fees[story.key] === "number")
    .map((c) => ({ name: c.institution_name, amount: c.fees[story.key], sourceLine: c.sources[story.key]?.source_line ?? null }))
    .sort((a, b) => a.amount - b.amount)
    .slice(0, MAX_COMPETITORS);
  const subject = data.subject;
  return {
    institutionId: subject.institution_id,
    name: subject.institution_name,
    place: [subject.city, subject.state_code].filter(Boolean).join(", "),
    stateCode: subject.state_code,
    story,
    lines,
    competitors,
    findings: analysis.findings.slice(0, MAX_FINDINGS),
  };
}

const READ_ON_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function readableDate(isoDay: string | null): string | null {
  if (!isoDay) return null;
  const date = new Date(`${isoDay.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : READ_ON_FORMAT.format(date);
}

/** The line the first finding names (its label leads the sentence), else overdraft, else the first. */
export function pickStoryLine(lines: SampleLine[], firstFinding: string): SampleLine {
  const finding = firstFinding.toLowerCase();
  return (
    lines.find((line) => finding.includes(line.label.toLowerCase())) ??
    lines.find((line) => line.key === "overdraft") ??
    lines[0]
  );
}

const POSITION_WORDS: Record<LinePosition, string> = {
  above_market: "Above ▲",
  in_market: "Inside ●",
  below_market: "Below ▼",
  free: "Free ●",
};

export function positionWords(position: LinePosition | null): string {
  return position ? POSITION_WORDS[position] : "";
}
