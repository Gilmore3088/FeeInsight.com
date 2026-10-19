import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every public median and count reads the same institutions (#1980): the regulator's inactive
 * institutions are left out everywhere, so /fees, /fees/[category], the institution profile's
 * market medians and the district pages cannot disagree about one fee.
 */
const queries: string[] = [];

vi.mock("@/lib/data-store/connection", () => {
  const sql = Object.assign(
    (...args: unknown[]) => {
      if (Array.isArray(args[0]) && "raw" in (args[0] as object)) {
        const strings = args[0] as string[];
        const values = args.slice(1);
        queries.push(strings.map((part, i) => part + (i < values.length ? String(values[i]) : "")).join(""));
        return Promise.resolve([]);
      }
      return args[0];
    },
    {
      // A fragment interpolated into a tagged query prints as its text; awaited, it is a query.
      unsafe: (query: unknown) => {
        queries.push(String(query));
        return Object.assign(Promise.resolve([]), { toString: () => String(query) });
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

const RULE = activeInstitutionFilter("ct");

beforeEach(() => {
  queries.length = 0;
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
