import { cachedPublicRead } from "./public-read-cache";
import { getDataFreshness, getStats } from "./core";
import { getDistrictMetrics } from "./dashboard";
import { getFeeCategoryDetail } from "./fees";
import { getPeerIndex, getStateFeeIndexes } from "./fee-index";
import {
  getCitiesInState,
  getCityFeeAverages,
  getDistrictStats,
  getResearchCoverage,
  getStateStats,
  getStatesWithFeeData,
} from "./geographic";
import { getDataCoverageSummary, getMarketConcentration } from "./financial";
import {
  getCharterFeeRevenueSummary,
  getFeeRevenueData,
  getTierFeeRevenueSummary,
} from "./fee-revenue";
import { getInstitutionStateDirectorySummaries, searchInstitutions } from "./search";
import { getPublishedArticleSummaries } from "./articles";
import { getStateEconomicContext, isEmptyEconomicContext } from "./economic-context";
import { getMarketReadiness } from "./market-readiness";
import { getCustomReportMarketData } from "./custom-report-market";
import { getInstitutionPeerRank } from "./peer-fee-rank";
import { getMarketBranchFootprint } from "./branches";
import { getNationalRateStats } from "./rate-fees";

/**
 * Cached variants of the catalog-wide reads that public pages run on every request.
 * Each one returns exactly what its uncached counterpart returns; admin and Pro
 * surfaces keep calling the uncached functions so operators always see live data.
 * See public-read-cache.ts for the invalidation and empty-result rules.
 */

export const getDataFreshnessCached = cachedPublicRead("data-freshness", getDataFreshness);
export const getStatsCached = cachedPublicRead("collection-stats", getStats);
export const getDistrictMetricsCached = cachedPublicRead("district-metrics", getDistrictMetrics);
export const getFeeCategoryDetailCached = cachedPublicRead(
  "fee-category-detail",
  getFeeCategoryDetail,
  (detail) => detail.fees.length === 0,
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
export const getCityFeeAveragesCached = cachedPublicRead("city-fee-averages", getCityFeeAverages);
export const getDataCoverageSummaryCached = cachedPublicRead("data-coverage-summary", getDataCoverageSummary);
export const getMarketConcentrationCached = cachedPublicRead("market-concentration", getMarketConcentration);
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
  "state-fee-indexes",
  getStateFeeIndexes,
  (indexes) => indexes.all.length === 0,
);
export const getStateEconomicContextCached = cachedPublicRead(
  "state-economic-context",
  getStateEconomicContext,
  isEmptyEconomicContext,
);
export const getMarketReadinessCached = cachedPublicRead("market-readiness", getMarketReadiness);
export const getCustomReportMarketDataCached = cachedPublicRead("custom-report-market", getCustomReportMarketData);
export const getInstitutionPeerRankCached = cachedPublicRead("institution-peer-rank", getInstitutionPeerRank);
export const getMarketBranchFootprintCached = cachedPublicRead("market-branch-footprint", getMarketBranchFootprint);
