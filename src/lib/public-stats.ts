import { cache } from "react";
import { getDataFreshness, getPublicStats } from "@/lib/data-store/core";
import { sql } from "@/lib/data-store/connection";
import { getFeeCategorySummaries, type FeeCategorySummary } from "@/lib/data-store/fees";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";
import { FEE_FAMILIES, getFeeFamily } from "@/lib/fee-taxonomy";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { maturityTier } from "@/lib/data-store/maturity";
import { US_STATES_ONLY } from "@/lib/us-states";

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

async function countCanonicalCategoriesWithData(): Promise<number | null> {
  try {
    const rows = await sql<{ fee_category: string }[]>`
      SELECT DISTINCT fee_category FROM published_fee_catalog
      WHERE review_status = 'approved' AND fee_category IS NOT NULL`;
    return rows.filter((r) => CANONICAL_CATEGORIES.has(r.fee_category)).length;
  } catch (error) {
    return logFailedRead("categories", error);
  }
}

async function countStatesWithVerifiedFees(): Promise<number | null> {
  try {
    const rows = await sql<{ state_code: string }[]>`
      SELECT DISTINCT ct.state_code FROM institution_sources ct
      JOIN published_fee_catalog ef ON ef.institution_id = ct.id
      WHERE ef.review_status = 'approved' AND ct.state_code IS NOT NULL`;
    return rows.filter((r) => US_STATES_ONLY.has(r.state_code)).length;
  } catch (error) {
    return logFailedRead("states", error);
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
  const [stats, freshness, monitored, categories, states] = await Promise.all([
    getPublicStats(),
    getDataFreshness().catch(() => null),
    countMonitoredInstitutions(),
    countCanonicalCategoriesWithData(),
    countStatesWithVerifiedFees(),
  ]);
  const refreshedOn = formatAbsoluteDate(freshness?.last_fee_extracted_at ?? freshness?.last_crawl_at ?? null);
  // getPublicStats returns zeros when its read fails; the catalog is never really empty.
  const institutions = stats.total_institutions > 0 ? stats.total_institutions : null;
  if (institutions === null) logFailedRead("institutions", "getPublicStats returned 0 institutions");
  return {
    institutions: institutions ?? 0,
    institutionsLabel: formatCountOrUnavailable(institutions),
    monitored: monitored ?? 0,
    monitoredLabel: formatCountOrUnavailable(monitored),
    observations: stats.total_observations,
    observationsLabel: formatCountOrUnavailable(institutions === null ? null : stats.total_observations),
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
