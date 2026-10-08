/**
 * Reads for Hamilton's merger screen: two banks' branches and deposits from the FDIC Summary
 * of Deposits (institution_branch_deposits, latest year), the deposit holders in every county
 * where both have branches, quarterly call report figures, and each bank's published dollar
 * fees. Read-only; the screen itself is drawn by src/lib/hamilton/studies-exhibits/merger.ts.
 *
 * Units: SOD deposits and call report balances are in thousands of dollars. ffiec rows
 * duplicate fdic quarters at other scales (whole dollars, service charges over-scaled), so the
 * financial read uses the thousands-scale sources only, as call-reports.ts does.
 */
import { sql } from "./connection";
import { STATS_ROW_FILTER } from "./fee-stats";

export interface MergerBankInfo {
  id: number;
  name: string;
  city: string | null;
  stateCode: string | null;
  charterType: string | null;
}

export interface MergerBranch {
  /** 0 for the first bank of the pair, 1 for the second. */
  bank: 0 | 1;
  name: string;
  city: string | null;
  /** Five-digit county FIPS. */
  fips: string;
  lat: number | null;
  lon: number | null;
  /** Branch deposits, thousands of dollars. */
  depositsK: number;
}

export interface MarketHolder {
  /** institution_sources id, or null for a SOD filer not linked to one. */
  institutionId: number | null;
  /** Stable key: the institution id, or the FDIC certificate when unlinked. */
  key: string;
  name: string;
  /** Deposits at the holder's branches in the county, thousands of dollars. */
  depositsK: number;
  branches: number;
}

export interface CountyMarket {
  fips: string;
  holders: MarketHolder[];
}

/** One call report quarter, balances and income in thousands of dollars. */
export interface QuarterRecord {
  date: string;
  source: string;
  assets: number | null;
  deposits: number | null;
  loans: number | null;
  /** Quarterly deposit service charges (NCUA year-to-date figures split into quarters). */
  serviceCharges: number | null;
  /** Quarterly net income (NCUA year-to-date figures split into quarters). */
  netIncome: number | null;
  roa: number | null;
  efficiency: number | null;
  nim: number | null;
  tier1: number | null;
  uninsured: number | null;
}

/** A fee category's published dollar amounts at one bank. */
export type FeeAmounts = Record<string, number[]>;

export interface MergerScreenData {
  banks: [MergerBankInfo, MergerBankInfo];
  /** Latest Summary of Deposits year (deposits as of June 30), or null when none is loaded. */
  sodYear: number | null;
  branches: MergerBranch[];
  /** Counties where both banks have branches, with every holder of deposits there. */
  markets: CountyMarket[];
  financials: [QuarterRecord[], QuarterRecord[]];
  fees: [FeeAmounts, FeeAmounts];
}

export interface MergerCandidate {
  id: number;
  name: string;
  city: string | null;
  stateCode: string | null;
  sharedCounties: number;
  /** The candidate's deposits in the counties it shares with the subject, thousands. */
  sharedDepositsK: number;
}

/** Earliest quarter the earnings exhibit draws. */
export const MERGER_SINCE = "2024-01-01";

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

export async function getMergerBanks(a: number, b: number): Promise<[MergerBankInfo, MergerBankInfo] | null> {
  const rows = await sql<{ id: number; institution_name: string; city: string | null; state_code: string | null; charter_type: string | null }[]>`
    SELECT id, institution_name, city, state_code, charter_type FROM institution_sources WHERE id IN (${a}, ${b})`;
  const pick = (id: number) => rows.find((r) => Number(r.id) === id);
  const ra = pick(a);
  const rb = pick(b);
  if (!ra || !rb) return null;
  const info = (r: typeof ra): MergerBankInfo => ({
    id: Number(r.id),
    name: r.institution_name,
    city: r.city,
    stateCode: r.state_code,
    charterType: r.charter_type,
  });
  return [info(ra), info(rb)];
}

export async function getLatestSodYear(): Promise<number | null> {
  const [row] = await sql<{ y: number | null }[]>`SELECT MAX(year) AS y FROM institution_branch_deposits`;
  return row?.y == null ? null : Number(row.y);
}

/**
 * Banks with branches in the subject's counties in the latest SOD year, ranked by their
 * deposits in those shared counties.
 */
