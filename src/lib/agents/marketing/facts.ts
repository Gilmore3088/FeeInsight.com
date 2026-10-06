import type { sql } from "@/lib/data-store/connection";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { STATE_NAMES } from "@/lib/us-states";

type SqlTag = typeof sql;

/**
 * The only numbers a marketing email may use. Everything comes from live tables:
 * national figures from `fee_index_cache` (what the public national report shows), and
 * charter and state splits from `published_fee_catalog`, one value per institution (its
 * highest published amount for the fee, so a tiered fee counts once at its top tier).
 */

export interface FeeStat {
  key: string;
  median: number;
  p25: number;
  p75: number;
  institutions: number;
}

export interface FactBundle {
  month: string;
  asOf: string;
  liveInstitutions: number;
  liveFees: number;
  national: FeeStat[];
  previousNational: FeeStat[] | null;
  byCharter: Array<{ key: string; bank: FeeStat | null; creditUnion: FeeStat | null }>;
  state: { code: string; name: string; fees: FeeStat[] } | null;
}

/** A charter or state figure needs this many institutions behind it. */
export const MIN_INSTITUTIONS_FOR_SPLIT = 20;

const num = (value: unknown) => Number(value ?? 0);

export async function readNational(db: SqlTag): Promise<FeeStat[]> {
  const rows = await db`
    SELECT fee_category, median_amount, p25_amount, p75_amount, institution_count
      FROM fee_index_cache
     WHERE fee_category = ANY(${[...HEADLINE_FEE_KEYS]})
       AND median_amount IS NOT NULL
     ORDER BY institution_count DESC`;
  return rows.map((row) => ({
    key: String(row.fee_category),
    median: num(row.median_amount),
    p25: num(row.p25_amount),
    p75: num(row.p75_amount),
    institutions: num(row.institution_count),
  }));
}

async function readSplit(db: SqlTag, column: "charter" | "state", stateCode?: string) {
  const rows = await db`
    WITH per AS (
      SELECT ef.fee_category, ef.institution_id, ct.charter_type, ct.state_code, MAX(ef.amount) AS amount
        FROM published_fee_catalog ef
        JOIN institution_sources ct ON ct.id = ef.institution_id
       WHERE ef.fee_category = ANY(${[...HEADLINE_FEE_KEYS]})
         AND ef.amount IS NOT NULL
         AND (${stateCode ?? null}::text IS NULL OR ct.state_code = ${stateCode ?? null})
       GROUP BY 1, 2, 3, 4
    )
    SELECT fee_category,
           CASE WHEN ${column} = 'charter' THEN charter_type ELSE state_code END AS bucket,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS median,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY amount) AS p25,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY amount) AS p75,
           COUNT(*) AS institutions
      FROM per
     GROUP BY 1, 2
    HAVING COUNT(*) >= ${MIN_INSTITUTIONS_FOR_SPLIT}`;
  return rows.map((row) => ({
    bucket: String(row.bucket ?? ""),
    stat: {
      key: String(row.fee_category),
      median: Math.round(num(row.median) * 100) / 100,
      p25: Math.round(num(row.p25) * 100) / 100,
      p75: Math.round(num(row.p75) * 100) / 100,
      institutions: num(row.institutions),
    } satisfies FeeStat,
  }));
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
  { month, previousNational, stateCode }: { month: string; previousNational: FeeStat[] | null; stateCode: string | null },
): Promise<FactBundle> {
  const [national, charterRows, stateRows, [totals]] = await Promise.all([
    readNational(db),
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
    previousNational,
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
  bundle.previousNational?.forEach(addStat);
  bundle.byCharter.forEach((row) => { addStat(row.bank); addStat(row.creditUnion); });
  bundle.state?.fees.forEach(addStat);
  [bundle.liveInstitutions, bundle.liveFees].forEach(add);
  // Differences between this month and last, and between banks and credit unions.
  for (const fee of bundle.national) {
    const before = bundle.previousNational?.find((row) => row.key === fee.key);
    if (before) add(Math.abs(fee.median - before.median));
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
