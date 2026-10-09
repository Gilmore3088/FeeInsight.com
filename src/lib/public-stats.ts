import { cache } from "react";
import { sql } from "@/lib/data-store/connection";
import { getFeeCategorySummaries, type FeeCategorySummary } from "@/lib/data-store/fees";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";
import { FEE_FAMILIES, getFeeFamily } from "@/lib/fee-taxonomy";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { maturityTier } from "@/lib/data-store/maturity";
import { US_STATES_ONLY, VALID_US_CODES } from "@/lib/us-states";

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
  /** Canonical taxonomy fee categories that have verified data (raw catalog labels outside the taxonomy are not counted). */
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

/**
 * One name per coverage count, used everywhere a count appears, so "institutions"
 * never means two different things on two pages.
 */
export const COVERAGE_LABELS = {
  monitored: "Institutions monitored",
  institutions: "Institutions with published fees",
  observations: "Published fee entries",
  categories: "Fee categories with published fees",
} as const;

/** Shown in place of a count whose read failed, so a failed read never renders as a real 0. */
export const UNAVAILABLE_LABEL = "—";

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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  lastFeeAt: string | null;
  lastCrawlAt: string | null;
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
      last_crawl_at: string | Date | null;
    }[]>`
      WITH approved AS MATERIALIZED (
        SELECT ef.institution_id, ef.fee_name, ef.amount, ef.frequency, ef.variant_type,
               ef.fee_category, ef.created_at, ct.state_code
        FROM published_fee_catalog ef
        JOIN institution_sources ct ON ct.id = ef.institution_id
        WHERE ef.review_status = 'approved'
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
        (SELECT MAX(created_at) FROM approved) AS last_fee_at,
        (SELECT MAX(crawled_at) FROM source_documents WHERE status = 'success') AS last_crawl_at`;
    const iso = (v: string | Date | null): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
    return {
      observations: Number(row.observations),
      institutions: Number(row.institutions),
      categories: (row.categories ?? []).filter((category) => CANONICAL_CATEGORIES.has(category)).length,
      states: (row.states ?? []).filter((code) => US_STATES_ONLY.has(code)).length,
      lastFeeAt: iso(row.last_fee_at),
      lastCrawlAt: iso(row.last_crawl_at),
    };
  } catch (error) {
    return logFailedRead("headline counts", error);
  }
}

async function countMonitoredInstitutions(): Promise<number | null> {
  try {
    const [row] = await sql<{ cnt: number }[]>`SELECT COUNT(*) as cnt FROM institution_sources`;
    return Number(row?.cnt ?? 0);
  } catch (error) {
    return logFailedRead("monitored", error);
  }
}

async function computePublicStatsSummary(): Promise<PublicStatsSummary> {
  const [counts, monitored] = await Promise.all([readHeadlineCounts(), countMonitoredInstitutions()]);
  const refreshedOn = formatAbsoluteDate(counts?.lastFeeAt ?? counts?.lastCrawlAt ?? null);
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

export const getPublicSnapshot = cache(cachedPublicSnapshot);

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
export const getPublicNationalIndex = cache(async (): Promise<IndexEntry[]> => {
  const categories = await getPublicCategorySummaries();
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
});

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
