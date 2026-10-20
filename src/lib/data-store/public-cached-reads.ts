import { cachedPublicRead } from "./public-read-cache";
import { getCityMarket, getStateMarketCities } from "./city-market";
import { getStateMarketFees } from "./state-markets";
import { getStateLocalEconomy } from "./local-economy";
import { getDataFreshness, getFeesByInstitution, getPublicInstitutionById, getPublicStats, getStats } from "./core";
import { ATM_EXAMPLE, buildAtmTwoFeeExample } from "@/lib/guides/atm-example";
import { getDistrictMetrics } from "./dashboard";
import { getCheapestAndMostExpensive, getFeeCategoryDetail, getIndexRows } from "./fees";
import { getFeeEvidence } from "./fee-evidence";
import { getDailyCapScope, getOverdraftComplaintThemes } from "./overdraft-policies";
import { getAtmNetworkMentions } from "./atm-networks";
import { isEmptyNetworkMentions } from "@/lib/guides/atm-networks";
import { getComparableMarketIndex, getDistrictFeeIndexes, getPeerIndex, getStateFeeIndexes } from "./fee-index";
import { getDistrictStats, getResearchCoverage, getStateStats } from "./geographic";
import { getDataCoverageSummary, getMarketConcentration, getStateDemographics } from "./financial";
import {
  getCharterFeeRevenueSummary,
  getFeeRevenueData,
  getTierFeeRevenueSummary,
} from "./fee-revenue";
import { getFeeRevenueResearchPreview } from "./fee-revenue-research";
import { getInstitutionStateDirectorySummaries, getLargestInstitutions, searchInstitutions } from "./search";
import { getPublishedArticleSummaries } from "./articles";
import { getNationalIndicators, isEmptyNationalIndicators } from "./economic-context";
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
import { getBranchCityForZip } from "./branch-cities";
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
/** The ATM guide's and the consumer page's two-fee receipt, from two institutions' live published fees. */
export const getAtmTwoFeeExampleCached = cachedPublicRead("atm-two-fee-example-v1", async () => {
  const [holderFees, ownerFees] = await Promise.all([
    getFeesByInstitution(ATM_EXAMPLE.holderId),
    getFeesByInstitution(ATM_EXAMPLE.ownerId),
  ]);
  return buildAtmTwoFeeExample(holderFees, ownerFees);
});

/** The ATM guide's "Networks named in fee schedules": each network's institutions and their own lines. */
export const getAtmNetworkMentionsCached = cachedPublicRead(
  "atm-network-mentions-v1",
  getAtmNetworkMentions,
  isEmptyNetworkMentions,
);

/**
 * One demo institution's profile and visible catalog fees, for the fee-check example that /check and
 * /consumer show to every visitor (Capital City Bank). Read once per publish instead of per request;
 * the answer for a visitor's own institution keeps the per-request profile reads. Dates come back as
 * ISO strings (the cache round-trips JSON), which the date formatters accept. A missing institution or
 * one with no visible fees is never cached, so a blip cannot pin an empty example.
 */
export const getCheckExampleInputsCached = cachedPublicRead("check-example-inputs-v1", async (id: number) => {
  const inst = await getPublicInstitutionById(id);
  if (!inst) return null;
  const fees = (await getFeesByInstitution(id)).filter((fee) => fee.review_status !== "rejected");
  return JSON.parse(JSON.stringify({ inst, fees })) as { inst: typeof inst; fees: typeof fees };
}, (value) => !value || value.fees.length === 0);
export const getStatsCached = cachedPublicRead("collection-stats", getStats);
// A failed read returns zeros; never cache those.
export const getPublicStatsCached = cachedPublicRead("public-stats", getPublicStats, (s) => s.total_observations === 0);
export const getFeeCategoryDetailCached = cachedPublicRead(
  // v2: entries carry institution_points; older entries without them are not reused.
  "fee-category-detail-v2",
  getFeeCategoryDetail,
  (detail) => detail.fees.length === 0,
);
// The Bank Fee Index explorer's rows: numbers only, so the largest category stays well under 2 MB.
export const getIndexRowsCached = cachedPublicRead("index-rows-v2", getIndexRows);
/** Fee evidence for one page of listed rows, as entries (a Map does not survive the cache). */
export const getFeeEvidenceEntriesCached = cachedPublicRead("fee-evidence-v2", async (ids: number[]) => [
  ...(await getFeeEvidence(ids)).entries(),
]);
export const getNationalRateStatsCached = cachedPublicRead(
  "national-rate-stats",
  getNationalRateStats,
  (stats) => stats.institution_count === 0,
);
export const getPeerIndexCached = cachedPublicRead("peer-index", getPeerIndex);
export const getStateStatsCached = cachedPublicRead("state-stats", getStateStats);
export const getDistrictStatsCached = cachedPublicRead("district-stats", getDistrictStats);
// v4: branch points carry their institution, fees carry account, conditions and source line, and every spelling of the city is read.
export const getCityMarketCached = cachedPublicRead("city-market-v4", getCityMarket);
// v3: cities carry the middle of their branch coordinates, for the state map, with the spellings of one city folded.
export const getStateMarketCitiesCached = cachedPublicRead("state-market-cities-v3", getStateMarketCities);
/**
 * The city explorer's county figures (Census ACS, BLS QCEW). A failed read throws and is not
 * cached; an empty answer means nothing is loaded for the state and is cached like any other, so
 * an empty table never turns into a database read on every render.
 */
