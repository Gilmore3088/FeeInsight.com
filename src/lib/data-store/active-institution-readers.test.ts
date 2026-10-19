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
const { getComparableMarketIndex, getDistrictMedianByCategory, getSourcedInstitutionCount } = await import("./fee-index");

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
