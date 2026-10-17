import type { CustomReportMarketData, MarketFeeLine, MarketInstitution } from "@/lib/data-store/custom-report-market";
import { countyLabel } from "@/lib/geo/counties";
import { FEE_LINE_BASIS, FEE_LINE_LABELS, FEE_LINE_RULES } from "./rules";
import { buildAmountEvidence, evidenceOf, withEvidence, type AmountEvidence, type ReportFigure } from "./evidence";

export type { AmountEvidence, EvidenceRecord, ReportFigure } from "./evidence";

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
    /** The amount's basis and every record it is built from (optional on copies saved before it). */
    evidence?: AmountEvidence;
  } | null;
  /** The bank's own amount when its evidence does not show it, so it is left out; else null. */
  ownExcluded?: AmountEvidence | null;
  peers: { n: number; p25: number; median: number; p75: number; min: number; max: number } | null;
  comparable: boolean;
  position: LinePosition | null;
  /** Share of local competitors charging less than or the same as the bank, 0..100. */
  percentile: number | null;
  /** Local competitors charging strictly less than the bank on a comparable line. */
  chargingLess: number | null;
  /** Every competitor figure behind the local numbers, lowest first, each with its evidence. */
  peerFigures: ReportFigure[];
  /** Competitor amounts left out because no record's evidence shows the amount. */
  excludedFigures?: { institution_id: number; evidence: AmountEvidence }[];
}