export async function getMergerCandidates(subjectId: number, limit = 12): Promise<MergerCandidate[]> {
  const rows = await sql<
    { id: number; institution_name: string; city: string | null; state_code: string | null; counties: number; shared: string }[]
  >`
    WITH yr AS (SELECT MAX(year) AS y FROM institution_branch_deposits),
    own AS (
      SELECT DISTINCT b.county_fips FROM institution_branch_deposits b, yr
       WHERE b.year = yr.y AND b.institution_id = ${subjectId} AND b.county_fips IS NOT NULL
    )
    SELECT s.id, s.institution_name, s.city, s.state_code,
           COUNT(DISTINCT b.county_fips)::int AS counties,
           SUM(COALESCE(b.deposits, 0))::text AS shared
      FROM institution_branch_deposits b
      JOIN yr ON b.year = yr.y
      JOIN own o ON o.county_fips = b.county_fips
      JOIN institution_sources s ON s.id = b.institution_id
     WHERE b.institution_id <> ${subjectId}
     GROUP BY s.id, s.institution_name, s.city, s.state_code
     ORDER BY SUM(COALESCE(b.deposits, 0)) DESC
     LIMIT ${limit}`;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.institution_name,
    city: r.city,
    stateCode: r.state_code,
    sharedCounties: Number(r.counties),
    sharedDepositsK: Number(r.shared),
  }));
}

async function getBranches(ids: [number, number], year: number): Promise<MergerBranch[]> {
  const rows = await sql<
    { institution_id: number; branch_name: string | null; city: string | null; fips: string; latitude: number | null; longitude: number | null; deposits: string | null }[]
  >`
    SELECT institution_id, branch_name, city, lpad(county_fips::text, 5, '0') AS fips,
           latitude, longitude, deposits::text AS deposits
      FROM institution_branch_deposits
     WHERE year = ${year} AND institution_id IN (${ids[0]}, ${ids[1]}) AND county_fips IS NOT NULL`;
  return rows.map((r) => ({
    bank: Number(r.institution_id) === ids[0] ? 0 : 1,
    name: r.branch_name ?? "Branch",
    city: r.city,
    fips: r.fips,
    lat: num(r.latitude),
    lon: num(r.longitude),
    depositsK: num(r.deposits) ?? 0,
  }));
}

async function getCountyMarkets(fips: string[], year: number): Promise<CountyMarket[]> {
  if (fips.length === 0) return [];
  const rows = await sql<
    { fips: string; institution_id: number | null; cert: number | null; name: string | null; deposits: string; branches: number }[]
  >`
    SELECT lpad(b.county_fips::text, 5, '0') AS fips, b.institution_id, MIN(b.cert) AS cert,
           MIN(s.institution_name) AS name,
           SUM(COALESCE(b.deposits, 0))::text AS deposits, COUNT(*)::int AS branches
      FROM institution_branch_deposits b
      LEFT JOIN institution_sources s ON s.id = b.institution_id
     WHERE b.year = ${year} AND lpad(b.county_fips::text, 5, '0') = ANY(${fips}::text[])
     GROUP BY 1, b.institution_id, CASE WHEN b.institution_id IS NULL THEN b.cert END`;
  const byFips = new Map<string, MarketHolder[]>();
  for (const r of rows) {
    const list = byFips.get(r.fips) ?? [];
    const id = r.institution_id == null ? null : Number(r.institution_id);
    list.push({
      institutionId: id,
      key: id != null ? `i${id}` : `c${r.cert ?? list.length}`,
      name: r.name ?? (r.cert != null ? `FDIC certificate ${r.cert}` : "Unnamed bank"),
      depositsK: Number(r.deposits),
      branches: Number(r.branches),
    });
    byFips.set(r.fips, list);
  }
  return fips.map((f) => ({ fips: f, holders: (byFips.get(f) ?? []).sort((x, y) => y.depositsK - x.depositsK) }));
}

interface FinancialRow {
  institution_id: number;
  report_date: string;
  source: string;
  total_assets: string | null;
  total_deposits: string | null;
  total_loans: string | null;
  service_charge_income: string | null;
  net_income: string | null;
  roa: number | null;
  efficiency_ratio: number | null;
  net_interest_margin: number | null;
  tier1_capital_ratio: number | null;
  uninsured_deposits: string | null;
}

/**
 * NCUA 5300 income lines are year-to-date; FDIC rows are already quarterly. A YTD figure
 * becomes a quarter by subtracting the prior quarter of the same year (Q1 stands alone),
 * and stays unknown when that prior quarter is missing.
 */
