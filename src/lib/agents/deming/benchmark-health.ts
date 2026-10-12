import { sql } from "@/lib/data-store/connection";
import { STATS_METHOD_VERSION, STATS_ROW_FILTER, valuePerInstitution } from "@/lib/data-store/fee-stats";
import { latestFinishedStep } from "@/lib/data-store/agent-quality";
import { coverageTarget, SIZE_GROUPS, type SizeGroupKey } from "@/lib/agents/goal-scorecard";

/**
 * Deming's benchmark health check (#1064): the statistical checks in the fee-benchmarking
 * skill, run every day in Atlas's scoreboard run. Deterministic and read-only; no model calls.
 *
 * National benchmarks, per fee category: the institutions behind the median (one value per
 * institution, the statistics contract in fee-stats.ts) and the 95% range around the median by
 * order statistics. An alarm when a category's institution count falls sharply from the last
 * check: that would have caught the 2026-10-10 regression, when national medians fell to about
 * 60 institutions.
 *
 * State × size groups under $10B (James, 2026-10-12, #1028): covered institutions, coverage
 * share, whether the group meets its target, the fallback level a benchmark there would use
 * (the state group from 10 covered institutions, else the Fed district at the same size, else
 * the whole state), and a coverage-bias flag when the covered banks are clearly larger.
 */

type SqlTag = typeof sql;

export const BENCHMARK_HEALTH_VERSION = 1;
/** A benchmark shows from this many institutions… */
export const BENCHMARK_SHOW_FROM = 10;
/** …and is marked "limited sample" below this many. */
export const BENCHMARK_LIMITED_BELOW = 30;
/** An alarm when a category keeps less than this share of its institutions since the last check. */
export const COLLAPSE_KEEPS_BELOW = 0.7;
/** Covered banks are "clearly larger" when their median assets are this many times the uncovered ones'. */
export const BIAS_ASSET_RATIO = 2;

export interface CategoryHealth {
  category: string;
  institutions: number;
  median: number | null;
  /** 95% range around the median by order statistics; null below BENCHMARK_SHOW_FROM. */
  range: { low: number; high: number } | null;
  limitedSample: boolean;
}

export interface CategoryCollapse {
  category: string;
  before: number;
  now: number;
}

export type FallbackLevel = "state" | "district" | "state_all_sizes" | "none";

export interface GroupHealth {
  state: string;
  size: SizeGroupKey;
  total: number;
  covered: number;
  share: number | null;
  meetsTarget: boolean;
  fallback: FallbackLevel;
  /** Median assets (thousands) of covered and uncovered institutions. */
  coveredMedianAssets: number | null;
  uncoveredMedianAssets: number | null;
  biased: boolean;
}

export interface BenchmarkHealthResult {
  version: number;
  statsMethodVersion: number;
  categories: CategoryHealth[];
  collapses: CategoryCollapse[];
  /** The previous check the collapse test compared against; null on the first run. */
  comparedWith: string | null;
  groups: GroupHealth[];
  groupsMeetingTarget: number;
  groupsTotal: number;
  biasedGroups: number;
  fallbackCounts: Record<FallbackLevel, number>;
}

