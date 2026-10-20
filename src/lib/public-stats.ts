import { cache } from "react";
import { sql } from "@/lib/data-store/connection";
import { getFeeCategorySummaries, type FeeCategorySummary } from "@/lib/data-store/fees";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";
import { FEE_FAMILIES, getFeeFamily, onlyPublicFeeTypes, publicFeeTypes } from "@/lib/fee-taxonomy";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { maturityTier } from "@/lib/data-store/maturity";
import { US_STATES_ONLY, VALID_US_CODES } from "@/lib/us-states";
import { publicCategoryCount } from "@/lib/headline-counts";
import { activeInstitutionFilter } from "@/lib/data-store/fee-stats";

/**
 * Single source of truth for every public-facing headline number.
 * Pages must render these strings instead of hand-typing counts.
 */
export interface PublicStatsSummary {
  /** Institutions with at least one verified (approved) fee. */
  institutions: number;
  institutionsLabel: string;
  /** Institutions the index monitors (all charters, all states). */
  monitored: number;
  monitoredLabel: string;
  /** Verified fee observations. */
  observations: number;
  observationsLabel: string;
  /**
   * Fee categories the public site covers: the public top-50 taxonomy types with at least one
   * counted institution (headline-counts.ts publicCategoryCount, set on read by getPublicSnapshot).
   */
  categories: number;
  categoriesLabel: string;
  /** U.S. states (50) with at least one verified fee; DC and territories are excluded from this figure. */
  states: number;
  statesLabel: string;
  /** Absolute date, e.g. "Aug 12, 2026", or null when unknown. */
  refreshedOn: string | null;
  /** "Data refreshed Aug 12, 2026" or "Data refresh pending". */
  freshnessLabel: string;
  /** False when any count failed to read; its label then shows UNAVAILABLE_LABEL, never "0". */
  complete: boolean;
}

// The coverage labels live in a pure module so a client component can read them (#1483).
export { COVERAGE_LABELS } from "@/lib/coverage-labels";

/** Shown in place of a count whose read failed, so a failed read never renders as a real 0. */
export const UNAVAILABLE_LABEL = "—";

/**
 * The summary a page shows when the counts could not be read in time (#1988): every label is
 * UNAVAILABLE_LABEL, never "0", and `complete` is false so callers can shorten the cache life.
 */
export const UNAVAILABLE_PUBLIC_STATS: PublicStatsSummary = {
  institutions: 0,
  institutionsLabel: UNAVAILABLE_LABEL,
  monitored: 0,
  monitoredLabel: UNAVAILABLE_LABEL,
  observations: 0,
  observationsLabel: UNAVAILABLE_LABEL,
  categories: 0,
  categoriesLabel: UNAVAILABLE_LABEL,
  states: 0,
  statesLabel: UNAVAILABLE_LABEL,
  refreshedOn: null,
  freshnessLabel: "Data refresh pending",
  complete: false,
};

const NUMBER = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return NUMBER.format(Math.max(0, Math.round(n)));
}

/** Label for a count that is null when its read failed. */
export function formatCountOrUnavailable(n: number | null): string {
  return n === null ? UNAVAILABLE_LABEL : formatCount(n);
}

/** Log a failed headline read so it shows up in the server logs instead of passing silently. */
function logFailedRead(name: string, error: unknown): null {
  console.error(`[public-stats] ${name} read failed; showing it as unavailable`, error);
  return null;
}

export function formatAbsoluteDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // A calendar date (a "YYYY-MM-DD" string, or a date column read as UTC midnight) keeps its own day.
  // Any other timestamp is dated in U.S. Eastern, so a fee published on a U.S. evening is never dated
  // tomorrow (the server runs on UTC).
  const calendarDate =
    (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) ||
    (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: calendarDate ? "UTC" : "America/New_York",
  });
}

export function formatFreshness(value: string | Date | null | undefined): string {
  const date = formatAbsoluteDate(value);
  return date ? `Data refreshed ${date}` : "Data refresh pending";
}

