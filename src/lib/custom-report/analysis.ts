import type { CustomReportMarketData, MarketFeeLine, MarketInstitution } from "@/lib/data-store/custom-report-market";
import { FEE_LINE_LABELS, FEE_LINE_RULES } from "./rules";

/** A fee line is comparable only when this many local competitors publish it. */
export const MIN_LOCAL_PEERS_PER_LINE = 8;
/** A report goes out only when this many of the bank's own lines are comparable. */
export const MIN_COMPARABLE_LINES = 6;
/** ...and only when this many local competitors have verified fees at all. */
export const MIN_COMPETITORS_WITH_DATA = 15;
/** Named competitors shown in the side-by-side table. */
export const NAMED_COMPETITORS = 8;
/**
 * Of those, slots kept for institutions outside the FDIC Summary of Deposits (credit unions),
 * which have no local deposit figure and would otherwise never make the table.
 */
export const NAMED_WITHOUT_DEPOSITS = 3;

export type LinePosition = "above_market" | "in_market" | "below_market" | "free";

export interface ReportLine {
  key: string;
  label: string;
  /** The bank's own amount and the published line it came from; null when not published. */
  own: {
    amount: number;
    fee_name: string;
    source_url: string | null;
    updated_at: string | null;
    schedule_read_on: string | null;
    source_line: string;
    tiers?: MarketFeeLine["tiers"];
  } | null;
  peers: { n: number; p25: number; median: number; p75: number; min: number; max: number } | null;
  comparable: boolean;
  position: LinePosition | null;
  /** Share of local competitors charging less than or the same as the bank, 0..100. */
  percentile: number | null;
  /** Local competitors charging strictly less than the bank on a comparable line. */
  chargingLess: number | null;
  /** Every competitor figure behind the local numbers, lowest first, each with its source. */
  peerFigures: MarketFeeLine[];
}

export interface NamedCompetitor extends MarketInstitution {
  fees: Record<string, number>;
  /** The source of each figure in `fees`, by fee line. */
  sources: Record<string, MarketFeeLine>;
}

export interface ReadinessResult {
  ready: boolean;
  comparableLines: number;
  ownLines: number;
  competitorsWithData: number;
  /** Every institution found in the market, with or without verified fees. */
  competitorsInMarket: number;
  /** Plain reason when not ready; shown to the requester and to James. */
  reason: string | null;
}

