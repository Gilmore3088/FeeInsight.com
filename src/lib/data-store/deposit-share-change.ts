import { sql } from "@/lib/data-store/connection";

/**
 * "Who is winning deposits in my markets?" Deposit market share and its change over one and five
 * years, by county and by metro, computed from the FDIC Summary of Deposits rows Magellan already
 * loads (institution_branch_deposits, step fdic-sod: one row per bank office per June 30, deposits
 * in thousands). Server only; nothing is fetched or written.
 *
 * Definitions, so every figure can be traced back:
 *   - A market is a county (institution_branch_deposits.county_fips, FDIC STCNTYBR) or a metro
 *     (msa_code, FDIC MSABR as stored by the loader).
 *   - An institution is an FDIC certificate (cert): the charter that holds the offices.
 *     institution_id is shown when the loader matched the cert to institution_sources.
 *   - Share = the cert's deposits in the market / all SOD deposits in the market that year, in
 *     percent. Change is in percentage points. A cert with no offices in the market in a year has
 *     share 0 that year only when the market itself has SOD rows that year; a market with no rows
 *     that year gives no change (null), never a zero.
 *   - Offices with a blank deposit figure are left out of every sum and counted.
 *   - The SOD covers FDIC-insured institutions only. Credit unions are not in it, so these shares
 *     are of bank and savings-institution deposits, not of all deposits.
 *   - A gain can come from buying another bank: after a merger the target's offices file under the
 *     acquirer's cert. `acquisitions_in_window` counts structure events (FDIC history, NCUA lists)
 *     that name the cert as acquirer with an effective date inside the five-year window, so an
 *     acquired gain is visible next to the share change.
 */

export type MarketGeo = "county" | "metro";

export interface SodRow {
  year: number;
  market: number;
  cert: number;
  institution_id: number | null;
  /** Thousands of dollars; null when the office's figure was blank. */
  deposits: number | null;
  branches: number;
}

export interface ShareChangeRow {
  market: number;
  cert: number;
  institution_id: number | null;
  deposits: number;
  branches: number;
  share: number;
  share_1y_ago: number | null;
  share_5y_ago: number | null;
  /** Percentage points; null when the market had no SOD rows in the comparison year. */
  change_1y_pp: number | null;
  change_5y_pp: number | null;
  deposits_1y_ago: number | null;
  deposits_5y_ago: number | null;
  rank: number;
}

export interface MarketShareSummary {
  market: number;
  year: number;
  total_deposits: number;
  institutions: number;
  total_deposits_1y_ago: number | null;
  total_deposits_5y_ago: number | null;
  /** Offices with a blank deposit figure, left out of the sums (end year). */
  blank_deposit_offices: number;
  rows: ShareChangeRow[];
}

const round = (value: number, places = 3) => Number(value.toFixed(places));

/**
 * Pure: shares and changes per market from per-(year, market, cert) sums. Certs present only in
 * the earlier years (gone by the end year) are not listed; their share moved to whoever is.
 */
export function computeShareChanges(rows: SodRow[], endYear: number): MarketShareSummary[] {
  const byMarket = new Map<number, SodRow[]>();
  for (const r of rows) {
    const list = byMarket.get(r.market) ?? [];
    list.push(r);
    byMarket.set(r.market, list);
  }
  const out: MarketShareSummary[] = [];
  for (const [market, list] of byMarket) {
    const totals = new Map<number, number>();
    const certYear = new Map<string, SodRow>();
    let blank = 0;
    for (const r of list) {
      if (r.deposits === null) {
        if (r.year === endYear) blank += r.branches;
        continue;
      }
      totals.set(r.year, (totals.get(r.year) ?? 0) + r.deposits);
      const key = `${r.year}:${r.cert}`;
      const prev = certYear.get(key);
      certYear.set(key, prev ? { ...prev, deposits: (prev.deposits ?? 0) + r.deposits, branches: prev.branches + r.branches, institution_id: prev.institution_id ?? r.institution_id } : { ...r });
    }
    const total = totals.get(endYear);
    if (!total) continue;
    const shareIn = (year: number, cert: number): number | null => {
      const t = totals.get(year);
      if (!t) return null;
      return ((certYear.get(`${year}:${cert}`)?.deposits ?? 0) / t) * 100;
    };
    const current = [...certYear.values()].filter((r) => r.year === endYear);
    const rowsOut: ShareChangeRow[] = current
      .map((r) => {
        const share = ((r.deposits ?? 0) / total) * 100;
        const s1 = shareIn(endYear - 1, r.cert);
        const s5 = shareIn(endYear - 5, r.cert);
        return {
          market,
          cert: r.cert,
          institution_id: r.institution_id,
          deposits: r.deposits ?? 0,
          branches: r.branches,
          share: round(share),
          share_1y_ago: s1 === null ? null : round(s1),
          share_5y_ago: s5 === null ? null : round(s5),
          change_1y_pp: s1 === null ? null : round(share - s1),
          change_5y_pp: s5 === null ? null : round(share - s5),
          deposits_1y_ago: totals.has(endYear - 1) ? certYear.get(`${endYear - 1}:${r.cert}`)?.deposits ?? 0 : null,
          deposits_5y_ago: totals.has(endYear - 5) ? certYear.get(`${endYear - 5}:${r.cert}`)?.deposits ?? 0 : null,
          rank: 0,
        };
      })
      .sort((a, b) => b.deposits - a.deposits || a.cert - b.cert);
    rowsOut.forEach((r, i) => (r.rank = i + 1));
    out.push({
      market,
      year: endYear,
      total_deposits: total,
      institutions: rowsOut.length,
      total_deposits_1y_ago: totals.get(endYear - 1) ?? null,
      total_deposits_5y_ago: totals.get(endYear - 5) ?? null,
      blank_deposit_offices: blank,
      rows: rowsOut,
    });
  }
  return out.sort((a, b) => b.total_deposits - a.total_deposits);
}

