/**
 * Sources struck or held under DECISIONS.md "No non-commercial data" (James, 2026-10-17). Rows
 * they loaded before then may still be on prod; no reader returns them.
 *
 * - Struck (loader removed): terms allow only non-commercial, personal or research use, or need
 *   written permission for commercial use.
 * - Held (loader kept, nothing scheduled): terms unconfirmed until James confirms them.
 *
 * Round 2 (2026-10-18, licence audit addendum): the Philadelphia Fed card series, Freddie Mac
 * PMMS, the New York, North Carolina and Florida state regulator sites, and Google News press
 * (state-bill-news, held).
 */
export const STRUCK_AREA_SOURCES: readonly string[] = [
  "kcfed-sb-lending",
  "fed-sbcs",
  "nacha-volume",
  "atlanta-fed-payment-choice",
  "fhlb-advance-rates",
];

/** fed-payments rows read from Federal Reserve Financial Services pages (FedNow, Fed check, the old FedACH page). */
export const STRUCK_SOURCE_URL_PATTERN = "%frbservices.org%";

/** institution_designations values from a struck list: Bank On certified accounts (joinbankon.org). */
export const STRUCK_DESIGNATIONS: readonly string[] = ["bank_on_certified"];

/** state_public_depositories program states whose list was struck: Florida (CFO site terms: educational, personal or training use). */
export const STRUCK_DEPOSITORY_STATES: readonly string[] = ["FL"];

/**
 * FRED series ids struck from the national-series loader (2026-10-18): the Philadelphia Fed's
 * large-bank credit card series (philadelphiafed.org: "informational, educational, and research
 * purposes only") and Freddie Mac PMMS (freddiemac.com/terms: "may not redistribute ... or
 * commercially exploit Data").
 */
export const STRUCK_NATIONAL_SERIES_IDS: readonly string[] = [
  "RCCCBAPRAVGPCTGP",
  "RCCCBBALTOT",
  "RCCCBUTILAVGPCT",
  "RCCCBPMTMINPCT",
  "RCCCBPMTFULLPCT",
  "MORTGAGE30US",
  "MORTGAGE15US",
];

/** The area_statistics series_key values those ids were stored under (source national-series). */
export const STRUCK_AREA_SERIES_KEYS: readonly string[] = [
  "natl_lbccm_apr_avg",
  "natl_lbccm_balances_total",
  "natl_lbccm_utilization_avg",
  "natl_lbccm_paying_minimum_share",
  "natl_lbccm_paying_full_share",
  "natl_pmms_30y_fixed",
  "natl_pmms_15y_fixed",
];

/**
 * FRED series struck: UMCSENT (University of Michigan consumer sentiment; a sold product needs a
 * licence), and the national-series ids above in case any reached fed_economic_indicators.
 */
export const STRUCK_FRED_SERIES: readonly string[] = ["UMCSENT", ...STRUCK_NATIONAL_SERIES_IDS];

/**
 * States whose regulator sites allow only non-commercial reuse (2026-10-18): New York DFS
 * ("for non-commercial purposes"), North Carolina (nc.gov: "for non-commercial use") and Florida
 * (struck 2026-10-17). state-reg-news and state-enforcement no longer read them.
 */
export const STRUCK_REGULATOR_STATES: readonly string[] = ["NY", "NC", "FL"];

/** reg_articles sources of those states' posts (registry-state-reg-news, "state:XX"). */
export const STRUCK_REG_ARTICLE_SOURCES: readonly string[] = STRUCK_REGULATOR_STATES.map((s) => `state:${s}`);

/** institution_enforcement_actions agency codes of those states' orders (registry-state-enforcement, "STATE_XX"). */
export const STRUCK_ENFORCEMENT_AGENCIES: readonly string[] = STRUCK_REGULATOR_STATES.map((s) => `STATE_${s}`);

/**
 * Held: Google News RSS press coverage (state-bill-news, reg_articles source "news:XX"). Google's
 * own RSS terms are unread and reported as personal, non-commercial use; no reader returns it.
 */
export const HELD_SOURCES: readonly string[] = ["state-bill-news"];

/** reg_articles source pattern of the held press stories. */
export const HELD_REG_ARTICLE_PATTERN = "news:%";

/** Is this reg_articles source struck or held? */
export function isHiddenRegArticleSource(source: string): boolean {
  return source.startsWith("news:") || STRUCK_REG_ARTICLE_SOURCES.includes(source);
}
