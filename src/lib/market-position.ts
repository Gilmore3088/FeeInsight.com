/**
 * Pure calculations behind the institution profile's market position section: deposit share,
 * rank and branch count in a metro from FDIC Summary of Deposits sums, per year. The reader
 * (src/lib/data-store/market-position.ts) supplies the rows; nothing here touches the database.
 *
 * Definitions, so every figure can be traced back:
 *   - A metro is the FDIC's MSA code on each office (MSABR) in that year's survey.
 *   - An institution is one matched institution (institution_id), or an unmatched FDIC
 *     certificate on its own. Offices with a blank deposit figure count as offices only.
 *   - Share = its deposits in the metro / all SOD deposits in the metro that year. The SOD covers
 *     FDIC-insured offices only, so credit unions are never part of the total.
 *   - Rank is by deposits among the institutions listed (an excluded name is left out of the
 *     ranks and counts; its deposits stay in the metro total, so every share is still of all
 *     bank deposits there).
 */

/** Never shown on any list, count, chart or map (owner's rule, see district-hub.ts). */
export const EXCLUDED_NAME = /frost bank/i;

export function isExcludedName(name: string | null | undefined): boolean {
  return Boolean(name && EXCLUDED_NAME.test(name));
}

export interface CertYearRow {
  year: number;
  cert: number;
  institution_id: number | null;
  /** Thousands of dollars. */
  deposits: number;
  branches: number;
}

export interface ShareEntry {
  /** institution_id when matched; null for an unmatched certificate. */
  id: number | null;
  name: string | null;
  sharePct: number;
  branches: number;
  /** Thousands of dollars. */
  deposits: number;
  rank: number;
  subject: boolean;
}

export interface YearShares {
  year: number;
  /** All SOD deposits in the metro that year, thousands of dollars. */
  totalDeposits: number;
  /** Institutions ranked (excluded names left out). */
  institutions: number;
  entries: ShareEntry[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Every year's shares and ranks in one metro, oldest year first. */
export function sharesByYear(rows: CertYearRow[], subjectId: number, names: Map<number, string>): YearShares[] {
  const years = new Map<number, Map<string, { id: number | null; deposits: number; branches: number }>>();
  const totals = new Map<number, number>();
  for (const r of rows) {
    totals.set(r.year, (totals.get(r.year) ?? 0) + r.deposits);
    const key = r.institution_id !== null ? `i${r.institution_id}` : `c${r.cert}`;
    const byKey = years.get(r.year) ?? new Map();
    const prior = byKey.get(key) ?? { id: r.institution_id, deposits: 0, branches: 0 };
    prior.deposits += r.deposits;
    prior.branches += r.branches;
    byKey.set(key, prior);
    years.set(r.year, byKey);
  }
  const out: YearShares[] = [];
  for (const [year, byKey] of years) {
    const total = totals.get(year) ?? 0;
    if (total <= 0) continue;
    const entries = [...byKey.values()]
      .map((e) => ({ ...e, name: e.id === null ? null : names.get(e.id) ?? null }))
      .filter((e) => !isExcludedName(e.name))
      .sort((a, b) => b.deposits - a.deposits || (a.id ?? 0) - (b.id ?? 0))
      .map((e, i) => ({
        id: e.id,
        name: e.name,
        sharePct: round1((e.deposits / total) * 100),
        branches: e.branches,
        deposits: e.deposits,
        rank: i + 1,
        subject: e.id === subjectId,
      }));
    out.push({ year, totalDeposits: total, institutions: entries.length, entries });
  }
  return out.sort((a, b) => a.year - b.year);
}

export interface HistoryPoint {
  year: number;
  sharePct: number;
  branches: number;
  rank: number;
  institutions: number;
}

/** The subject's share, offices and rank in each year it had offices in the metro. */
export function subjectHistory(years: YearShares[]): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const y of years) {
    const own = y.entries.find((e) => e.subject);
    if (!own) continue;
    out.push({ year: y.year, sharePct: own.sharePct, branches: own.branches, rank: own.rank, institutions: y.institutions });
  }
  return out;
}

/**
 * The largest named institutions for the bar chart, the subject always among them: the top
 * `limit` named rows, with the subject appended when it ranks below them.
 */
export function topShares(year: YearShares, limit: number): ShareEntry[] {
  const named = year.entries.filter((e) => e.name);
  const top = named.slice(0, limit);
  const own = named.find((e) => e.subject);
  if (own && !top.includes(own)) top.push(own);
  return top;
}

/** Asset bands for the map toggles; `asset_size` is stored in thousands of dollars. */
export const ASSET_BANDS = ["Under $1B", "$1B to $10B", "$10B to $100B", "Over $100B"] as const;

export function assetBandIndex(assetSizeThousands: number | null | undefined): number {
  if (assetSizeThousands == null || !Number.isFinite(assetSizeThousands) || assetSizeThousands <= 0) return -1;
  const dollars = assetSizeThousands * 1_000;
  if (dollars < 1e9) return 0;
  if (dollars < 1e10) return 1;
  if (dollars < 1e11) return 2;
  return 3;
}
