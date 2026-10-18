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

/**
 * area_statistics rows stored from FRED (fred.stlouisfed.org; national-series before 2026-10-18).
 * FRED's terms bar commercial use and storing FRED content without the St. Louis Fed's consent, so
 * the series now come from their original publishers (DECISIONS.md "No non-commercial data", FRED
 * replaced by original publishers, 2026-10-18). A re-fetched row is overwritten with its
 * publisher's URL; a row nothing overwrites keeps this URL and is served only until its key has a
 * Board row (areaRowServedSql).
 */
export const FRED_SOURCE_URL_PATTERN = "%stlouisfed.org%";

/** Every source_url pattern readers exclude: `COALESCE(source_url, '') NOT ILIKE ALL(...)`. */
export const STRUCK_SOURCE_URL_PATTERNS: readonly string[] = [STRUCK_SOURCE_URL_PATTERN, FRED_SOURCE_URL_PATTERN];

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

/**
 * FDIC national deposit rates the national-series loader read from FRED until 2026-10-18 (SNDR,
 * ICNDR, MMNDR, NDR12MCD). FDIC data is public, but the FDIC's own page could not be fetched and
 * no FDIC machine-readable file was confirmed, so they are no longer loaded; rows stored from FRED
 * are never returned.
 */
export const DROPPED_FDIC_RATE_SERIES_IDS: readonly string[] = ["SNDR", "ICNDR", "MMNDR", "NDR12MCD"];

/** The area_statistics series_key values those ids were stored under (source national-series). */
export const STRUCK_AREA_SERIES_KEYS: readonly string[] = [
  "natl_lbccm_apr_avg",
  "natl_lbccm_balances_total",
  "natl_lbccm_utilization_avg",
  "natl_lbccm_paying_minimum_share",
  "natl_lbccm_paying_full_share",
  "natl_pmms_30y_fixed",
  "natl_pmms_15y_fixed",
  "natl_fdic_rate_savings",
  "natl_fdic_rate_interest_checking",
  "natl_fdic_rate_money_market",
  "natl_fdic_rate_cd_12_month",
];

/**
 * fed_economic_indicators series read from FRED until 2026-10-18 that no original publisher
 * replaces (DECISIONS.md "No non-commercial data", FRED replaced by original publishers):
 * - QBPQYTNIYSRVDP: the FDIC Quarterly Banking Profile's deposit service charges. The FDIC is the
 *   publisher, but its site could not be fetched and no QBP time-series file was confirmed.
 * - DRCBLACBS: not matched to a Federal Reserve Board charge-off and delinquency column; its
 *   definition could not be confirmed, so it is not substituted.
 */
export const DROPPED_FRED_INDICATORS: readonly string[] = ["QBPQYTNIYSRVDP", "DRCBLACBS"];

/**
 * FRED series struck: UMCSENT (University of Michigan consumer sentiment; a sold product needs a
 * licence), the national-series ids above in case any reached fed_economic_indicators, and the
 * series FRED carried that no original publisher replaces.
 */
export const STRUCK_FRED_SERIES: readonly string[] = [
  "UMCSENT",
  ...STRUCK_NATIONAL_SERIES_IDS,
  ...DROPPED_FDIC_RATE_SERIES_IDS,
  ...DROPPED_FRED_INDICATORS,
];

/**
 * Dropped, not struck: no original-publisher file was confirmed, so nothing reloads them. Their
 * terms are not the reason, so query refusals say so (`notYetFromPublisherReason`).
 */
export const NOT_YET_FROM_PUBLISHER_SERIES: readonly string[] = [...DROPPED_FDIC_RATE_SERIES_IDS, ...DROPPED_FRED_INDICATORS];

/** The area_statistics keys of the dropped FDIC national rates (national-series). */
export const NOT_YET_FROM_PUBLISHER_AREA_KEYS: readonly string[] = [
  "natl_fdic_rate_savings",
  "natl_fdic_rate_interest_checking",
  "natl_fdic_rate_money_market",
  "natl_fdic_rate_cd_12_month",
];

/** The refusal for a dropped series; null when the series or key is not one of them. */
export function notYetFromPublisherReason(seriesKey: string): string | null {
  return NOT_YET_FROM_PUBLISHER_SERIES.includes(seriesKey) || NOT_YET_FROM_PUBLISHER_AREA_KEYS.includes(seriesKey)
    ? "This series is not published from its original source yet."
    : null;
}