/** 1-based order statistics bounding a 95% range for the median of n values. */
export function medianRangeRanks(n: number): { low: number; high: number } | null {
  if (n < BENCHMARK_SHOW_FROM) return null;
  const spread = 0.98 * Math.sqrt(n);
  return { low: Math.max(1, Math.round(n / 2 - spread)), high: Math.min(n, Math.round(1 + n / 2 + spread)) };
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Pure: per-institution values per category into sample size, median and range. */
export function categoryHealth(category: string, values: number[]): CategoryHealth {
  const sorted = [...values].sort((a, b) => a - b);
  const ranks = medianRangeRanks(sorted.length);
  return {
    category,
    institutions: sorted.length,
    median: sorted.length >= BENCHMARK_SHOW_FROM ? median(sorted) : null,
    range: ranks ? { low: sorted[ranks.low - 1], high: sorted[ranks.high - 1] } : null,
    limitedSample: sorted.length < BENCHMARK_LIMITED_BELOW,
  };
}

/** Pure: categories whose institution count fell below COLLAPSE_KEEPS_BELOW of the last check. */
export function findCollapses(now: CategoryHealth[], before: Array<{ category: string; institutions: number }>): CategoryCollapse[] {
  const current = new Map(now.map((row) => [row.category, row.institutions]));
  return before
    .filter((row) => row.institutions >= BENCHMARK_SHOW_FROM)
    .map((row) => ({ category: row.category, before: row.institutions, now: current.get(row.category) ?? 0 }))
    .filter((row) => row.now < row.before * COLLAPSE_KEEPS_BELOW)
    .sort((a, b) => b.before - a.before || a.category.localeCompare(b.category));
}

export interface GroupInput {
  state: string;
  /** The Fed district most of the group's institutions are in. */
  district: number | null;
  size: SizeGroupKey;
  total: number;
  covered: number;
  coveredMedianAssets: number | null;
  uncoveredMedianAssets: number | null;
}

/** Pure: groups with their target, fallback level and bias flag. `districtCovered` keys are "district|size". */
export function groupHealth(rows: GroupInput[], districtCovered: Map<string, number>): GroupHealth[] {
  const stateAll = new Map<string, number>();
  for (const row of rows) stateAll.set(row.state, (stateAll.get(row.state) ?? 0) + row.covered);
  return rows
    .map((row) => {
      const fallback: FallbackLevel = row.covered >= BENCHMARK_SHOW_FROM ? "state"
        : row.district != null && (districtCovered.get(`${row.district}|${row.size}`) ?? 0) >= BENCHMARK_SHOW_FROM ? "district"
        : (stateAll.get(row.state) ?? 0) >= BENCHMARK_SHOW_FROM ? "state_all_sizes" : "none";
      const biased = row.coveredMedianAssets != null && row.uncoveredMedianAssets != null && row.uncoveredMedianAssets > 0
        && row.coveredMedianAssets >= row.uncoveredMedianAssets * BIAS_ASSET_RATIO;
      return {
        state: row.state,
        size: row.size,
        total: row.total,
        covered: row.covered,
        share: row.total > 0 ? Math.round((row.covered / row.total) * 10_000) / 10_000 : null,
        meetsTarget: row.total > 0 && row.covered >= coverageTarget(row.total),
        fallback,
        coveredMedianAssets: row.coveredMedianAssets,
        uncoveredMedianAssets: row.uncoveredMedianAssets,
        biased,
      };
    })
    .sort((a, b) => a.state.localeCompare(b.state) || a.size.localeCompare(b.size));
}

async function readCategoryValues(db: SqlTag): Promise<CategoryHealth[]> {
  const rows = await db<Array<{ fee_category: string; amount: number | string; institution_id: number | string }>>`
    SELECT ef.fee_category, ef.amount, ef.institution_id
      FROM published_fee_catalog ef
     WHERE ef.fee_category IS NOT NULL
       AND ef.review_status = 'approved'
       AND ${db.unsafe(STATS_ROW_FILTER)}
       AND ef.amount IS NOT NULL AND ef.amount >= 0
  `;
  type Row = (typeof rows)[number];
  const byCategory = new Map<string, Row[]>();
  for (const row of rows) {
    const list: Row[] = byCategory.get(row.fee_category) ?? [];
    list.push(row);
    byCategory.set(row.fee_category, list);
  }
  return [...byCategory.entries()]
    .map(([category, list]) => categoryHealth(category, [...valuePerInstitution(list.map((row) => ({ ...row, fee_category: category }))).values()]))
    .sort((a, b) => b.institutions - a.institutions || a.category.localeCompare(b.category));
}

async function readGroups(db: SqlTag): Promise<{ groups: GroupInput[]; districtCovered: Map<string, number> }> {
  const rows = await db<Array<{
    level: "state" | "district"; state_code: string | null; fed_district: number | string | null; size_group: SizeGroupKey;
    total: number | string; covered: number | string;
    covered_median: number | string | null; uncovered_median: number | string | null;
  }>>`
    WITH live AS (SELECT DISTINCT institution_id FROM published_fee_catalog),
    inst AS (
      SELECT btrim(i.state_code) AS state_code, i.fed_district, i.asset_size,
             CASE WHEN i.asset_size < ${SIZE_GROUPS[0].maxThousands} THEN ${SIZE_GROUPS[0].key}
                  WHEN i.asset_size < ${SIZE_GROUPS[1].maxThousands} THEN ${SIZE_GROUPS[1].key}
                  ELSE ${SIZE_GROUPS[2].key} END AS size_group,
             (live.institution_id IS NOT NULL) AS covered
        FROM institution_sources i
        LEFT JOIN live ON live.institution_id = i.id
       WHERE COALESCE(i.status, 'active') = 'active'
         AND NULLIF(btrim(i.state_code), '') IS NOT NULL
         AND i.asset_size IS NOT NULL
         AND i.asset_size < ${SIZE_GROUPS[2].maxThousands}
    )
    SELECT 'state' AS level, state_code, mode() WITHIN GROUP (ORDER BY fed_district) AS fed_district, size_group,
           COUNT(*)::int AS total,
           (COUNT(*) FILTER (WHERE covered))::int AS covered,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY asset_size) FILTER (WHERE covered) AS covered_median,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY asset_size) FILTER (WHERE NOT covered) AS uncovered_median
      FROM inst
     GROUP BY state_code, size_group
    UNION ALL
    SELECT 'district' AS level, NULL, fed_district, size_group,
           COUNT(*)::int, (COUNT(*) FILTER (WHERE covered))::int, NULL, NULL
      FROM inst
     WHERE fed_district IS NOT NULL
     GROUP BY fed_district, size_group
  `;
  const num = (value: unknown) => (value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value)));
  const districtCovered = new Map<string, number>();
  const groups: GroupInput[] = [];
  for (const row of rows) {
    if (row.level === "district") {
      districtCovered.set(`${Number(row.fed_district)}|${row.size_group}`, Number(row.covered));
      continue;
    }
    groups.push({
      state: String(row.state_code),
      district: row.fed_district == null ? null : Number(row.fed_district),
      size: row.size_group,
      total: Number(row.total),
      covered: Number(row.covered),
      coveredMedianAssets: num(row.covered_median),
      uncoveredMedianAssets: num(row.uncovered_median),
    });
  }
  return { groups, districtCovered };
}

