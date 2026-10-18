import { cachedPublicRead } from "./public-read-cache";
import { getCityMarket, getStateMarketCities } from "./city-market";
import { getStateMarketFees } from "./state-markets";
import { getDataFreshness, getPublicStats, getStats } from "./core";
import { getDistrictMetrics } from "./dashboard";
import { getCheapestAndMostExpensive, getFeeCategoryDetail, getIndexRows } from "./fees";
import { getFeeEvidence } from "./fee-evidence";
import { getDailyCapScope, getOverdraftComplaintThemes } from "./overdraft-policies";
import { getComparableMarketIndex, getDistrictFeeIndexes, getPeerIndex, getStateFeeIndexes } from "./fee-index";
import {
  getCitiesInState,
  getCityFeeAverages,
  getDistrictStats,
  getResearchCoverage,
  getStateStats,
  getStatesWithFeeData,
} from "./geographic";
import { getDataCoverageSummary, getMarketConcentration, getStateDemographics } from "./financial";
import {
  getCharterFeeRevenueSummary,
  getFeeRevenueData,
  getTierFeeRevenueSummary,
} from "./fee-revenue";
import { getInstitutionStateDirectorySummaries, searchInstitutions } from "./search";
import { getPublishedArticleSummaries } from "./articles";
import { getStateEconomicContext, isEmptyEconomicContext } from "./economic-context";
import { getHeadlineCoverageRows, getMarketReadiness, reportRuleCheckFromRows } from "./market-readiness";
import { getCustomReportMarketData } from "./custom-report-market";
import {
  getAllPeerRankValues,
  peerFiltersForRule,
  peerGroupValuesFrom,
  peerRankFromGroupValues,
  type InstitutionPeerRank,
} from "./peer-fee-rank";
import { getMarketBranchFootprint } from "./branches";
import { getMarketPosition } from "./market-position";
import { getNationalRateStats } from "./rate-fees";
import { getCountyFeeMap } from "./state-visuals";
import { getDistrictHub, getStateHub, isEmptyDistrictHub } from "./district-hub";

/**
 * Cached variants of the catalog-wide reads that public pages run on every request.
 * Each one returns exactly what its uncached counterpart returns; admin and Pro
 * surfaces keep calling the uncached functions so operators always see live data.
 * See public-read-cache.ts for the invalidation and empty-result rules.
 */

export const getDataFreshnessCached = cachedPublicRead("data-freshness", getDataFreshness);
/**
 * What a guide page needs from a category's detail: breakdowns and one value per institution.
 * The full detail carries every row and passes Next's 2 MB cache limit for the largest
 * categories (NSF, monthly maintenance), so it was re-read on every guide request.
 */
