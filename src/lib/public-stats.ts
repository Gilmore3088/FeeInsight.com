import { cache } from "react";
import { getDataFreshness, getPublicStats } from "@/lib/data-store/core";
import { sql } from "@/lib/data-store/connection";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
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
 * Cached between Hamilton publishes: this runs five catalog-wide aggregates and is read
 * by most public pages. A summary with any failed count is never cached, so one failed
 * read cannot pin a blank number on the homepage for the whole cache ceiling.
 */
const cachedPublicStatsSummary = cachedPublicRead(
  "public-stats-summary",
  computePublicStatsSummary,
  (summary) => !summary.complete,
);

export const getPublicStatsSummary = cache(cachedPublicStatsSummary);