const CANONICAL_CATEGORIES = new Set(Object.values(FEE_FAMILIES).flat());

interface HeadlineCounts {
  /** Distinct verified observations at institutions in a U.S. state, DC or territory. */
  observations: number;
  /** Institutions there with at least one verified fee. */
  institutions: number;
  /** Canonical taxonomy categories with verified data. */
  categories: number;
  /** The 50 states with at least one verified fee. */
  states: number;
  /** When the newest published fee was approved: the only date the site calls an update. */
  lastFeeAt: string | null;
}

/**
 * Every headline count from one read of the catalog. The catalog is a view that rebuilds
 * its depth check on each reference, so the five separate reads this replaces (counts,
 * categories, states, newest fee, row count) cost about 2.9 s together on Oct 9; this one
 * reads it once. Null when the read fails, so the snapshot shows the counts as unavailable
 * and is not cached.
 */
async function readHeadlineCounts(): Promise<HeadlineCounts | null> {
  try {
    const [row] = await sql<{
      observations: number | string;
      institutions: number | string;
      categories: string[] | null;
      states: string[] | null;
      last_fee_at: string | Date | null;
    }[]>`
      WITH approved AS MATERIALIZED (
        SELECT ef.institution_id, ef.fee_name, ef.amount, ef.frequency, ef.variant_type,
               ef.fee_category, ef.created_at, ct.state_code
        FROM published_fee_catalog ef
        JOIN institution_sources ct ON ct.id = ef.institution_id
        WHERE ef.review_status = 'approved'
          AND ${sql.unsafe(activeInstitutionFilter("ct"))}
      ),
      us AS (
        SELECT * FROM approved WHERE state_code IN ${sql([...VALID_US_CODES])}
      )
      SELECT
        (SELECT COUNT(DISTINCT (institution_id, fee_name, amount,
           COALESCE(frequency, ''), COALESCE(variant_type, ''))) FROM us) AS observations,
        (SELECT COUNT(DISTINCT institution_id) FROM us) AS institutions,
        ARRAY(SELECT DISTINCT fee_category FROM approved WHERE fee_category IS NOT NULL) AS categories,
        ARRAY(SELECT DISTINCT state_code FROM approved WHERE state_code IS NOT NULL) AS states,
        (SELECT MAX(created_at) FROM approved) AS last_fee_at`;
    const iso = (v: string | Date | null): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
    return {
      observations: Number(row.observations),
      institutions: Number(row.institutions),
      categories: (row.categories ?? []).filter((category) => CANONICAL_CATEGORIES.has(category)).length,
      states: (row.states ?? []).filter((code) => US_STATES_ONLY.has(code)).length,
      lastFeeAt: iso(row.last_fee_at),
    };
  } catch (error) {
    return logFailedRead("headline counts", error);
  }
}

/**
 * Institutions monitored nationally: every institution the regulator has not marked inactive,
 * the rule each state's "headquartered" total uses (activeInstitutionFilter), so the states add up
 * to this figure (#1980).
 */
async function countMonitoredInstitutions(): Promise<number | null> {
  try {
    const [row] = await sql<{ cnt: number }[]>`
      SELECT COUNT(*) as cnt FROM institution_sources ct WHERE ${sql.unsafe(activeInstitutionFilter("ct"))}`;
    return Number(row?.cnt ?? 0);
  } catch (error) {
    return logFailedRead("monitored", error);
  }
}

