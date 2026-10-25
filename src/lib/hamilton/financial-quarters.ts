/**
 * The financial performance view (#1892): one institution's filed quarters of fee income,
 * deposits and assets, each quarter's change on the quarter before and the same quarter a year
 * earlier, the peer median beside it, and the evidence behind every figure.
 *
 * Pure: the reads are in `src/lib/data-store/institution-financial-quarters.ts`. Rules:
 * - Fee income is shown for one quarter alone. FDIC BankFind rows are already one quarter
 *   (ISERCHGQ). NCUA 5300 Account 131 is year to date: a quarter is its year to date less the
 *   filing dated the previous quarter end in the same year (Q1 stands as filed), the same exact
 *   rule as the call-report readers (`QUARTER_SC`). With that filing missing the quarter is left
 *   empty, so a year-to-date total is never read as one quarter. The filed year to date is kept
 *   in its own field and labelled.
 * - Deposits and assets are balances at quarter end and are never differenced.
 * - Each stored figure is checked against the variable in the filing as stored (raw_json): a fee
 *   figure that differs is held back, never shown.
 * - A peer median shows only when at least FINANCIAL_PEER_MINIMUM peers report the measure.
 */

/** Ten quarters is the target; never more than twelve, and a view under eight says so. */
export const FINANCIAL_VIEW_QUARTERS = 12;
export const FINANCIAL_VIEW_MIN_QUARTERS = 8;
/** Financial peers follow the 10-everywhere rule (MIN_PEERS_FOR_POSITION in workspace/scenario.ts). */
export const FINANCIAL_PEER_MINIMUM = 10;

export type FinancialFilingSource = "fdic" | "ncua";

/** One stored filing, as read. Money in thousands of dollars as stored; raw values in the filing's own unit. */
export interface FiledQuarterRow {
  recordId: number;
  reportDate: string;
  source: FinancialFilingSource;
  institutionName: string;
  certNumber: string | null;
  /** FDIC: the quarter's service charges. NCUA: fee income year to date. */
  feeIncome: number | null;
  totalDeposits: number | null;
  totalAssets: number | null;
  /** The same variables as they sit in the stored filing (FDIC thousands, NCUA whole dollars). */
  rawFeeIncome: number | null;
  rawDeposits: number | null;
  rawAssets: number | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
}

export interface PeerQuarterRow {
  reportDate: string;
  feeMedian: number | null;
  feePeers: number;
  depositsMedian: number | null;
  depositsPeers: number;
  assetsMedian: number | null;
  assetsPeers: number;
}

export type MeasureKey = "fee" | "deposits" | "assets";

export interface MeasureCell {
  /** Thousands of dollars; null when not filed, not splittable or held back. */
  value: number | null;
  /** Percent change on the previous quarter end, one decimal. */
  qoqPct: number | null;
  /** Percent change on the same quarter a year earlier, one decimal. */
  yoyPct: number | null;
  /** Null when fewer than FINANCIAL_PEER_MINIMUM peers report it. */
  peerMedian: number | null;
  peers: number;
}

export type Reconciliation = "matches" | "differs" | "not_in_record";

export interface FiledVariable {
  code: string;
  name: string;
  basis: "quarter" | "year_to_date" | "quarter_end_balance";
  /** As stored for the page, thousands of dollars. */
  stored: number | null;
  /** As it sits in the filing record, in `rawUnit`. */
  filed: number | null;
  rawUnit: "thousands of dollars" | "dollars";
  check: Reconciliation;
}

export interface QuarterEvidence {
  entity: string;
  regulator: "FDIC" | "NCUA";
  form: string;
  quarterEnd: string;
  retrievedAt: string | null;
  sourceUrl: string | null;
  variables: FiledVariable[];
  /** Plain words: how the quarter's fee income was worked out from the variables. */
  calculation: string;
  /** Why the fee figure is empty, when it is. */
  heldReason: string | null;
}

export interface FinancialQuarter {
  reportDate: string;
  /** "2026-Q2", the chart's key. */
  key: string;
  /** "Q2 2026". */
  label: string;
  fee: MeasureCell & { yearToDate: number | null };
  deposits: MeasureCell;
  assets: MeasureCell;
  evidence: QuarterEvidence;
}