export const getStateLocalEconomyCached = cachedPublicRead("state-local-economy-v1", getStateLocalEconomy, () => false);
export const getStateMarketFeesCached = cachedPublicRead("state-market-fees-v3", getStateMarketFees, (r) => r.length === 0);
export const getDataCoverageSummaryCached = cachedPublicRead("data-coverage-summary", getDataCoverageSummary);
export const getMarketConcentrationCached = cachedPublicRead("market-concentration", getMarketConcentration);
export const getStateDemographicsCached = cachedPublicRead("state-demographics", getStateDemographics);
export const getCountyFeeMapCached = cachedPublicRead("county-fee-map", getCountyFeeMap, (map) => map.counties.length === 0);
export const getFeeRevenueDataCached = cachedPublicRead("fee-revenue-data", getFeeRevenueData);
export const getFeeRevenueResearchCached = cachedPublicRead(
  "fee-revenue-research-source-date-preview-v1",
  getFeeRevenueResearchPreview,
  (result) => result.groups.length === 0,
);
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
// v2: a name search matches from the start of a word ("US Bank" no longer finds Pegasus Bank).
export const searchInstitutionsCached = cachedPublicRead(
  "institution-search-v2",
  searchInstitutions,
  (result) => result.rows.length === 0,
);
/** The directory's opening list: the largest institutions by assets, one entry per type and size. */
export const getLargestInstitutionsCached = cachedPublicRead(
  "largest-institutions-v1",
  getLargestInstitutions,
  (rows) => rows.length === 0,
);
export const getResearchCoverageCached = cachedPublicRead(
  // v2 (#1951): each area carries counted_institutions, the population behind its medians.
  "research-coverage-v2",
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
/** The research hub's national indicator strip (BLS unemployment and CPI, Fed Board funds rate). */
export const getNationalIndicatorsCached = cachedPublicRead(
  "national-indicators-v1",
  getNationalIndicators,
  isEmptyNationalIndicators,
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
/**
 * Headline categories live for each of `ids`, from the shared coverage entry the institution
 * pages already read (0 for an id with none), so the directory adds no per-request read.
 */
export async function getInstitutionHeadlineCoverageCached(ids: number[]): Promise<Map<number, number>> {
  const wanted = new Set(ids);
  const coverage = new Map<number, number>(ids.map((id) => [id, 0]));
  for (const [id, categories] of await getHeadlineCoverageRowsCached()) {
    if (wanted.has(id)) coverage.set(id, categories);
  }
  return coverage;
}
export const getMarketBranchFootprintCached = cachedPublicRead("market-branch-footprint", getMarketBranchFootprint);
/** The city a ZIP code belongs to, from the branch records; the fee check reads it per ZIP. */
export const getBranchCityForZipCached = cachedPublicRead("branch-city-for-zip-v1", getBranchCityForZip);
/** The district hub's exhibits beyond the fee board (district-hub.ts), one entry per district. */
// v3: institution groups carry the regulator size_group.
export const getDistrictHubCached = cachedPublicRead("district-hub-v3", getDistrictHub, isEmptyDistrictHub);
/** The same exhibits for one whole state's page (getStateHub), one entry per state. */
export const getStateHubCached = cachedPublicRead("state-hub-v1", getStateHub, isEmptyDistrictHub);