async function latestSodYear(): Promise<number | null> {
  const [row] = await sql<Array<{ y: number | null }>>`SELECT MAX(year)::int AS y FROM institution_branch_deposits`;
  return row?.y ?? null;
}

async function sodRows(geo: MarketGeo, markets: number[], endYear: number): Promise<SodRow[]> {
  const years = [endYear, endYear - 1, endYear - 5];
  const rows =
    geo === "county"
      ? await sql<Array<SodRow>>`
          SELECT b.year::int AS year, b.county_fips::int AS market, b.cert::int AS cert, MAX(b.institution_id)::int AS institution_id,
                 SUM(b.deposits)::float8 AS deposits, COUNT(*)::int AS branches
            FROM institution_branch_deposits b
           WHERE b.year = ANY(${years}::int[]) AND b.county_fips = ANY(${markets}::int[])
           GROUP BY 1, 2, 3, (b.deposits IS NULL)
        `
      : await sql<Array<SodRow>>`
          SELECT b.year::int AS year, b.msa_code::int AS market, b.cert::int AS cert, MAX(b.institution_id)::int AS institution_id,
                 SUM(b.deposits)::float8 AS deposits, COUNT(*)::int AS branches
            FROM institution_branch_deposits b
           WHERE b.year = ANY(${years}::int[]) AND b.msa_code = ANY(${markets}::int[])
           GROUP BY 1, 2, 3, (b.deposits IS NULL)
        `;
  return [...rows].map((r) => ({ ...r, deposits: r.deposits === null ? null : Number(r.deposits), institution_id: r.institution_id === null ? null : Number(r.institution_id) }));
}

/** Pure: county codes as the table stores them (integer STCNTYBR); malformed codes dropped. */
export function marketCodes(codes: Array<number | string>): number[] {
  return [...new Set(codes.map((c) => Number(String(c).trim())).filter((c) => Number.isInteger(c) && c > 0 && c < 100_000))];
}

export interface DepositShareOptions {
  geo: MarketGeo;
  /** County FIPS (5-digit) or metro codes. */
  markets: Array<number | string>;
  /** SOD year to measure to; defaults to the newest loaded. */
  endYear?: number;
}

/** Share and 1- and 5-year share change for every cert in the given markets, with names and acquisition counts. */
export async function getDepositShareChange(options: DepositShareOptions) {
  const markets = marketCodes(options.markets);
  const endYear = options.endYear ?? (await latestSodYear());
  if (markets.length === 0 || !endYear) return { year: endYear, markets: [] as Array<MarketShareSummary & { rows: Array<ShareChangeRow & { name: string | null; acquisitions_in_window: number }> }> };
  const summaries = computeShareChanges(await sodRows(options.geo, markets, endYear), endYear);
  const certs = [...new Set(summaries.flatMap((s) => s.rows.map((r) => r.cert)))];
  const ids = [...new Set(summaries.flatMap((s) => s.rows.map((r) => r.institution_id)).filter((id): id is number => id !== null))];
  const names = new Map<number, string>();
  const acquisitions = new Map<string, number>();
  if (ids.length > 0) {
    for (const r of await sql<Array<{ id: number; institution_name: string }>>`SELECT id, institution_name FROM institution_sources WHERE id = ANY(${ids}::bigint[])`) {
      names.set(Number(r.id), r.institution_name);
    }
  }
  if (certs.length > 0) {
    // FDIC sources only: NCUA lists put credit union charter numbers in acquirer_cert.
    const rows = await sql<Array<{ acquirer_cert: string; events: number }>>`
      SELECT ltrim(acquirer_cert, '0') AS acquirer_cert, COUNT(DISTINCT event_key)::int AS events
        FROM institution_structure_events
       WHERE source IN ('fdic-history', 'fdic-failures')
         AND ltrim(acquirer_cert, '0') = ANY(${certs.map(String)}::text[])
         AND effective_date > make_date(${endYear - 5}, 6, 30) AND effective_date <= make_date(${endYear}, 6, 30)
       GROUP BY 1
    `;
    for (const r of rows) acquisitions.set(String(Number(r.acquirer_cert)), Number(r.events));
  }
  return {
    year: endYear,
    markets: summaries.map((s) => ({
      ...s,
      rows: s.rows.map((r) => ({ ...r, name: r.institution_id === null ? null : names.get(r.institution_id) ?? null, acquisitions_in_window: acquisitions.get(String(r.cert)) ?? 0 })),
    })),
  };
}