export const getFeeCategoryGuideDetailCached = cachedPublicRead("fee-category-guide-v1", async (category: string) => {
  const detail = await getFeeCategoryDetail(category);
  return {
    by_charter_type: detail.by_charter_type,
    by_asset_tier: detail.by_asset_tier,
    by_state: detail.by_state,
    institution_values: detail.institution_values,
  };
}, (detail) => detail.institution_values.length === 0);
export const getDailyCapScopeCached = cachedPublicRead("daily-cap-scope-v1", getDailyCapScope);
export const getOverdraftComplaintThemesCached = cachedPublicRead(
  "overdraft-complaint-themes-v1",
  getOverdraftComplaintThemes,
  (c) => c.themes.length === 0,
);
export const getStatsCached = cachedPublicRead("collection-stats", getStats);
// A failed read returns zeros; never cache those.
export const getPublicStatsCached = cachedPublicRead("public-stats", getPublicStats, (s) => s.total_observations === 0);
export const getDistrictMetricsCached = cachedPublicRead("district-metrics", getDistrictMetrics);
export const getFeeCategoryDetailCached = cachedPublicRead(
  // v2: entries carry institution_points; older entries without them are not reused.
  "fee-category-detail-v2",
  getFeeCategoryDetail,
  (detail) => detail.fees.length === 0,
);
// The Bank Fee Index explorer's rows: numbers only, so the largest category stays well under 2 MB.
export const getIndexRowsCached = cachedPublicRead("index-rows-v1", getIndexRows);
/** Fee evidence for one page of listed rows, as entries (a Map does not survive the cache). */
export const getFeeEvidenceEntriesCached = cachedPublicRead("fee-evidence-v1", async (ids: number[]) => [
  ...(await getFeeEvidence(ids)).entries(),
]);
export const getCheapestAndMostExpensiveCached = cachedPublicRead(
  "cheapest-and-most-expensive",
  getCheapestAndMostExpensive,
  (extremes) => extremes.cheapest.length === 0 && extremes.mostExpensive.length === 0,
);
export const getNationalRateStatsCached = cachedPublicRead(
  "national-rate-stats",
  getNationalRateStats,
  (stats) => stats.institution_count === 0,
);
export const getPeerIndexCached = cachedPublicRead("peer-index", getPeerIndex);
export const getStateStatsCached = cachedPublicRead("state-stats", getStateStats);
export const getDistrictStatsCached = cachedPublicRead("district-stats", getDistrictStats);
export const getStatesWithFeeDataCached = cachedPublicRead("states-with-fee-data", getStatesWithFeeData);
export const getCitiesInStateCached = cachedPublicRead("cities-in-state", getCitiesInState);
// v2: branch points carry their institution, and fees carry account, conditions and source line.
export const getCityMarketCached = cachedPublicRead("city-market-v3", getCityMarket);
export const getStateMarketCitiesCached = cachedPublicRead("state-market-cities-v1", getStateMarketCities);
export const getStateMarketFeesCached = cachedPublicRead("state-market-fees-v1", getStateMarketFees, (r) => r.length === 0);
export const getCityFeeAveragesCached = cachedPublicRead("city-fee-averages", getCityFeeAverages);
export const getDataCoverageSummaryCached = cachedPublicRead("data-coverage-summary", getDataCoverageSummary);
export const getMarketConcentrationCached = cachedPublicRead("market-concentration", getMarketConcentration);
export const getStateDemographicsCached = cachedPublicRead("state-demographics", getStateDemographics);
export const getCountyFeeMapCached = cachedPublicRead("county-fee-map", getCountyFeeMap, (map) => map.counties.length === 0);
export const getFeeRevenueDataCached = cachedPublicRead("fee-revenue-data", getFeeRevenueData);
export const getCharterFeeRevenueSummaryCached = cachedPublicRead(
  "charter-fee-revenue-summary",
  getCharterFeeRevenueSummary,
);
export const getTierFeeRevenueSummaryCached = cachedPublicRead(
  "tier-fee-revenue-summary",
  getTierFeeRevenueSummary,
);
export const getInstitutionStateDirectorySummariesCached = cachedPublicRead(
  "institution-state-directory",
  getInstitutionStateDirectorySummaries,
);
export const searchInstitutionsCached = cachedPublicRead(
  "institution-search",
  searchInstitutions,
  (result) => result.rows.length === 0,
);
export const getResearchCoverageCached = cachedPublicRead(
  "research-coverage",
  getResearchCoverage,
  (coverage) => coverage.states.length === 0,
);
export const getPublishedArticleSummariesCached = cachedPublicRead(
  "published-article-summaries",
  getPublishedArticleSummaries,
  // No articles is a real answer here, not a failed read (failures throw), so cache it.
  () => false,
);
export const getStateFeeIndexesCached = cachedPublicRead(
  // v2: entries carry institution_values; older entries without them are not reused.
  "state-fee-indexes-v2",
  getStateFeeIndexes,
  (indexes) => indexes.all.length === 0,
);
export const getDistrictFeeIndexesCached = cachedPublicRead(
  "district-fee-indexes-v1",
  getDistrictFeeIndexes,
  (indexes) => indexes.all.length === 0,
);
/**
 * The institution profile's medians: a market's index under the profile's own eligibility rules
 * (market-eligibility.ts). One entry per market (the U.S., each state, each district).
 */
export const getComparableMarketIndexCached = cachedPublicRead("comparable-market-index-v1", getComparableMarketIndex);
export const getStateEconomicContextCached = cachedPublicRead(
  "state-economic-context",
  getStateEconomicContext,
  isEmptyEconomicContext,
);
export const getMarketReadinessCached = cachedPublicRead("market-readiness", getMarketReadiness);
export const getCustomReportMarketDataCached = cachedPublicRead("custom-report-market", getCustomReportMarketData);
/**
 * Every institution's headline coverage, shared by all institution pages. Each page used to
 * recount the whole catalog for its own report rule check: about a second, 830 times an hour
 * on Oct 9. It must be read here, outside the per-institution cache: Next bypasses an
 * unstable_cache nested inside another one, so a coverage cache inside the peer rank's
 * would read the database on every miss.
 */
const getHeadlineCoverageRowsCached = cachedPublicRead("headline-coverage-rows", getHeadlineCoverageRows);
/**
 * Every institution's ranked-fee values in one entry, filtered to the page's peer group in
 * code. Per-institution and then per-group entries were each re-read after every takedown
 * refresh of the public cache: about 300 catalog reads an hour at ~460 ms on Oct 9. Like the
 * coverage rows, it is read beside the other cache, never inside it.
 */
const getAllPeerRankValuesCached = cachedPublicRead("peer-rank-values", getAllPeerRankValues);
export async function getInstitutionPeerRankCached(institutionId: number): Promise<InstitutionPeerRank | null> {
  const rule = reportRuleCheckFromRows(institutionId, await getHeadlineCoverageRowsCached());
  const filters = peerFiltersForRule(rule);
  if (!rule || !filters) return null;
  const values = peerGroupValuesFrom(await getAllPeerRankValuesCached(), filters);
  return peerRankFromGroupValues(institutionId, rule, filters, values);
}
export const getMarketBranchFootprintCached = cachedPublicRead("market-branch-footprint", getMarketBranchFootprint);
/** An institution profile's market position section (FDIC SOD shares and history, NCUA offices), per institution. */
export const getMarketPositionCached = cachedPublicRead("institution-market-position-v2", getMarketPosition);
/** The district hub's exhibits beyond the fee board (district-hub.ts), one entry per district. */
// v3: institution groups carry the regulator size_group.
export const getDistrictHubCached = cachedPublicRead("district-hub-v3", getDistrictHub, isEmptyDistrictHub);
/** The same exhibits for one whole state's page (getStateHub), one entry per state. */
export const getStateHubCached = cachedPublicRead("state-hub-v1", getStateHub, isEmptyDistrictHub);