async function computePublicStatsSummary(): Promise<PublicStatsSummary> {
  const [counts, monitored] = await Promise.all([readHeadlineCounts(), countMonitoredInstitutions()]);
  // Only a published fee dates the data. A crawl publishes nothing, so with no fee date the
  // date stays unknown ("Data refresh pending") rather than showing a crawl as an update (#1811).
  const refreshedOn = formatAbsoluteDate(counts?.lastFeeAt ?? null);
  // The catalog is never really empty: zero institutions means the read went wrong.
  const institutions = counts && counts.institutions > 0 ? counts.institutions : null;
  if (counts && institutions === null) logFailedRead("institutions", "headline counts returned 0 institutions");
  const categories = counts?.categories ?? null;
  const states = counts?.states ?? null;
  return {
    institutions: institutions ?? 0,
    institutionsLabel: formatCountOrUnavailable(institutions),
    monitored: monitored ?? 0,
    monitoredLabel: formatCountOrUnavailable(monitored),
    observations: counts?.observations ?? 0,
    observationsLabel: formatCountOrUnavailable(institutions === null ? null : (counts?.observations ?? null)),
    categories: categories ?? 0,
    categoriesLabel: formatCountOrUnavailable(categories),
    states: states ?? 0,
    statesLabel: formatCountOrUnavailable(states),
    refreshedOn,
    freshnessLabel: refreshedOn ? `Data refreshed ${refreshedOn}` : "Data refresh pending",
    complete: institutions !== null && monitored !== null && categories !== null && states !== null,
  };
}

/**
 * Everything the public site states as a national figure, computed together.
 *
 * The headline counts and the per-category benchmarks used to sit in separate cache
 * entries with different lifetimes (hourly counts, per-publish summaries, the
 * fee_index_cache memo), so the homepage, fee index and research hub could each show
 * a different moment of a catalog that changes every few minutes. One entry means
 * every public page reads the same moment, and `refreshedOn` dates it.
 */
export interface PublicSnapshot {
  summary: PublicStatsSummary;
  /** National benchmark per category, under the statistics contract (fee-stats.ts). */
  categories: FeeCategorySummary[];
}

async function readCategorySummaries(): Promise<FeeCategorySummary[]> {
  try {
    return await getFeeCategorySummaries();
  } catch (error) {
    console.error("[public-stats] category summaries read failed; benchmarks hidden", error);
    return [];
  }
}

async function computePublicSnapshot(): Promise<PublicSnapshot> {
  const [summary, categories] = await Promise.all([computePublicStatsSummary(), readCategorySummaries()]);
  return { summary, categories };
}

/**
 * Cached between Hamilton publishes on the hourly public ceiling (takedowns invalidate
 * it early). A snapshot with any failed read is never cached, so one failed read cannot
 * pin a blank number on the homepage for the whole ceiling.
 */
const cachedPublicSnapshot = cachedPublicRead(
  "public-snapshot",
  computePublicSnapshot,
  (snapshot) => !snapshot.summary.complete || snapshot.categories.length === 0,
);

/**
 * The taxonomy may hold 52 fee types; public pages publish only the top 50 by institution count
 * (James, Oct 17 2026; `publicFeeTypes`). Applied on read, so a snapshot cached before the rule
 * reads the same way.
 */
export const getPublicSnapshot = cache(async (): Promise<PublicSnapshot> => {
  const snapshot = await cachedPublicSnapshot();
  return { summary: withPublicCategoryCount(snapshot), categories: onlyPublicFeeTypes(snapshot.categories) };
});

/**
 * The summary with its category count set to the public one (headline-counts.ts
 * publicCategoryCount): the top-50 types with a counted institution, the number /fees lists.
 * The raw count read every taxonomy type with an approved row, so /research and /api-docs said
 * 52 while the homepage and /fees said 50 (#1951). Applied on read, like the top-50 rule, so a
 * snapshot cached before this change reads the same way. A failed read stays unavailable.
 */
export function withPublicCategoryCount(snapshot: PublicSnapshot): PublicStatsSummary {
  const { summary } = snapshot;
  if (summary.categoriesLabel === UNAVAILABLE_LABEL) return summary;
  const categories = publicCategoryCount(snapshot.categories);
  return {
    ...summary,
    categories: categories ?? 0,
    categoriesLabel: formatCountOrUnavailable(categories),
    complete: summary.complete && categories !== null,
  };
}

