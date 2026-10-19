import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every public median and count reads the same institutions (#1980): the regulator's inactive
 * institutions are left out everywhere, so /fees, /fees/[category], the institution profile's
 * market medians and the district pages cannot disagree about one fee.
 */
const queries: string[] = [];
/** Rows the mock answers a query with; [] unless a test needs a reader to get past an early return. */
let respond: (query: string) => unknown[] = () => [];

vi.mock("@/lib/data-store/connection", () => {
  const sql = Object.assign(
    (...args: unknown[]) => {
      if (Array.isArray(args[0]) && "raw" in (args[0] as object)) {
        const strings = args[0] as string[];
        const values = args.slice(1);
        const query = strings.map((part, i) => part + (i < values.length ? String(values[i]) : "")).join("");
        queries.push(query);
        return Promise.resolve(respond(query));
      }
      return args[0];
    },
    {
      // A fragment interpolated into a tagged query prints as its text; awaited, it is a query.
      unsafe: (query: unknown) => {
        queries.push(String(query));
        return Object.assign(Promise.resolve(respond(String(query))), { toString: () => String(query) });
      },
    },
  );
  return { sql, getSql: () => sql };
});

const { activeInstitutionFilter } = await import("./fee-stats");
const { getFeeCategoryDetail } = await import("./fees");
const {
  getCategoryChargeBases,
  getComparableMarketIndex,
  getContractFeeRows,
  getDistrictMedianByCategory,
  getNationalUnstatedAudienceCountsCached,
  getSegmentFeeRows,
  getSegmentFeeValues,
  getSourcedInstitutionCount,
} = await import("./fee-index");
const { getCheapestAndMostExpensive } = await import("./fees");
const {
  getCitiesInState,
  getCityAutocomplete,
  getCityFeeAverages,
  getCityInstitutions,
  getDistrictStats,
  getStateStats,
  getStatesWithFeeData,
  getTopCitiesByState,
} = await import("./geographic");
const { getPublicStats, getStats } = await import("./core");
const { getPeerPreviewStats, getTopCategoriesForPeerSet } = await import("./peers");
const { getNationalRateStats } = await import("./rate-fees");
const { getStateHub } = await import("./district-hub");
const { loadSnapshotRows } = await import("@/lib/agents/growth/market-snapshot");
const { sql: mockSql } = await import("./connection");
const { getCityMarket, getStateMarketCities } = await import("./city-market");
const { getStateMarketFees } = await import("./state-markets");
const { getInstitutionStateDirectorySummaries } = await import("./search");
const { getCountyFeeMap, getStateVisualsData } = await import("./state-visuals");
const { getDistrictMetrics } = await import("./dashboard");
const { getFeesForCategory, getFilteredTierCounts, getSegmentOutliers } = await import("./market");
const { getPeerFinancialMedians, getPeerPercentiles } = await import("./financial");
const { getCharterFeeRevenueSummary, getFeeRevenueData, getTierFeeRevenueSummary } = await import("./fee-revenue");
const { getRevenueConcentration } = await import("./derived-analytics");

const RULE = activeInstitutionFilter("ct");

beforeEach(() => {
  queries.length = 0;
  respond = () => [];
});

describe("public readers take the active-institution rule (#1980)", () => {
  it.each([
    ["getFeeCategoryDetail (/fees/[category], guides, API v1 fees)", () => getFeeCategoryDetail("overdraft")],
    ["getComparableMarketIndex (institution profile, US)", () => getComparableMarketIndex({ kind: "us" })],
    ["getComparableMarketIndex (institution profile, state)", () => getComparableMarketIndex({ kind: "state", code: "TX" })],
    ["getDistrictMedianByCategory", () => getDistrictMedianByCategory("overdraft")],
    ["getSourcedInstitutionCount", () => getSourcedInstitutionCount()],
  ])("%s", async (_name, read) => {
    await read().catch(() => undefined);
    const main = queries.find((query) => query.includes("FROM published_fee_catalog ef"));
    expect(main).toBeDefined();
    expect(main).toContain("JOIN institution_sources ct");
    expect(main).toContain(RULE);
  });
});

/**
 * The remaining public readers (#2149). Every query a reader sends against the registry or the
 * catalogs must carry the rule, so a page never prints a count or median over a different set of
 * institutions than the national, state and district medians beside it.
 */
const READS_INSTITUTIONS = /FROM (institution_sources|published_fee_catalog|published_fee_rate_catalog)\b/;

describe("remaining public readers take the active-institution rule (#2149)", () => {
  it.each([
    ["getStats (/methodology schedule links, /research/data-sources)", () => getStats()],
    ["getPublicStats (Pro data, market and district pages)", () => getPublicStats()],
    ["getPeerPreviewStats", () => getPeerPreviewStats({ charter_type: "bank" })],
    ["getTopCategoriesForPeerSet", () => getTopCategoriesForPeerSet({ charter_type: "bank" })],
    ["getSegmentFeeRows (national trends report)", () => getSegmentFeeRows(["overdraft"])],
    ["getSegmentFeeValues (Hamilton segments)", () =>
      getSegmentFeeValues({ minAssets: null, maxAssets: null, charterType: null, stateCode: "TX", largest: null }, "overdraft", "nsf")],
    ["getContractFeeRows (Hamilton research)", () => getContractFeeRows({ categories: ["overdraft"] })],
    ["getCategoryChargeBases (Pro report charge basis)", () => getCategoryChargeBases()],
    ["loadNationalUnstatedAudienceCounts (/fees audience-not-stated note)", () => getNationalUnstatedAudienceCountsCached()],
    ["getStateStats", () => getStateStats("TX")],
    ["getDistrictStats", () => getDistrictStats(11)],
    ["getCityInstitutions", () => getCityInstitutions("Austin", "TX")],
    ["getCityFeeAverages", () => getCityFeeAverages("Austin", "TX")],
    ["getCitiesInState", () => getCitiesInState("TX")],
    ["getTopCitiesByState", () => getTopCitiesByState(3, 10)],
    ["getCityAutocomplete", () => getCityAutocomplete("Aus")],
    ["getStatesWithFeeData", () => getStatesWithFeeData()],
    ["getCheapestAndMostExpensive (/fees/[category])", () => getCheapestAndMostExpensive("overdraft")],
    ["getNationalRateStats (/fees/[category] rate figure)", () => getNationalRateStats("foreign_transaction")],
    ["loadSnapshotRows (/tools/price-check)", () => loadSnapshotRows(mockSql as never, [1, 2], ["overdraft"])],
  ])("%s", async (_name, read) => {
    await (read as () => Promise<unknown>)().catch(() => undefined);
    const reads = queries.filter((query) => READS_INSTITUTIONS.test(query));
    expect(reads.length).toBeGreaterThan(0);
    for (const query of reads) expect(query).toContain(RULE);
  });

  it("loadStateFees (state and district hub fee medians)", async () => {
    await getStateHub("TX").catch(() => undefined);
    const fees = queries.find((query) => query.includes("ef.fee_category = ANY($2::text[])"));
    expect(fees).toBeDefined();
    expect(fees).toContain("JOIN institution_sources ct");
    expect(fees).toContain(RULE);
  });
});

/** The same rule under whichever alias the query gives institution_sources (ct, s, or the table name). */
const RULE_ANY_ALIAS = new RegExp(`\\b[A-Za-z_]\\w*\\.${RULE.slice(RULE.indexOf(".") + 1)}`);

/** Enough rows for the market readers to get past their early returns to the fee and institution reads. */
function marketRows(query: string): unknown[] {
  if (query.includes("all_branches")) {
    return [{ city: "AUSTIN", institution_ids: [1], published_ids: [1], branches: 1, metro: null, lat: null, lon: null }];
  }
  if (query.includes("FROM institution_branch_deposits") && query.includes("UNION ALL")) return [{ city: "AUSTIN", institution_id: 1 }];
  if (query.includes("SELECT d.institution_id, d.deposits, d.latitude")) return [{ institution_id: 1, deposits: 1, county_fips: 48453 }];
  if (query.includes("MAX(year) AS y")) return [{ y: 2025 }];
  return [];
}

/**
 * The readers #2149 missed (#2190): the state page's market comparison, the city pages, the
 * directory's per-state counts, the state report and price-check county map, the district
 * metrics, the market segment reads, the institution profile's financial peer group, the
 * fee-revenue summaries and the revenue concentration read.
 */
describe("readers #2149 missed take the active-institution rule (#2190)", () => {
  it.each([
    ["getStateMarketCities (/fees/city/[state] directory)", () => getStateMarketCities("TX")],
    ["getStateMarketFees (/research/state/[code] market medians)", () => getStateMarketFees("TX")],
    ["getCityMarket (/fees/city/[state]/[city])", () => getCityMarket("Austin", "TX", "city")],
    ["getInstitutionStateDirectorySummaries (/institutions per-state counts)", () => getInstitutionStateDirectorySummaries()],
    ["getStateVisualsData (state report charts)", () => getStateVisualsData("TX")],
    ["getCountyFeeMap (/tools/price-check county map)", () => getCountyFeeMap("TX", "overdraft")],
    ["getDistrictMetrics (Hamilton districts)", () => getDistrictMetrics()],
    ["getFilteredTierCounts", () => getFilteredTierCounts({})],
    ["getFeesForCategory", () => getFeesForCategory("overdraft", {})],
    ["getSegmentOutliers", () => getSegmentOutliers({})],
    ["getPeerFinancialMedians (institution profile)", () => getPeerFinancialMedians(1)],
    ["getPeerPercentiles (institution profile)", () => getPeerPercentiles(1)],
    ["getFeeRevenueData", () => getFeeRevenueData()],
    ["getTierFeeRevenueSummary", () => getTierFeeRevenueSummary()],
    ["getCharterFeeRevenueSummary", () => getCharterFeeRevenueSummary()],
    ["getRevenueConcentration", () => getRevenueConcentration()],
  ])("%s", async (_name, read) => {
    respond = marketRows;
    await (read as () => Promise<unknown>)().catch(() => undefined);
    const reads = queries.filter((query) => READS_INSTITUTIONS.test(query));
    expect(reads.length).toBeGreaterThan(0);
    for (const query of reads) expect(query).toMatch(RULE_ANY_ALIAS);
  });

  it("the state market and city fee reads reach the catalog with the rule", async () => {
    respond = marketRows;
    await getStateMarketFees("TX");
    await getCityMarket("Austin", "TX", "city");
    const feeReads = queries.filter((query) => query.includes("FROM published_fee_catalog ef") && query.includes("rn = (n + 1) / 2"));
    expect(feeReads).toHaveLength(2);
    for (const query of feeReads) expect(query).toContain(RULE);
  });

  it("the state report reaches its county and deposit-holder fee reads with the rule", async () => {
    respond = marketRows;
    await getStateVisualsData("TX");
    const overdraft = queries.filter((query) => query.includes("FROM published_fee_catalog ef"));
    expect(overdraft.length).toBeGreaterThanOrEqual(2);
    for (const query of overdraft) expect(query).toContain(RULE);
  });

  /**
   * Branch and deposit figures beside the fees count the same institutions (#2190): county
   * coverage, the top deposit holders and the city's branch counts leave out the regulator's
   * inactive institutions through a LEFT JOIN, so a branch with no institution on file stays.
   */
  const BRANCH_RULE = `LEFT JOIN institution_sources bs ON bs.id = `;
  const branchReads = () => queries.filter((query) => /FROM (institution_branch_deposits d|credit_union_branches c)\b/.test(query));

  it("the state report's county coverage and top deposit holders leave out inactive institutions", async () => {
    respond = marketRows;
    await getStateVisualsData("TX");
    const reads = branchReads();
    // countyFeeRows' branches and the holders' branches.
    expect(reads).toHaveLength(2);
    for (const query of reads) {
      expect(query).toContain(BRANCH_RULE + "d.institution_id");
      expect(query).toContain(activeInstitutionFilter("bs"));
    }
  });

  it("the price-check county map's branches leave out inactive institutions", async () => {
    respond = marketRows;
    await getCountyFeeMap("TX", "overdraft");
    const reads = branchReads();
    expect(reads).toHaveLength(2);
    for (const query of reads) expect(query).toContain(activeInstitutionFilter("bs"));
  });

  it.each(["city", "metro"] as const)("the %s market's bank and credit union branches leave out inactive institutions", async (area) => {
    respond = (query) => {
      if (query.includes("msa_code, MAX(msa_name)")) return [{ msa_code: 12420, msa_name: "Austin-Round Rock" }];
      return marketRows(query);
    };
    await getCityMarket("Austin", "TX", area);
    const reads = branchReads();
    expect(reads).toHaveLength(2);
    expect(reads[0]).toContain(BRANCH_RULE + "d.institution_id");
    expect(reads[1]).toContain(BRANCH_RULE + "c.institution_id");
    for (const query of reads) expect(query).toContain(activeInstitutionFilter("bs"));
  });

  it("the financial peer group keeps the institution itself", async () => {
    await getPeerFinancialMedians(7).catch(() => undefined);
    expect(queries.find((query) => query.includes("JOIN institution_sources s"))).toContain(`(${activeInstitutionFilter("s")} OR s.id = 7)`);
  });
});

/**
 * A ratchet on the rule (#2190): every data-store file that reads the fee catalogs either takes
 * activeInstitutionFilter or is named below, so a new reader without the rule fails here instead
 * of in review. Take a file off the list when it gains the rule; a file added to it needs a
 * reason it shows no public count or median across institutions.
 */
const CATALOG_READ = /(FROM|JOIN)\s+(published_fee_catalog|published_fee_rate_catalog)\b/;
/** A call of the rule, not a mention of its name in a comment. */
const RULE_CALL = /activeInstitutionFilter\(/;
const WITHOUT_RULE: Record<string, string> = {
  // Admin, agent and pipeline reads: not shown to visitors or customers.
  "data-room.ts": "admin data room and agent work lists",
  "fee-correction-audit.ts": "admin corrections audit",
  "hit-list.ts": "admin Magellan hit list",
  "live-source-audit.ts": "Deming's live-source audit",
  "live-source-audit-read.ts": "admin scoreboard's live-source audit panel and agent goals",
  "pipeline-funnel.ts": "admin pipeline funnel",
  "pro-accounts.ts": "subscriber accounts",
  "states.ts": "admin state pipeline page",
  "top-ten-coverage.ts": "admin and Magellan top-ten coverage",
  // One institution's own rows, or rows that each name their institution: no cross-institution figure.
  "account-lineup.ts": "one institution's account lineup",
  "alerts.ts": "a subscriber's own alert matches",
  "consumer-price-moves.ts": "a per-row predicate other readers embed",
  "fee-evidence.ts": "one fee's stored evidence",
  "institution.ts": "one institution's page",
  "published-fee-rows.ts": "row-level partner export",
  // Not yet reviewed against the page that shows them (#2190 follow-up).
  "atm-networks.ts": "not yet reviewed",
  "benchmark-export.ts": "not yet reviewed",
  "competitor-coverage.ts": "not yet reviewed",
  "custom-report-market.ts": "not yet reviewed",
  "hamilton-peer-fees.ts": "not yet reviewed",
  "hamilton-peer-list.ts": "not yet reviewed",
  "local-market.ts": "not yet reviewed",
  "market-readiness.ts": "not yet reviewed",
  "market-study.ts": "not yet reviewed",
  "merger-screen.ts": "not yet reviewed",
  "overdraft-policies.ts": "not yet reviewed",
  "peer-sets.ts": "not yet reviewed",
};

describe("catalog readers without the active-institution rule are named (#2190)", () => {
  const dir = import.meta.dirname;
  const files = readdirSync(dir).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
  const text = (file: string) => readFileSync(join(dir, file), "utf8");

  it("every catalog reader takes the rule or is on the list", () => {
    const missing = files.filter((file) => CATALOG_READ.test(text(file)) && !RULE_CALL.test(text(file)) && !(file in WITHOUT_RULE));
    expect(missing).toEqual([]);
  });

  it("the list names only files that still read the catalogs without the rule", () => {
    const stale = Object.keys(WITHOUT_RULE).filter(
      (file) => !files.includes(file) || !CATALOG_READ.test(text(file)) || RULE_CALL.test(text(file)),
    );
    expect(stale).toEqual([]);
  });
});