export function quarterlyFromYtd(rows: QuarterRecord[]): QuarterRecord[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return rows.map((r) => {
    if (r.source !== "ncua") return r;
    const month = Number(r.date.slice(5, 7));
    if (month <= 3) return r;
    const priorMonth = month - 3;
    const priorDay = priorMonth === 6 ? 30 : priorMonth === 9 ? 30 : 31;
    const prior = byDate.get(`${r.date.slice(0, 4)}-${String(priorMonth).padStart(2, "0")}-${priorDay}`);
    const minus = (cur: number | null, prev: number | null | undefined) => (cur != null && prev != null ? cur - prev : null);
    // The prior row is the raw YTD row (rows are passed in as read).
    return { ...r, netIncome: minus(r.netIncome, prior?.netIncome), serviceCharges: minus(r.serviceCharges, prior?.serviceCharges) };
  });
}

async function getFinancials(ids: [number, number]): Promise<[QuarterRecord[], QuarterRecord[]]> {
  // A quarter before MERGER_SINCE is read too, so the first YTD quarter can be split.
  const rows = await sql<FinancialRow[]>`
    SELECT institution_id, report_date, source,
           total_assets::text AS total_assets, total_deposits::text AS total_deposits,
           total_loans::text AS total_loans, service_charge_income::text AS service_charge_income,
           net_income::text AS net_income, roa, efficiency_ratio, net_interest_margin,
           tier1_capital_ratio, uninsured_deposits::text AS uninsured_deposits
      FROM institution_financial_records
     WHERE institution_id IN (${ids[0]}, ${ids[1]})
       AND source IN ('fdic', 'ncua')
       AND report_date >= '2023-10-01'
     ORDER BY institution_id, report_date, source`;
  const per = (id: number): QuarterRecord[] => {
    const seen = new Map<string, QuarterRecord>();
    for (const r of rows.filter((x) => Number(x.institution_id) === id)) {
      const date = String(r.report_date).slice(0, 10);
      // One row per quarter; an fdic row is preferred when both sources filed.
      if (seen.has(date) && seen.get(date)!.source === "fdic") continue;
      seen.set(date, {
        date,
        source: r.source,
        assets: num(r.total_assets),
        deposits: num(r.total_deposits),
        loans: num(r.total_loans),
        serviceCharges: num(r.service_charge_income),
        netIncome: num(r.net_income),
        roa: num(r.roa),
        efficiency: num(r.efficiency_ratio),
        nim: num(r.net_interest_margin),
        tier1: num(r.tier1_capital_ratio),
        uninsured: num(r.uninsured_deposits),
      });
    }
    const all = [...seen.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
    return quarterlyFromYtd(all).filter((q) => q.date >= MERGER_SINCE);
  };
  return [per(ids[0]), per(ids[1])];
}

/** Each bank's approved, sourced dollar fees by category (rates are never mixed in). */
async function getDollarFees(ids: [number, number]): Promise<[FeeAmounts, FeeAmounts]> {
  const rows = (await sql.unsafe(
    `SELECT ef.institution_id, ef.fee_category, ef.amount::float8 AS amount
       FROM published_fee_catalog ef
      WHERE ef.institution_id = ANY($1::int[])
        AND ef.review_status = 'approved'
        AND ef.fee_category IS NOT NULL
        AND ef.amount IS NOT NULL
        AND COALESCE(ef.amount_kind, 'flat') <> 'percent'
        AND COALESCE(ef.is_fee_cap, false) = false
        AND ${STATS_ROW_FILTER}`,
    [ids] as never[],
  )) as { institution_id: number; fee_category: string; amount: number }[];
  const out: [FeeAmounts, FeeAmounts] = [{}, {}];
  for (const r of rows) {
    const side = Number(r.institution_id) === ids[0] ? 0 : 1;
    (out[side][r.fee_category] ??= []).push(Number(r.amount));
  }
  return out;
}

export async function getMergerScreenData(a: number, b: number): Promise<MergerScreenData | null> {
  const banks = await getMergerBanks(a, b);
  if (!banks) return null;
  const ids: [number, number] = [a, b];
  const [sodYear, financials, fees] = await Promise.all([getLatestSodYear(), getFinancials(ids), getDollarFees(ids)]);
  const branches = sodYear ? await getBranches(ids, sodYear) : [];
  const counties = (bank: 0 | 1) => new Set(branches.filter((x) => x.bank === bank).map((x) => x.fips));
  const second = counties(1);
  const overlap = [...counties(0)].filter((f) => second.has(f)).sort();
  const markets = sodYear ? await getCountyMarkets(overlap, sodYear) : [];
  return { banks, sodYear, branches, markets, financials, fees };
}
