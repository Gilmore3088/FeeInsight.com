import type { LinePosition, ReportLine } from "@/lib/custom-report/analysis";
import { quarterOfDate, type ReportPeerContext, type ReportPeerFinancial } from "@/lib/custom-report/peer-context";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { incomeLabel, quarterLabel, type RevenueContext } from "@/lib/custom-report/revenue-context";
import type { MarketBranchFootprint } from "@/lib/data-store/branches";
import { lineName } from "@/app/for-institutions/board-math";
import { placeLabel } from "./market-report/report-body";
import { cardMoney } from "./landing-index-view";

/**
 * The "One question" section's figures (James's brief, Oct 19): one question about the demo
 * bank's outgoing wire fee, the four kinds of evidence Hamilton reads for it, and four outputs.
 * Every figure comes from a read the homepage or the sample report page already makes: the live
 * sample report (loadSampleReport), the bank's reported service-charge income
 * (getRevenueContextCached), its Call Report figures against peers (getReportPeerFinancialCached),
 * its fees against peers of its size (getReportPeerContextCached) and its market's branches and
 * deposits (getMarketBranchFootprintCached). A read that is missing leaves its figures out; nothing
 * is filled in. The view is plain data, so it crosses to the client component as props.
 */

export type EvidenceKey = "financial" | "competitive" | "market" | "regulatory";

export type OutputKey = "benchmark" | "investigate" | "monitor" | "report";

/** The fee lines the question can ask about, best first: the outgoing wire, then its nearest kin. */
export const QUESTION_LINES = ["wire_domestic_outgoing", "wire_intl_outgoing"] as const;

/** Named competitors drawn beside the bank in the Benchmark chart. */
const CHART_COMPETITORS = 5;

/** Never shown in a sample, demo or video (James's demo rule). */
const EXCLUDED_NAMES = /frost/i;

export interface OneQuestionBar {
  label: string;
  /** Dollars. */
  amount: number;
  amountLabel: string;
  kind: "subject" | "median" | "competitor";
}

export interface OneQuestionFee {
  key: string;
  /** "Outgoing domestic wire". */
  label: string;
  /** The fee as a question names it: "wire", "overdraft", "monthly maintenance". */
  short: string;
  /** The fee as a sentence names it: "outgoing domestic wire", "overdraft", "monthly maintenance". */
  name: string;
  amountLabel: string;
  /** The bank's own schedule: when it was read, and where it is. */
  readOn: string | null;
  local: {
    competitors: number;
    medianLabel: string;
    rangeLabel: string;
    chargingLess: number | null;
    position: LinePosition | null;
  } | null;
  /** The same fee at institutions of the same charter and asset size, nationwide. */
  sizePeers: { groupLabel: string; count: number; medianLabel: string } | null;
  /** The bank, the medians and named competitors, for the Benchmark chart. */
  bars: OneQuestionBar[];
  /** Read dates of the competitor schedules behind the local figures: "Oct 2 to Oct 14, 2026". */
  competitorReadRange: string | null;
}

export interface OneQuestionIncome {
  measureLabel: RevenueContext["measureLabel"];
  filing: string;
  /** Oldest first, for the sparkline. */
  quarters: { label: string; thousands: number; valueLabel: string }[];
  latestQuarter: string;
  latestLabel: string;
  /** The same figure, short enough for a card: "$5.7M". */
  latestCompact: string;
  sizeMedian: { tierLabel: string; valueLabel: string } | null;
  /** Deposit service charges as a share of revenue, its own and the median for its size. */
  share: { own: string; median: string; quarter: string } | null;
  /** The newest two quarters, when both are reported. */
  change: { from: string; to: string; fromLabel: string; toLabel: string; pctLabel: string; direction: "up" | "down" | "flat" } | null;
}

export interface OneQuestionMarket {
  place: string | null;
  counties: number;
  sodYear: number;
  branches: number;
  marketBranches: number;
  /** Its share of the deposits held in bank branches there, 0..100; null for a credit union. */
  depositShare: number | null;
  shareLabel: string | null;
}