export interface FinancialPerformanceView {
  source: FinancialFilingSource;
  institutionName: string;
  /** Newest first. */
  quarters: FinancialQuarter[];
  /** True when fewer than FINANCIAL_VIEW_MIN_QUARTERS quarters are on file. */
  short: boolean;
}

const VARIABLES: Record<FinancialFilingSource, Record<MeasureKey, { code: string; name: string; basis: FiledVariable["basis"] }>> = {
  fdic: {
    fee: { code: "ISERCHGQ", name: "Service charges on deposit accounts, quarter", basis: "quarter" },
    deposits: { code: "DEP", name: "Total deposits", basis: "quarter_end_balance" },
    assets: { code: "ASSET", name: "Total assets", basis: "quarter_end_balance" },
  },
  ncua: {
    fee: { code: "ACCT_131", name: "Fee income, year to date", basis: "year_to_date" },
    deposits: { code: "ACCT_018", name: "Total shares and deposits", basis: "quarter_end_balance" },
    assets: { code: "ACCT_010", name: "Total assets", basis: "quarter_end_balance" },
  },
};

export function filingVariables(source: FinancialFilingSource) {
  return VARIABLES[source];
}

/** Quarter number 1-4 of a quarter-end date. */
export function quarterNumber(reportDate: string): number {
  return Math.ceil(Number(reportDate.slice(5, 7)) / 3);
}

const QUARTER_END = ["03-31", "06-30", "09-30", "12-31"];

export function isQuarterEnd(reportDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(reportDate) && QUARTER_END.includes(reportDate.slice(5));
}

/** The quarter-end date one quarter earlier. */
export function previousQuarterEnd(reportDate: string): string {
  const year = Number(reportDate.slice(0, 4));
  const q = quarterNumber(reportDate);
  return q === 1 ? `${year - 1}-12-31` : `${year}-${QUARTER_END[q - 2]}`;
}

/** The same quarter end a year earlier. */
export function yearEarlier(reportDate: string): string {
  return `${Number(reportDate.slice(0, 4)) - 1}${reportDate.slice(4)}`;
}

export function quarterLabel(reportDate: string): string {
  return `Q${quarterNumber(reportDate)} ${reportDate.slice(0, 4)}`;
}

export function quarterKeyOf(reportDate: string): string {
  return `${reportDate.slice(0, 4)}-Q${quarterNumber(reportDate)}`;
}

/** Percent change, one decimal; null without a positive base. */
export function pctChange(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || !(prior > 0)) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

/** Does the stored figure (thousands) match the filed variable in its own unit? */
export function reconcile(stored: number | null, filed: number | null, rawUnit: FiledVariable["rawUnit"]): Reconciliation {
  if (stored === null || filed === null) return "not_in_record";
  const expected = rawUnit === "dollars" ? Math.round(filed / 1000) : Math.round(filed);
  return expected === stored ? "matches" : "differs";
}