/**
 * Where registry-fred records its publisher cutover (source "fred", partition "current"):
 * `publisher_cutover_at` is fixed by the first run that read the original publishers, and
 * `publisher_series` lists every series that run set out to load.
 */
export const FED_INDICATOR_CUTOVER = {
  source: "fred",
  partitionKey: "current",
  detailKey: "publisher_cutover_at",
  seriesKey: "publisher_series",
} as const;

/** Series ids embedded in SQL text must be plain ids (no quoting needed). */
function sqlIdList(ids: readonly string[]): string {
  for (const id of ids) if (!/^[A-Za-z0-9_]+$/.test(id)) throw new Error(`Unsafe series id for SQL: ${id}`);
  return ids.length === 0 ? "ARRAY[]::text[]" : `ARRAY[${ids.map((id) => `'${id}'`).join(", ")}]::text[]`;
}

/**
 * SQL condition (constants only, no parameters) for a servable fed_economic_indicators row;
 * `alias` is the table alias. fed_economic_indicators has no source_url, so the rule works per
 * series, from when rows were written (DECISIONS.md "No non-commercial data", FRED replaced by
 * original publishers, 2026-10-18):
 * - A struck or dropped series (STRUCK_FRED_SERIES) is never served.
 * - Before the first publisher run (no cutover recorded) every other row is served as before.
 * - A row written at or after the cutover came from the series' publisher and is served.
 * - A row written before it (a FRED-era row) is served only while its series is one registry-fred
 *   loads from a publisher (`publisher_series`) and that series has no row from its publisher
 *   yet. A publisher fetch that keeps failing leaves the series on its FRED-era values (the step
 *   lists it as "still on FRED-era values"); once one publisher row lands, every FRED-era row of
 *   that series is hidden. A series no publisher loads is hidden at once.
 * - NYFED_ and OFR_ series come from other loaders, not FRED, and are always served.
 * No row is deleted.
 */
export function fedIndicatorServedSql(alias?: string): string {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  const { source, partitionKey, detailKey, seriesKey } = FED_INDICATOR_CUTOVER;
  const partition = `FROM registry_ingest_partitions cut WHERE cut.source = '${source}' AND cut.partition_key = '${partitionKey}'`;
  const cutover = `(SELECT (cut.detail->>'${detailKey}')::timestamptz ${partition})`;
  const covered = `(SELECT jsonb_array_elements_text(COALESCE(cut.detail->'${seriesKey}', '[]'::jsonb)) ${partition})`;
  const fromPublisher = `(SELECT DISTINCT pub.series_id FROM fed_economic_indicators pub WHERE pub.fetched_at >= ${cutover})`;
  return (
    `(${col("series_id")} ~ '^(NYFED|OFR)_' OR (` +
    `${col("series_id")} <> ALL(${sqlIdList(STRUCK_FRED_SERIES)}) AND (` +
    `${cutover} IS NULL` +
    ` OR ${col("fetched_at")} >= ${cutover}` +
    ` OR (${col("series_id")} IN ${covered} AND ${col("series_id")} NOT IN ${fromPublisher}))))`
  );
}

/**
 * SQL condition (constants only) for a servable area_statistics row; `alias` is the table alias,
 * or the bare table name when the query has none. Rows from a struck URL (frbservices.org) are
 * never served. A row stored from FRED (stlouisfed.org; national-series before 2026-10-18) is
 * served only while its key is not struck and no row from the Federal Reserve Board exists for
 * the same source and key: a Board fetch that keeps failing leaves the key on its FRED-era
 * values, and the first Board row hides them all.
 */
export function areaRowServedSql(alias = "area_statistics"): string {
  const a = (name: string) => `${alias}.${name}`;
  const struckUrls = `ARRAY[${STRUCK_SOURCE_URL_PATTERNS.map((p) => `'${p}'`).join(", ")}]::text[]`;
  return (
    `(COALESCE(${a("source_url")}, '') NOT ILIKE ALL(${struckUrls}) OR (` +
    `${a("source_url")} ILIKE '${FRED_SOURCE_URL_PATTERN}'` +
    ` AND ${a("series_key")} <> ALL(${sqlIdList(STRUCK_AREA_SERIES_KEYS)})` +
    ` AND NOT EXISTS (SELECT 1 FROM area_statistics board WHERE board.source = ${a("source")}` +
    ` AND board.series_key = ${a("series_key")} AND COALESCE(board.source_url, '') NOT ILIKE ALL(${struckUrls}))))`
  );
}

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