export interface NamedCompetitor extends MarketInstitution {
  fees: Record<string, number>;
  /** The source of each figure in `fees`, by fee line. */
  sources: Record<string, ReportFigure>;
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

/** What the evidence check left out of the analysis (live fee rows are never changed). */
export interface EvidenceExclusions {
  /** Competitor amounts dropped from a line's comparison: no record shows the amount. */
  competitorAmounts: number;
  /** Competitor records dropped (their amounts rebuilt from the records that remain). */
  competitorRecords: number;
  /** The institution's own amounts left out for the same reason. */
  ownAmounts: number;
  /** The institution's own records dropped. */
  ownRecords: number;
}

export interface CustomReportAnalysis {
  readiness: ReadinessResult;
  /** Optional on copies analysed before the evidence check. */
  exclusions?: EvidenceExclusions;
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

/** Where an amount sits against the local middle half; shared with the /for-institutions price tester. */
export function positionFor(amount: number, peers: Pick<NonNullable<ReportLine["peers"]>, "p25" | "median" | "p75">): LinePosition {
  if (amount === 0 && peers.median > 0) return "free";
  if (amount > peers.p75) return "above_market";
  if (amount < peers.p25) return "below_market";
  return "in_market";
}

export function analyzeMarket(data: CustomReportMarketData): CustomReportAnalysis {
  const subjectId = data.subject.institution_id;
  // Every amount is rebuilt from the records whose evidence shows it (evidence.ts); an amount
  // with no such record is left out, so the medians below are worked out without it.
  const exclusions: EvidenceExclusions = { competitorAmounts: 0, competitorRecords: 0, ownAmounts: 0, ownRecords: 0 };
  const figures: (ReportFigure & { evidence: AmountEvidence })[] = [];
  const excludedByLine = new Map<string, { institution_id: number; evidence: AmountEvidence }[]>();
  const ownExcluded = new Map<string, AmountEvidence>();
  for (const line of data.lines) {
    const figure = withEvidence(line);
    const isOwn = line.institution_id === subjectId;
    const dropped = (figure?.evidence ?? buildAmountEvidence(line)).excluded.length;
    if (isOwn) exclusions.ownRecords += dropped;
    else exclusions.competitorRecords += dropped;
    if (figure) {
      figures.push(figure);
      continue;
    }
    const evidence = buildAmountEvidence(line);
    if (isOwn) {
      exclusions.ownAmounts += 1;
      ownExcluded.set(line.line, evidence);
    } else {
      exclusions.competitorAmounts += 1;
      excludedByLine.set(line.line, [...(excludedByLine.get(line.line) ?? []), { institution_id: line.institution_id, evidence }]);
    }
  }
  const byLine = new Map<string, ReportFigure[]>();
  for (const line of figures) {
    if (line.institution_id === subjectId) continue;
    const list = byLine.get(line.line) ?? [];
    list.push(line);
    byLine.set(line.line, list);
  }
  const own = new Map(figures.filter((l) => l.institution_id === subjectId).map((l) => [l.line, l]));

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
            evidence: mine.evidence,
          }
        : null,
      ownExcluded: ownExcluded.get(rule.key) ?? null,
      peers,
      comparable,
      position: comparable && mine && peers ? positionFor(mine.amount, peers) : null,
      percentile:
        comparable && mine
          ? Math.round((peerAmounts.filter((a) => a <= mine.amount).length / peerAmounts.length) * 100)
          : null,
      chargingLess: comparable && mine ? peerAmounts.filter((a) => a < mine.amount).length : null,
      peerFigures,
      excludedFigures: excludedByLine.get(rule.key) ?? [],
    };
  });

  const feesByCompetitor = new Map<number, Record<string, number>>();
  const sourcesByCompetitor = new Map<number, Record<string, ReportFigure>>();
  for (const line of figures) {
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

  return { readiness, exclusions, lines, named, findings: buildFindings(lines) };
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
    return `Your ${label} fee (${yours}) is ${direction} the local middle half: the median is ${median} across ${l.peers.n} competitors, and the middle half charge ${money(l.peers.p25)} to ${money(l.peers.p75)}.`;
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

/** The CSV's reasons in place of a blank cell, so "not found" never reads as "too few competitors". */
export const MISSING_NOT_FOUND = "not found on schedule";
export const MISSING_TOO_FEW = `too few competitors (n<${MIN_LOCAL_PEERS_PER_LINE})`;
export const MISSING_EXCLUDED = "excluded: evidence does not show amount";

const CSV_HEADER = [
  "report_institution_id", "report_institution", "report_date", "market_counties", "currency",
  "row", "fee_line", "fee_basis", "institution_id", "institution",
  "amount", "amount_basis", "published_range", "record", "records",
  "record_id", "account_or_product", "record_amount", "record_used", "schedule_line", "source_url", "schedule_read_on",
  "local_median", "middle_half_low", "middle_half_high", "competitors", "competitors_charging_less", "position",
  "missing_reason",
] as const;

function rangeText(amounts: number[]): string | null {
  if (amounts.length === 0) return null;
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  return low === high ? money(low) : `${money(low)} to ${money(high)}`;
}

/** "Leon County, FL; Alachua County, FL", each county named when the code is known. */
function countiesCell(countyFips: string[]): string {
  return countyFips
    .map((fips) => {
      const code = String(fips).padStart(5, "0");
      return countyLabel(code) ?? `county ${code}`;
    })
    .join("; ");
}

/**
 * The report as CSV, one row per contributing record (long format, so it pivots and filters
 * without unpacking cells): the institution's own lines first, then every competitor record on
 * the compared lines. An amount built from several records repeats on each of them with its
 * basis ("middle of 3 published prices") and "record 2 of 3"; take record 1 for one row per
 * institution and line. A record left out by the evidence check stays in the file with
 * record_used "no" and its reason. Every row carries the report's context (institution id,
 * date, market counties, currency, fee basis), and an empty figure always says why.
 */
export function buildReportCsv(data: CustomReportMarketData, analysis: CustomReportAnalysis, reportDate = new Date().toISOString().slice(0, 10)): string {
  const names = new Map(data.competitors.map((c) => [c.institution_id, c.institution_name]));
  const context = [
    data.subject.institution_id, data.subject.institution_name, reportDate,
    data.market ? countiesCell(data.market.county_fips) : null, "USD",
  ];
  const rows: (string | number | null)[][] = [[...CSV_HEADER]];
  type Stats = (string | number | null)[];
  const push = (
    row: "yours" | "competitor",
    line: ReportLine,
    institutionId: number,
    institution: string,
    evidence: AmountEvidence | null,
    stats: Stats,
    missing: string | null,
  ) => {
    const used = evidence?.records ?? [];
    const all = [...used, ...(evidence?.excluded ?? [])];
    const head = [row, line.label, FEE_LINE_BASIS[line.key] ?? null, institutionId, institution];
    if (all.length === 0) {
      rows.push([...context, ...head, null, null, null, null, null, null, null, null, null, null, null, null, ...stats, missing]);
      return;
    }
    all.forEach((record, index) => {
      const usedHere = record.problem === null;
      rows.push([
        ...context, ...head,
        evidence?.amount ?? null, evidence?.basis ?? null, rangeText(used.map((r) => r.amount)),
        index + 1, all.length,
        record.record_id, record.product, record.amount, usedHere ? "yes" : "no", record.quote, record.source_url, record.read_on,
        ...stats,
        usedHere ? missing : MISSING_EXCLUDED,
      ]);
    });
  };

  for (const line of analysis.lines) {
    const peers = line.comparable ? line.peers : null;
    const tooFew = (line.peers?.n ?? 0) < MIN_LOCAL_PEERS_PER_LINE;
    const stats: Stats = [
      peers?.median ?? null, peers?.p25 ?? null, peers?.p75 ?? null, line.peers?.n ?? 0,
      line.chargingLess, line.position,
    ];
    const ownEvidence = line.own
      ? (line.own.evidence ?? buildAmountEvidence({ institution_id: data.subject.institution_id, line: line.key, ...line.own }))
      : (line.ownExcluded ?? null);
    const missing = line.own
      ? tooFew ? MISSING_TOO_FEW : null
      : line.ownExcluded ? MISSING_EXCLUDED : MISSING_NOT_FOUND;
    push("yours", line, data.subject.institution_id, data.subject.institution_name, ownEvidence, stats, missing);
  }
  const blank: Stats = [null, null, null, null, null, null];
  for (const line of analysis.lines.filter((l) => l.comparable)) {
    const entries = [
      ...line.peerFigures.map((figure) => ({ id: figure.institution_id, evidence: evidenceOf(figure) })),
      ...(line.excludedFigures ?? []).map((figure) => ({ id: figure.institution_id, evidence: figure.evidence })),
    ];
    for (const entry of entries) {
      push("competitor", line, entry.id, names.get(entry.id) ?? `Institution ${entry.id}`, entry.evidence, blank, entry.evidence.amount === null ? MISSING_EXCLUDED : null);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export interface ReportChange {
  key: string;
  label: string;
  /** Whose figure moved: the institution's own fee, the local median, or a named competitor's fee. */
  subject: "own" | "median" | "competitor";
  /** The competitor's name when subject is "competitor". */
  who: string | null;
  before: number | null;
  after: number | null;
}

/**
 * What moved between the copy saved at payment and today's live report: the institution's own
 * fees, the local medians, and the named competitors' fees. Figures only, straight from the two
 * analyses; a line present on one side only shows as added or dropped (null on the other side).
 */
export function diffReports(saved: CustomReportAnalysis, live: CustomReportAnalysis): ReportChange[] {
  const changes: ReportChange[] = [];
  const label = (key: string) => FEE_LINE_LABELS[key] ?? key;
  const savedLines = new Map(saved.lines.map((l) => [l.key, l]));
  for (const line of live.lines) {
    const before = savedLines.get(line.key);
    const ownBefore = before?.own?.amount ?? null;
    const ownAfter = line.own?.amount ?? null;
    if (ownBefore !== ownAfter) {
      changes.push({ key: line.key, label: label(line.key), subject: "own", who: null, before: ownBefore, after: ownAfter });
    }
    const medianBefore = before?.comparable ? before.peers?.median ?? null : null;
    const medianAfter = line.comparable ? line.peers?.median ?? null : null;
    if (medianBefore !== null && medianAfter !== null && medianBefore !== medianAfter) {
      changes.push({ key: line.key, label: label(line.key), subject: "median", who: null, before: medianBefore, after: medianAfter });
    }
  }
  const savedNamed = new Map(saved.named.map((c) => [c.institution_id, c]));
  for (const competitor of live.named) {
    const before = savedNamed.get(competitor.institution_id);
    if (!before) continue;
    for (const key of new Set([...Object.keys(before.fees), ...Object.keys(competitor.fees)])) {
      const was = before.fees[key] ?? null;
      const now = competitor.fees[key] ?? null;
      if (was !== now) {
        changes.push({ key, label: label(key), subject: "competitor", who: competitor.institution_name, before: was, after: now });
      }
    }
  }
  return changes;
}

/** How many comparable lines sit above, inside and below the local middle half (free counts as below). */
export function positionCounts(lines: ReportLine[]): { above: number; inside: number; below: number } {
  const comparable = lines.filter((l) => l.comparable && l.position);
  return {
    above: comparable.filter((l) => l.position === "above_market").length,
    inside: comparable.filter((l) => l.position === "in_market").length,
    below: comparable.filter((l) => l.position === "below_market" || l.position === "free").length,
  };
}