/** The previous check's per-category counts, from its finished step. */
async function previousCounts(db: SqlTag): Promise<{ at: string; counts: Array<{ category: string; institutions: number }> } | null> {
  const step = await latestFinishedStep(db, "deming-benchmark-health");
  const categories = step?.detail?.categories;
  if (!step || !Array.isArray(categories)) return null;
  // A different statistics method is a different population: comparing would raise a false alarm.
  if (Number(step.detail?.stats_method_version) !== STATS_METHOD_VERSION) return null;
  return {
    at: step.at,
    counts: categories
      .map((row) => row as { category?: unknown; institutions?: unknown })
      .filter((row) => typeof row.category === "string" && Number.isFinite(Number(row.institutions)))
      .map((row) => ({ category: String(row.category), institutions: Number(row.institutions) })),
  };
}

export async function runBenchmarkHealth({ db = sql }: { db?: SqlTag } = {}): Promise<BenchmarkHealthResult> {
  const previous = await previousCounts(db).catch((error) => {
    console.error("Benchmark health: the previous check could not be read", error);
    return null;
  });
  const categories = await readCategoryValues(db);
  const read = await readGroups(db);
  const groups = groupHealth(read.groups, read.districtCovered);
  const fallbackCounts: Record<FallbackLevel, number> = { state: 0, district: 0, state_all_sizes: 0, none: 0 };
  for (const group of groups) fallbackCounts[group.fallback] += 1;
  return {
    version: BENCHMARK_HEALTH_VERSION,
    statsMethodVersion: STATS_METHOD_VERSION,
    categories,
    collapses: previous ? findCollapses(categories, previous.counts) : [],
    comparedWith: previous?.at ?? null,
    groups,
    groupsMeetingTarget: groups.filter((group) => group.meetsTarget).length,
    groupsTotal: groups.length,
    biasedGroups: groups.filter((group) => group.biased).length,
    fallbackCounts,
  };
}

export function summarizeBenchmarkHealth(result: BenchmarkHealthResult): string {
  const benchmarked = result.categories.filter((row) => row.institutions >= BENCHMARK_SHOW_FROM);
  const limited = benchmarked.filter((row) => row.limitedSample).length;
  const alarm = result.collapses.length === 0
    ? result.comparedWith ? "no benchmark lost a sharp share of its institutions since the last check" : "first check, nothing to compare"
    : `ALARM: ${result.collapses.slice(0, 4).map((row) => `${row.category} fell from ${row.before.toLocaleString("en-US")} to ${row.now.toLocaleString("en-US")} institutions`).join("; ")}`;
  return `Deming checked the benchmarks: ${benchmarked.length} categories have a national benchmark (${limited} on a limited sample); ${result.groupsMeetingTarget} of ${result.groupsTotal} state and size groups under $10B meet the coverage target, ${result.biasedGroups} lean to larger banks; ${alarm}.`;
}

export function benchmarkHealthDetail(result: BenchmarkHealthResult) {
  return {
    version: result.version,
    stats_method_version: result.statsMethodVersion,
    compared_with: result.comparedWith,
    collapses: result.collapses,
    categories: result.categories,
    groups_meeting_target: result.groupsMeetingTarget,
    groups_total: result.groupsTotal,
    biased_groups: result.biasedGroups,
    fallback_counts: result.fallbackCounts,
    groups: result.groups,
  };
}