/** The fee types public pages may list (at most 50), ranked on the shared snapshot's institution counts. */
export const getPublicFeeTypes = cache(async (): Promise<Set<string>> => publicFeeTypes((await cachedPublicSnapshot()).categories));

/** Headline counts from the shared snapshot. */
export const getPublicStatsSummary = cache(async (): Promise<PublicStatsSummary> => (await getPublicSnapshot()).summary);

/** National category benchmarks from the shared snapshot: the same moment as the counts. */
export const getPublicCategorySummaries = cache(
  async (): Promise<FeeCategorySummary[]> => (await getPublicSnapshot()).categories,
);

/**
 * The national index (canonical categories) in IndexEntry shape, built from the shared
 * snapshot, for public pages that compare against national medians. Same figures as
 * the fee index; admin and Pro keep reading fee_index_cache directly.
 */
export const getPublicNationalIndex = cache(async (): Promise<IndexEntry[]> =>
  nationalIndexEntries(await getPublicCategorySummaries()),
);

/**
 * The public national index plus every fee in `keys`, read from the same snapshot even when a
 * key ranks outside the public top 50. The U.S. benchmark report reads it so none of its 15
 * headline fees silently drops off the report because the top-50 rule left it out (#1955).
 */
export const getPublicNationalIndexWith = cache(async (keys: readonly string[]): Promise<IndexEntry[]> => {
  const snapshot = await cachedPublicSnapshot();
  return nationalIndexEntries(withRequiredFees(onlyPublicFeeTypes(snapshot.categories), snapshot.categories, keys));
});

/**
 * The public rows, plus each row of `all` whose fee is in `keys` and missing from the public
 * rows, in the order of `all`. Pure, so the benchmark's every-headline-fee rule is tested.
 */
export function withRequiredFees<T extends { fee_category: string }>(publicRows: T[], all: T[], keys: readonly string[]): T[] {
  const have = new Set(publicRows.map((r) => r.fee_category));
  const required = new Set(keys);
  const added = all.filter((r) => required.has(r.fee_category) && !have.has(r.fee_category));
  return added.length === 0 ? publicRows : [...publicRows, ...added];
}

/** Snapshot category rows in IndexEntry shape (canonical categories only). */
export function nationalIndexEntries(categories: FeeCategorySummary[]): IndexEntry[] {
  return categories
    .filter((c) => CANONICAL_CATEGORIES.has(c.fee_category))
    .map((c) => ({
      fee_category: c.fee_category,
      fee_family: getFeeFamily(c.fee_category),
      median_amount: c.median_amount,
      p25_amount: c.p25_amount,
      p75_amount: c.p75_amount,
      min_amount: c.min_amount,
      max_amount: c.max_amount,
      institution_count: c.institution_count,
      observation_count: c.total_observations,
      approved_count: c.total_observations,
      bank_count: c.bank_count,
      cu_count: c.cu_count,
      // A null median means the sample was below the minimum; mark it so callers skip it.
      maturity_tier: c.median_amount === null ? "insufficient" : maturityTier(c.institution_count),
      last_updated: null,
    }));
}

/**
 * What a benchmark measures, for the line beside it:
 * "Median $30 · 798 institutions · 945 published fee entries · updated Oct 5, 2026".
 */
export function benchmarkBasis(
  category: Pick<FeeCategorySummary, "median_amount" | "institution_count" | "total_observations">,
  refreshedOn: string | null,
): string {
  const parts: string[] = [];
  if (category.median_amount !== null) parts.push(`Median ${formatMoney(category.median_amount)}`);
  parts.push(`${formatCount(category.institution_count)} ${category.institution_count === 1 ? "institution" : "institutions"}`);
  parts.push(
    `${formatCount(category.total_observations)} published fee ${category.total_observations === 1 ? "entry" : "entries"}`,
  );
  if (refreshedOn) parts.push(`updated ${refreshedOn}`);
  return parts.join(" · ");
}

function formatMoney(value: number): string {
  const n = Math.round(value * 100) / 100;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}