/** "$8.8 million", "$450 thousand", from thousands of dollars. */
export function filedThousandsText(value: number): string {
  const dollars = value * 1000;
  if (Math.abs(dollars) >= 1_000_000_000) return `$${(dollars / 1_000_000_000).toFixed(2)} billion`;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)} million`;
  return `$${Math.round(value).toLocaleString("en-US")} thousand`;
}

function dayText(reportDate: string): string {
  const [y, m, d] = reportDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** One filing per quarter end: the newest record wins. Non-quarter-end dates are dropped. */
function byQuarter(rows: readonly FiledQuarterRow[], source: FinancialFilingSource): Map<string, FiledQuarterRow> {
  const out = new Map<string, FiledQuarterRow>();
  for (const row of rows) {
    if (row.source !== source || !isQuarterEnd(row.reportDate)) continue;
    const seen = out.get(row.reportDate);
    if (!seen || row.recordId > seen.recordId) out.set(row.reportDate, row);
  }
  return out;
}

interface FeeRead {
  quarter: number | null;
  calculation: string;
  heldReason: string | null;
}

/** The quarter's own fee income from the filings, with the words for how. */
function feeForQuarter(row: FiledQuarterRow, filings: Map<string, FiledQuarterRow>, check: Reconciliation): FeeRead {
  const code = VARIABLES[row.source].fee.code;
  if (row.feeIncome === null) return { quarter: null, calculation: `${code} is not in this filing.`, heldReason: "Not filed for this quarter." };
  if (check === "differs") {
    return {
      quarter: null,
      calculation: `The stored figure does not match ${code} in the filing.`,
      heldReason: "Held back: the stored figure does not match the filing.",
    };
  }
  const filed = filedThousandsText(row.feeIncome);
  if (row.source === "fdic") {
    return { quarter: row.feeIncome, calculation: `${code} is filed for the quarter alone: ${filed}. No conversion.`, heldReason: null };
  }
  if (quarterNumber(row.reportDate) === 1) {
    return { quarter: row.feeIncome, calculation: `${code} year to date at ${dayText(row.reportDate)} is the first quarter alone: ${filed}.`, heldReason: null };
  }
  const priorDate = previousQuarterEnd(row.reportDate);
  const prior = filings.get(priorDate);
  if (!prior || prior.feeIncome === null) {
    return {
      quarter: null,
      calculation: `${code} year to date at ${dayText(row.reportDate)} is ${filed}. The ${dayText(priorDate)} filing is not on file, so the quarter cannot be split out.`,
      heldReason: "Not shown: the previous quarter's filing is missing, so the year-to-date total cannot be split.",
    };
  }
  const quarter = row.feeIncome - prior.feeIncome;
  return {
    quarter,
    calculation: `${code} year to date at ${dayText(row.reportDate)} (${filed}) less ${code} year to date at ${dayText(priorDate)} (${filedThousandsText(prior.feeIncome)}) = ${filedThousandsText(quarter)} for the quarter.`,
    heldReason: null,
  };
}

function peerCell(median: number | null, peers: number): Pick<MeasureCell, "peerMedian" | "peers"> {
  return { peerMedian: peers >= FINANCIAL_PEER_MINIMUM && median !== null ? median : null, peers };
}

/**
 * Builds the view from the institution's stored filings (any order, older quarters included so
 * the earliest shown quarter has its prior quarter and its year-ago quarter) and the peer medians.
 * Shows the newest FINANCIAL_VIEW_QUARTERS quarter ends of the institution's own regulator.
 */
export function buildFinancialPerformance(
  rows: readonly FiledQuarterRow[],
  peers: readonly PeerQuarterRow[],
  maxQuarters = FINANCIAL_VIEW_QUARTERS,
): FinancialPerformanceView | null {
  const newest = [...rows].filter((r) => isQuarterEnd(r.reportDate)).sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.recordId - a.recordId)[0];
  if (!newest) return null;
  const source = newest.source;
  const filings = byQuarter(rows, source);
  const peerByDate = new Map(peers.map((p) => [p.reportDate, p]));
  const dates = [...filings.keys()].sort((a, b) => b.localeCompare(a));

  // Every quarter's own figures first, so changes can read the quarter before and a year before.
  const own = new Map<string, { fee: FeeRead; feeCheck: Reconciliation; variables: FiledVariable[] }>();
  for (const date of dates) {
    const row = filings.get(date)!;
    const vars = VARIABLES[source];
    const rawUnit: FiledVariable["rawUnit"] = source === "ncua" ? "dollars" : "thousands of dollars";
    const variables: FiledVariable[] = [
      { ...vars.fee, stored: row.feeIncome, filed: row.rawFeeIncome, rawUnit, check: reconcile(row.feeIncome, row.rawFeeIncome, rawUnit) },
      { ...vars.deposits, stored: row.totalDeposits, filed: row.rawDeposits, rawUnit, check: reconcile(row.totalDeposits, row.rawDeposits, rawUnit) },
      { ...vars.assets, stored: row.totalAssets, filed: row.rawAssets, rawUnit, check: reconcile(row.totalAssets, row.rawAssets, rawUnit) },
    ];
    own.set(date, { fee: feeForQuarter(row, filings, variables[0].check), feeCheck: variables[0].check, variables });
  }
  const balance = (date: string, key: "deposits" | "assets"): number | null => {
    const v = own.get(date)?.variables[key === "deposits" ? 1 : 2];
    return v && v.check !== "differs" ? v.stored : null;
  };
  const feeOf = (date: string) => own.get(date)?.fee.quarter ?? null;

  const quarters: FinancialQuarter[] = dates.slice(0, maxQuarters).map((date) => {
    const row = filings.get(date)!;
    const read = own.get(date)!;
    const peer = peerByDate.get(date);
    const prev = previousQuarterEnd(date);
    const ago = yearEarlier(date);
    const feeValue = feeOf(date);
    const measure = (value: number | null, prior: number | null, yearAgo: number | null, median: number | null, n: number): MeasureCell => ({
      value, qoqPct: pctChange(value, prior), yoyPct: pctChange(value, yearAgo), ...peerCell(median, n),
    });
    const regulator = source === "fdic" ? "FDIC" : "NCUA";
    const idText = row.certNumber ? (source === "fdic" ? `, FDIC certificate ${row.certNumber}` : `, NCUA charter ${row.certNumber}`) : "";
    return {
      reportDate: date,
      key: quarterKeyOf(date),
      label: quarterLabel(date),
      fee: {
        ...measure(feeValue, feeOf(prev), feeOf(ago), peer?.feeMedian ?? null, peer?.feePeers ?? 0),
        yearToDate: source === "ncua" && read.feeCheck !== "differs" ? row.feeIncome : null,
      },
      deposits: measure(balance(date, "deposits"), balance(prev, "deposits"), balance(ago, "deposits"), peer?.depositsMedian ?? null, peer?.depositsPeers ?? 0),
      assets: measure(balance(date, "assets"), balance(prev, "assets"), balance(ago, "assets"), peer?.assetsMedian ?? null, peer?.assetsPeers ?? 0),
      evidence: {
        entity: `${row.institutionName}${idText}`,
        regulator,
        form: source === "fdic" ? "FDIC call report, as published in FDIC BankFind" : "NCUA 5300 call report",
        quarterEnd: date,
        retrievedAt: row.retrievedAt,
        sourceUrl: row.sourceUrl && /^https:\/\//.test(row.sourceUrl) ? row.sourceUrl : null,
        variables: read.variables,
        calculation: read.fee.calculation,
        heldReason: read.fee.heldReason,
      },
    };
  });

  return { source, institutionName: newest.institutionName, quarters, short: quarters.length < FINANCIAL_VIEW_MIN_QUARTERS };
}

/** The quarter ends the peer read needs: the shown quarters. */
export function peerQuarterDates(rows: readonly FiledQuarterRow[], maxQuarters = FINANCIAL_VIEW_QUARTERS): string[] {
  const newest = [...rows].filter((r) => isQuarterEnd(r.reportDate)).sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
  if (!newest) return [];
  return [...byQuarter(rows, newest.source).keys()].sort((a, b) => b.localeCompare(a)).slice(0, maxQuarters);
}

function signedPct(value: number): string {
  return value === 0 ? "unchanged" : `${value > 0 ? "up" : "down"} ${Math.abs(value).toFixed(1)}%`;
}

/**
 * The one-line reading for a chief executive: the newest quarter with fee income, its change on
 * a year earlier, and the peer median when enough peers report. Every number is from the view.
 */
export function headlineSentence(view: FinancialPerformanceView): string | null {
  const latest = view.quarters.find((q) => q.fee.value !== null);
  if (!latest || latest.fee.value === null) return null;
  const noun = view.source === "ncua" ? "Fee income" : "Deposit service charges";
  const verb = view.source === "ncua" ? "was" : "were";
  let sentence = `${noun} in ${latest.label} ${verb} ${filedThousandsText(latest.fee.value)}`;
  if (latest.fee.yoyPct !== null) sentence += `, ${signedPct(latest.fee.yoyPct)} on ${quarterLabel(yearEarlier(latest.reportDate))}`;
  sentence += ".";
  if (latest.fee.peerMedian !== null) {
    sentence += ` The peer group median was ${filedThousandsText(latest.fee.peerMedian)} across ${latest.fee.peers} institutions.`;
  }
  return sentence;
}