export interface CustomReportAnalysis {
  readiness: ReadinessResult;
  lines: ReportLine[];
  named: NamedCompetitor[];
  findings: string[];
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function money(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function positionFor(amount: number, peers: NonNullable<ReportLine["peers"]>): LinePosition {
  if (amount === 0 && peers.median > 0) return "free";
  if (amount > peers.p75) return "above_market";
  if (amount < peers.p25) return "below_market";
  return "in_market";
}

export function analyzeMarket(data: CustomReportMarketData): CustomReportAnalysis {
  const subjectId = data.subject.institution_id;
  const byLine = new Map<string, MarketFeeLine[]>();
  for (const line of data.lines) {
    if (line.institution_id === subjectId) continue;
    const list = byLine.get(line.line) ?? [];
    list.push(line);
    byLine.set(line.line, list);
  }
  const own = new Map(data.lines.filter((l) => l.institution_id === subjectId).map((l) => [l.line, l]));

  const lines: ReportLine[] = FEE_LINE_RULES.map((rule) => {
    const peerFigures = [...(byLine.get(rule.key) ?? [])].sort((a, b) => a.amount - b.amount || a.institution_id - b.institution_id);
    const peerAmounts = peerFigures.map((l) => l.amount);
    const peers =
      peerAmounts.length > 0
        ? {
            n: peerAmounts.length,
            p25: quantile(peerAmounts, 0.25),
            median: quantile(peerAmounts, 0.5),
            p75: quantile(peerAmounts, 0.75),
            min: peerAmounts[0],
            max: peerAmounts[peerAmounts.length - 1],
          }
        : null;
    const mine = own.get(rule.key) ?? null;
    const comparable = Boolean(mine && peers && peers.n >= MIN_LOCAL_PEERS_PER_LINE);
    return {
      key: rule.key,
      label: rule.label,
      own: mine
        ? {
            amount: mine.amount,
            fee_name: mine.fee_name,
            source_url: mine.source_url,
            updated_at: mine.updated_at,
            schedule_read_on: mine.schedule_read_on ?? null,
            source_line: mine.source_line,
            tiers: mine.tiers,
          }
        : null,
      peers,
      comparable,
      position: comparable && mine && peers ? positionFor(mine.amount, peers) : null,
      percentile:
        comparable && mine
          ? Math.round((peerAmounts.filter((a) => a <= mine.amount).length / peerAmounts.length) * 100)
          : null,
      chargingLess: comparable && mine ? peerAmounts.filter((a) => a < mine.amount).length : null,
      peerFigures,
    };
  });

  const feesByCompetitor = new Map<number, Record<string, number>>();
  const sourcesByCompetitor = new Map<number, Record<string, MarketFeeLine>>();
  for (const line of data.lines) {
    if (line.institution_id === subjectId) continue;
    const fees = feesByCompetitor.get(line.institution_id) ?? {};
    fees[line.line] = line.amount;
    feesByCompetitor.set(line.institution_id, fees);
    const sources = sourcesByCompetitor.get(line.institution_id) ?? {};
    sources[line.line] = line;
    sourcesByCompetitor.set(line.institution_id, sources);
  }
  const named = pickNamedCompetitors(
    data.competitors.map((c) => ({
      ...c,
      fees: feesByCompetitor.get(c.institution_id) ?? {},
      sources: sourcesByCompetitor.get(c.institution_id) ?? {},
    })),
    new Set(own.keys()),
  );

  const comparableLines = lines.filter((l) => l.comparable).length;
  const readiness: ReadinessResult = {
    ready:
      data.market !== null &&
      comparableLines >= MIN_COMPARABLE_LINES &&
      feesByCompetitor.size >= MIN_COMPETITORS_WITH_DATA,
    comparableLines,
    ownLines: own.size,
    competitorsWithData: feesByCompetitor.size,
    competitorsInMarket: data.competitors.length,
    reason: null,
  };
  if (data.market === null) {
    readiness.reason = "We could not place this institution in a local market from FDIC branch data.";
  } else if (!readiness.ready) {
    readiness.reason =
      own.size < MIN_COMPARABLE_LINES
        ? `We have ${own.size} of this institution's headline fees verified so far; a report needs at least ${MIN_COMPARABLE_LINES}.`
        : feesByCompetitor.size < MIN_COMPETITORS_WITH_DATA
          ? `Only ${feesByCompetitor.size} of ${data.competitors.length} local competitors have verified fees so far; a report needs ${MIN_COMPETITORS_WITH_DATA}.`
          : `Only ${comparableLines} of its fee lines have at least ${MIN_LOCAL_PEERS_PER_LINE} local competitors with verified fees; a report needs ${MIN_COMPARABLE_LINES}.`;
  }

  return { readiness, lines, named, findings: buildFindings(lines) };
}

/**
 * The side-by-side table: competitors sharing at least 3 of the bank's lines. Banks come by
 * deposits held in the market; up to NAMED_WITHOUT_DEPOSITS slots go to institutions with no
 * deposit figure (credit unions), chosen by how many of the bank's lines they publish.
 */
export function pickNamedCompetitors(candidates: NamedCompetitor[], ownKeys: Set<string>): NamedCompetitor[] {
  const shared = (c: NamedCompetitor) => Object.keys(c.fees).filter((k) => ownKeys.has(k)).length;
  const eligible = candidates.filter((c) => shared(c) >= 3);
  const byCoverage = (a: NamedCompetitor, b: NamedCompetitor) => shared(b) - shared(a) || a.institution_id - b.institution_id;
  const withDeposits = eligible
    .filter((c) => c.market_deposits !== null)
    .sort((a, b) => (b.market_deposits ?? 0) - (a.market_deposits ?? 0) || byCoverage(a, b));
  const withoutDeposits = eligible.filter((c) => c.market_deposits === null).sort(byCoverage);
  const reserved = withoutDeposits.slice(0, NAMED_WITHOUT_DEPOSITS);
  const banks = withDeposits.slice(0, NAMED_COMPETITORS - reserved.length);
  // Unused bank slots go back to the institutions without deposit figures.
  const extra = withoutDeposits.slice(reserved.length, reserved.length + (NAMED_COMPETITORS - reserved.length - banks.length));
  return [...banks, ...reserved, ...extra];
}

/** Up to three plain findings, largest gap to the local median first. Numbers only from the lines. */
export function buildFindings(lines: ReportLine[]): string[] {
  const comparable = lines.filter((l) => l.comparable && l.own && l.peers) as Array<
    ReportLine & { own: NonNullable<ReportLine["own"]>; peers: NonNullable<ReportLine["peers"]> }
  >;
  const outliers = comparable
    .filter((l) => l.position === "above_market" || l.position === "below_market" || l.position === "free")
    .sort((a, b) => Math.abs(b.own.amount - b.peers.median) - Math.abs(a.own.amount - a.peers.median));
  const findings = outliers.slice(0, 3).map((l) => {
    const label = (FEE_LINE_LABELS[l.key] ?? l.key).toLowerCase();
    const yours = money(l.own.amount);
    const median = money(l.peers.median);
    if (l.position === "free") return `You charge nothing for ${label}; the local median is ${median} across ${l.peers.n} competitors.`;
    const direction = l.position === "above_market" ? "above" : "below";
    return `Your ${label} fee (${yours}) is ${direction} the local range: the median is ${median} across ${l.peers.n} competitors, and the middle half charge ${money(l.peers.p25)} to ${money(l.peers.p75)}.`;
  });
  const inMarket = comparable.filter((l) => l.position === "in_market").length;
  findings.push(`${inMarket} of your ${comparable.length} comparable fee lines sit inside the middle half of your local market.`);
  return findings;
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The report as CSV: the institution's lines first, then every competitor figure with its source. */
export function buildReportCsv(data: CustomReportMarketData, analysis: CustomReportAnalysis): string {
  const names = new Map(data.competitors.map((c) => [c.institution_id, c.institution_name]));
  const header = [
    "row", "fee_line", "institution", "amount", "local_median", "middle_half_low", "middle_half_high",
    "competitors", "competitors_charging_less", "position", "schedule_line", "source_url", "schedule_read_on",
  ];
  const rows: (string | number | null)[][] = [header];
  for (const line of analysis.lines) {
    const peers = line.comparable ? line.peers : null;
    rows.push([
      "yours", line.label, data.subject.institution_name, line.own?.amount ?? null,
      peers?.median ?? null, peers?.p25 ?? null, peers?.p75 ?? null, line.peers?.n ?? 0,
      line.chargingLess, line.position, line.own?.source_line ?? null, line.own?.source_url ?? null,
      line.own?.schedule_read_on ?? null,
    ]);
  }
  for (const line of analysis.lines.filter((l) => l.comparable)) {
    for (const figure of line.peerFigures) {
      rows.push([
        "competitor", line.label, names.get(figure.institution_id) ?? `Institution ${figure.institution_id}`, figure.amount,
        null, null, null, null, null, null, figure.source_line, figure.source_url, figure.schedule_read_on,
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