/**
 * One question the section asks, with the output it opens and the evidence it lights, in the order
 * it lights them. Every question is backed by figures from the reads; a question whose figures are
 * missing is left out, so the set rotates only over questions with real answers.
 */
export interface OneQuestionAsk {
  key: string;
  question: string;
  output: OutputKey;
  evidence: EvidenceKey[];
  /** The fee it asks about; null for a question about fee income. */
  fee: OneQuestionFee | null;
}

export interface OneQuestionView {
  institution: string;
  place: string | null;
  peerNoun: string;
  /** The first question's text. */
  question: string;
  /** The first question's fee. */
  fee: OneQuestionFee | null;
  asks: OneQuestionAsk[];
  income: OneQuestionIncome | null;
  market: OneQuestionMarket | null;
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "2026-10-08" -> "Oct 8, 2026"; null when it is not a date. */
export function dateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : DATE.format(d);
}

function readRange(dates: (string | null)[]): string | null {
  const days = dates.filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10)).sort();
  if (days.length === 0) return null;
  const first = days[0];
  const last = days[days.length - 1];
  if (first === last) return dateLabel(first);
  const from = new Date(`${first}T00:00:00Z`);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${sameYear ? MONTH_DAY.format(from) : DATE.format(from)} to ${dateLabel(last)}`;
}

/**
 * The line the question asks about: the first of QUESTION_LINES the bank publishes; with no wire,
 * the nearest real fee it does publish, a comparable one above the local middle half first.
 */
export function pickQuestionLine(lines: ReportLine[]): ReportLine | null {
  for (const key of QUESTION_LINES) {
    const line = lines.find((l) => l.key === key && l.own);
    if (line) return line;
  }
  const priced = lines.filter((l) => l.own);
  return (
    priced.find((l) => l.comparable && l.position === "above_market") ??
    priced.find((l) => l.comparable) ??
    priced[0] ??
    null
  );
}

/** The question card: the brief's wording for a wire line; another fee only if no wire is published. */
export function questionFor(line: Pick<ReportLine, "key" | "label"> | null): string {
  if (!line || line.key.startsWith("wire_")) return "Should we change our outgoing wire fees?";
  return `Should we change our ${shortFeeName(line)} fee?`;
}

/** "Overdraft (per item)" -> "overdraft"; every wire line -> "wire". */
export function shortFeeName(line: Pick<ReportLine, "key" | "label">): string {
  if (line.key.startsWith("wire_")) return "wire";
  return lineName(line.label)
    .replace(/\s*\(.*\)\s*$/, "")
    .split(" ")
    .map((w) => (/^[A-Z]{2,}/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

/** Thousands of dollars -> "$5.7M" / "$840K", for a card's headline figure. */
export function compactIncome(thousands: number): string {
  if (Math.abs(thousands) >= 1000) return `$${(thousands / 1000).toFixed(1)}M`;
  return `$${Math.round(thousands).toLocaleString("en-US")}K`;
}

/** Thousands of dollars -> "$1,840,000": exact, so a small quarter-to-quarter move still shows. */
export function exactIncome(thousands: number): string {
  return `$${Math.round(thousands * 1000).toLocaleString("en-US")}`;
}

/** Second and fourth questions: these fees first, when the bank publishes them and they compare. */
const FOLLOW_UP_LINES = ["overdraft", "monthly_maintenance", "nsf", "atm_non_network", "stop_payment", "cashiers_check"];

function followUpLines(lines: ReportLine[], first: ReportLine | null): ReportLine[] {
  const usable = lines.filter((l) => l.own && l.comparable && l.peers && l.key !== first?.key && !l.key.startsWith("wire_"));
  const ranked = [
    ...FOLLOW_UP_LINES.map((k) => usable.find((l) => l.key === k)).filter((l): l is ReportLine => !!l),
    ...usable.filter((l) => !FOLLOW_UP_LINES.includes(l.key) && l.position === "above_market"),
    ...usable.filter((l) => !FOLLOW_UP_LINES.includes(l.key) && l.position !== "above_market"),
  ];
  return ranked;
}

/** Fees where rules and consumer complaints weigh most, so their questions light the regulatory card. */
const REGULATED = new Set(["overdraft", "nsf", "od_protection_transfer", "deposited_item_return"]);

/**
 * Up to four questions, one per output: the fee question that leads (Benchmark), a second fee's local
 * standing (Investigate), the latest Call Report move (Monitor) and a committee brief (Report). Each
 * is kept only when the reads hold its figures.
 */
export function buildAsks(report: MarketReport, first: ReportLine | null, fee: OneQuestionFee | null, income: OneQuestionIncome | null, peers: ReportPeerContext | null): OneQuestionAsk[] {
  const asks: OneQuestionAsk[] = [];
  if (first && fee && (fee.local || fee.sizePeers)) {
    asks.push({ key: `benchmark:${fee.key}`, question: questionFor(first), output: "benchmark", evidence: ["competitive", "financial", "market", "regulatory"], fee });
  }
  const [second, third] = followUpLines(report.analysis.lines, first);
  if (second) {
    const f = feeView(report, second, peers);
    asks.push({
      key: `investigate:${f.key}`,
      question: `Where does our ${f.short} fee stand locally?`,
      output: "investigate",
      evidence: REGULATED.has(second.key) ? ["competitive", "market", "regulatory"] : ["competitive", "market"],
      fee: f,
    });
  }
  if (income?.change) {
    asks.push({
      key: "monitor:income",
      question: `What changed in our ${income.measureLabel.toLowerCase()} in ${income.change.to}?`,
      output: "monitor",
      evidence: ["financial"],
      fee: null,
    });
  }
  // With no third fee, the brief covers the leading fee, but only beside other questions: a lone
  // fee question asked twice is not a rotation.
  const briefLine = third ?? (asks.length > 1 ? first : null);
  if (briefLine) {
    const f = briefLine === first ? fee : feeView(report, briefLine, peers);
    if (f && (f.local || f.sizePeers)) {
      asks.push({
        key: `report:${f.key}`,
        question: `What should our pricing committee see on ${f.short} fees?`,
        output: "report",
        evidence: ["financial", "competitive", "market", "regulatory"],
        fee: f,
      });
    }
  }
  return asks;
}

function feeView(report: MarketReport, line: ReportLine, peers: ReportPeerContext | null): OneQuestionFee {
  const own = line.own!;
  const local =
    line.comparable && line.peers
      ? {
          competitors: line.peers.n,
          medianLabel: cardMoney(line.peers.median),
          rangeLabel: `${cardMoney(line.peers.p25)} to ${cardMoney(line.peers.p75)}`,
          chargingLess: line.chargingLess,
          position: line.position,
        }
      : null;
  const sizeRow = peers?.fees.find((f) => f.key === line.key) ?? null;
  const sizePeers = sizeRow && peers ? { groupLabel: peers.groupLabel, count: sizeRow.peerCount, medianLabel: cardMoney(sizeRow.median) } : null;

  const bars: OneQuestionBar[] = [{ label: report.data.subject.institution_name, amount: own.amount, amountLabel: cardMoney(own.amount), kind: "subject" }];
  if (local && line.peers) bars.push({ label: "Local median", amount: line.peers.median, amountLabel: local.medianLabel, kind: "median" });
  if (sizeRow) bars.push({ label: `Median for ${report.data.subject.charter_type === "credit_union" ? "credit unions" : "banks"} its size`, amount: sizeRow.median, amountLabel: cardMoney(sizeRow.median), kind: "median" });
  const named = report.analysis.named
    .filter((c) => !EXCLUDED_NAMES.test(c.institution_name) && Number.isFinite(c.fees[line.key]))
    .slice(0, CHART_COMPETITORS);
  for (const c of named) bars.push({ label: c.institution_name, amount: c.fees[line.key], amountLabel: cardMoney(c.fees[line.key]), kind: "competitor" });

  return {
    key: line.key,
    label: lineName(line.label),
    short: shortFeeName(line),
    name: line.key.startsWith("wire_") ? lineName(line.label).toLowerCase() : shortFeeName(line),
    amountLabel: cardMoney(own.amount),
    readOn: dateLabel(own.schedule_read_on ?? own.updated_at),
    local,
    sizePeers,
    bars,
    competitorReadRange: readRange(line.peerFigures.map((f) => f.schedule_read_on ?? f.updated_at)),
  };
}

function incomeView(revenue: RevenueContext, financial: ReportPeerFinancial | null, filing: string): OneQuestionIncome {
  const newest = revenue.quarters[0];
  const prior = revenue.quarters[1];
  const shareRow = financial?.rows.find((r) => r.key === "fee_income_ratio") ?? null;
  let change: OneQuestionIncome["change"] = null;
  if (prior && prior.thousands > 0) {
    const pct = ((newest.thousands - prior.thousands) / prior.thousands) * 100;
    const rounded = Math.round(pct * 10) / 10;
    change = {
      from: quarterLabel(prior.quarter),
      to: quarterLabel(newest.quarter),
      fromLabel: exactIncome(prior.thousands),
      toLabel: exactIncome(newest.thousands),
      pctLabel: `${Math.abs(rounded).toFixed(1)}%`,
      direction: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat",
    };
  }
  return {
    measureLabel: revenue.measureLabel,
    filing,
    quarters: [...revenue.quarters].reverse().map((q) => ({ label: quarterLabel(q.quarter), thousands: q.thousands, valueLabel: incomeLabel(q.thousands) })),
    latestQuarter: quarterLabel(newest.quarter),
    latestLabel: incomeLabel(newest.thousands),
    latestCompact: compactIncome(newest.thousands),
    sizeMedian: revenue.peer ? { tierLabel: revenue.peer.tierLabel, valueLabel: incomeLabel(revenue.peer.medianThousands) } : null,
    share:
      shareRow && financial
        ? { own: `${shareRow.own.toFixed(1)}%`, median: `${shareRow.median.toFixed(1)}%`, quarter: quarterOfDate(financial.reportDate) }
        : null,
    change,
  };
}

function marketView(report: MarketReport, branches: MarketBranchFootprint, place: string | null): OneQuestionMarket | null {
  const own = branches.byInstitution[report.data.subject.institution_id];
  if (!own || own.branches === 0 || !report.data.market) return null;
  const share = own.deposits !== null && branches.totalDeposits > 0 ? (own.deposits / branches.totalDeposits) * 100 : null;
  return {
    place,
    counties: report.data.market.county_fips.length,
    sodYear: branches.sod_year,
    branches: own.branches,
    marketBranches: branches.totalBranches,
    depositShare: share,
    shareLabel: share === null ? null : share < 0.1 ? "under 0.1%" : `${share.toFixed(1)}%`,
  };
}

export function buildOneQuestionView({
  report,
  revenue = null,
  financial = null,
  peers = null,
  branches = null,
}: {
  report: MarketReport | null;
  revenue?: RevenueContext | null;
  financial?: ReportPeerFinancial | null;
  peers?: ReportPeerContext | null;
  branches?: MarketBranchFootprint | null;
}): OneQuestionView | null {
  if (!report) return null;
  const subject = report.data.subject;
  const cu = subject.charter_type === "credit_union";
  const filing = cu ? "NCUA 5300 Call Report" : "FDIC Call Report";
  const place = report.data.market?.places[0] ? placeLabel(report.data.market.places[0]) : null;
  const line = pickQuestionLine(report.analysis.lines);
  const fee = line ? feeView(report, line, peers) : null;
  const income = revenue ? incomeView(revenue, financial ?? peers?.financial ?? null, filing) : null;
  return {
    institution: subject.institution_name,
    place,
    peerNoun: cu ? "credit unions" : "banks",
    question: questionFor(line),
    fee,
    asks: buildAsks(report, line, fee, income, peers),
    income,
    market: branches ? marketView(report, branches, place) : null,
  };
}
