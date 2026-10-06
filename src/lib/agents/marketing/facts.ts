import type { sql } from "@/lib/data-store/connection";
import { getNationalIndexCached } from "@/lib/data-store/fee-index";
import { STATS_ROW_FILTER, summarizeFeesBy } from "@/lib/data-store/fee-stats";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { STATE_NAMES } from "@/lib/us-states";

type SqlTag = typeof sql;

/**
 * The only numbers a marketing email may use. National figures come from
 * `getNationalIndexCached` (what the public National report shows); charter and state
 * splits come from `published_fee_catalog` under the same statistics contract
 * (`fee-stats.ts`), so every median in an email matches the site.
 */

export interface FeeStat {
  key: string;
  median: number;
  p25: number;
  p75: number;
  institutions: number;
}

export interface CoverageStat {
  key: string;
  institutions: number;
}

export interface FactBundle {
  month: string;
  asOf: string;
  liveInstitutions: number;
  liveFees: number;
  national: FeeStat[];
  /**
   * Institutions behind each national fee last month. Coverage only: a median that differs
   * from last month mostly reflects which institutions were added, not a price move, so last
   * month's medians are never given to the writer.
   */
  previousCoverage: CoverageStat[] | null;
  byCharter: Array<{ key: string; bank: FeeStat | null; creditUnion: FeeStat | null }>;
  state: { code: string; name: string; fees: FeeStat[] } | null;
}

/** A charter or state figure needs this many institutions behind it. */
export const MIN_INSTITUTIONS_FOR_SPLIT = 20;

const num = (value: unknown) => Number(value ?? 0);
const HEADLINE_KEYS: ReadonlySet<string> = new Set(HEADLINE_FEE_KEYS);

/** National headline fees exactly as the public National report shows them (cache, freshness and method checks included). */
export async function readNational(): Promise<FeeStat[]> {
  const index = await getNationalIndexCached();
  return index
    .filter((entry) => HEADLINE_KEYS.has(entry.fee_category) && entry.median_amount !== null)
    .map((entry) => ({
      key: entry.fee_category,
      median: num(entry.median_amount),
      p25: num(entry.p25_amount),
      p75: num(entry.p75_amount),
      institutions: num(entry.institution_count),
    }));
}

const round2 = (value: number | null) => Math.round(num(value) * 100) / 100;

/**
 * Charter or state splits under the site's statistics contract (fee-stats.ts): sourced rows
 * only, one value per institution (the median of its amounts, the highest tier for overdraft).
 */
async function readSplit(db: SqlTag, column: "charter" | "state", stateCode?: string, minInstitutions = MIN_INSTITUTIONS_FOR_SPLIT) {
  const rows = await db.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id, ct.charter_type, ct.state_code
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ct.id = ef.institution_id
      WHERE ef.fee_category = ANY($1::text[])
        AND ef.amount IS NOT NULL
        AND ${STATS_ROW_FILTER}
        AND ($2::text IS NULL OR ct.state_code = $2::text)`,
    [[...HEADLINE_FEE_KEYS], stateCode ?? null] as never[],
  ) as Array<{ fee_category: string; amount: number | string | null; institution_id: number; charter_type: string | null; state_code: string | null }>;
  const groups = summarizeFeesBy(rows, (row) => {
    const bucket = column === "charter" ? row.charter_type : row.state_code;
    return bucket ? `${row.fee_category}|${bucket}` : null;
  });
  const result: Array<{ bucket: string; stat: FeeStat }> = [];
  for (const [key, stats] of groups) {
    if (stats.institution_count < minInstitutions || stats.median_amount === null) continue;
    const [feeCategory, bucket] = key.split("|");
    result.push({
      bucket,
      stat: {
        key: feeCategory,
        median: round2(stats.median_amount),
        p25: round2(stats.p25_amount),
        p75: round2(stats.p75_amount),
        institutions: stats.institution_count,
      },
    });
  }
  return result;
}

/** One state's headline fees, one value per institution, each backed by `minInstitutions` or more. */
export async function readStateFees(db: SqlTag, stateCode: string, minInstitutions: number): Promise<FeeStat[]> {
  const rows = await readSplit(db, "state", stateCode, minInstitutions);
  return rows.map((row) => row.stat);
}

/** Live institution and fee counts, for the sources line under each table. */
export async function readTotals(db: SqlTag): Promise<{ institutions: number; fees: number }> {
  const [row] = await db`SELECT COUNT(DISTINCT institution_id) AS institutions, COUNT(*) AS fees FROM published_fee_catalog`;
  return { institutions: num(row?.institutions), fees: num(row?.fees) };
}

/** States with the most institutions publishing fees, best covered first. */
export async function readSpotlightStates(db: SqlTag, limit = 12): Promise<string[]> {
  const rows = await db`
    SELECT ct.state_code, COUNT(DISTINCT ef.institution_id) AS institutions
      FROM published_fee_catalog ef
      JOIN institution_sources ct ON ct.id = ef.institution_id
     WHERE ct.state_code IS NOT NULL
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT ${limit}`;
  return rows.map((row) => String(row.state_code));
}

/** Rotates through the best-covered states, one per month, skipping ones used recently. */
export function pickSpotlightState(states: string[], recentlyUsed: string[]): string | null {
  return states.find((code) => !recentlyUsed.includes(code)) ?? states[0] ?? null;
}

export async function buildFactBundle(
  db: SqlTag,
  { month, previousCoverage, stateCode }: { month: string; previousCoverage: CoverageStat[] | null; stateCode: string | null },
): Promise<FactBundle> {
  const [national, charterRows, stateRows, [totals]] = await Promise.all([
    readNational(),
    readSplit(db, "charter"),
    stateCode ? readSplit(db, "state", stateCode) : Promise.resolve([]),
    db`SELECT COUNT(DISTINCT institution_id) AS institutions, COUNT(*) AS fees FROM published_fee_catalog`,
  ]);
  const byCharter = national.map((fee) => ({
    key: fee.key,
    bank: charterRows.find((row) => row.bucket === "bank" && row.stat.key === fee.key)?.stat ?? null,
    creditUnion: charterRows.find((row) => row.bucket === "credit_union" && row.stat.key === fee.key)?.stat ?? null,
  }));
  return {
    month,
    asOf: new Date().toISOString().slice(0, 10),
    liveInstitutions: num(totals?.institutions),
    liveFees: num(totals?.fees),
    national,
    previousCoverage,
    byCharter,
    state: stateCode && stateRows.length
      ? { code: stateCode, name: STATE_NAMES[stateCode] ?? stateCode, fees: stateRows.map((row) => row.stat) }
      : null,
  };
}

/** Every number a reader could see in an email built from this bundle, as written text. */
export function allowedNumbers(bundle: FactBundle): Set<string> {
  const allowed = new Set<string>();
  const add = (value: number) => {
    const rounded = Math.round(value * 100) / 100;
    allowed.add(String(rounded));
    allowed.add(rounded.toFixed(2));
    allowed.add(rounded.toLocaleString("en-US"));
  };
  const addStat = (stat: FeeStat | null) => {
    if (!stat) return;
    [stat.median, stat.p25, stat.p75, stat.institutions].forEach(add);
  };
  bundle.national.forEach(addStat);
  bundle.previousCoverage?.forEach((row) => add(row.institutions));
  bundle.byCharter.forEach((row) => { addStat(row.bank); addStat(row.creditUnion); });
  bundle.state?.fees.forEach(addStat);
  [bundle.liveInstitutions, bundle.liveFees].forEach(add);
  // Institutions added since last month, and gaps between banks and credit unions.
  for (const fee of bundle.national) {
    const before = bundle.previousCoverage?.find((row) => row.key === fee.key);
    if (before) add(Math.abs(fee.institutions - before.institutions));
  }
  for (const row of bundle.byCharter) {
    if (row.bank && row.creditUnion) add(Math.abs(row.bank.median - row.creditUnion.median));
  }
  for (const fee of bundle.state?.fees ?? []) {
    const nat = bundle.national.find((row) => row.key === fee.key);
    if (nat) add(Math.abs(fee.median - nat.median));
  }
  // Structural numbers that carry no data claim.
  ["15", "14", "3", "2", "1", "25", "75", "50", "30", "60", "10", String(new Date().getFullYear())].forEach((n) => allowed.add(n));
  return allowed;
}

/** Numbers in `text` that the bundle cannot back up. An empty list means the copy is clean. */
export function unbackedNumbers(text: string, allowed: Set<string>): string[] {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return [...new Set(found.filter((raw) => {
    const plain = raw.replace(/,/g, "");
    return !allowed.has(raw) && !allowed.has(plain) && !allowed.has(String(Number(plain)));
  }))];
}
