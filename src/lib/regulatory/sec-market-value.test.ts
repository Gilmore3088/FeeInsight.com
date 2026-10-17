import { describe, expect, it, vi } from "vitest";

import { checkSecMarketFacts, fetchSecMarketFacts, parseSecMarketFacts, SEC_COMPANY_FACTS_URL, type CompanyFactsBody } from "./sec-market-value";

const COMPANY_FACTS: CompanyFactsBody = {
  cik: 36104,
  entityName: "EXAMPLE BANCORP",
  facts: {
    dei: {
      EntityPublicFloat: {
        label: "Entity Public Float",
        description: "The aggregate market value of the voting and non-voting common equity held by non-affiliates...",
        units: {
          USD: [
            { end: "2024-06-28", val: 61_200_000_000, accn: "0000036104-25-000010", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-21", frame: "CY2024Q2I" },
            { end: "2025-06-30", val: 70_100_000_000, accn: "0000036104-26-000008", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-20" },
          ],
        },
      },
      EntityCommonStockSharesOutstanding: {
        label: "Entity Common Stock, Shares Outstanding",
        description: "Indicate number of shares or other units outstanding...",
        units: {
          shares: [
            { end: "2026-07-31", val: 1_540_000_000, accn: "0000036104-26-000050", fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-08-04" },
            { end: "2026-07-31", val: 1_541_000_000, accn: "0000036104-26-000051", fy: 2026, fp: "Q2", form: "10-Q/A", filed: "2026-08-20" },
            { end: "2026-04-30", val: "n/a" as unknown as number, accn: "x", form: "10-Q", filed: "2026-05-04" },
          ],
        },
      },
    },
    "us-gaap": { Assets: { label: "Assets", units: { USD: [{ end: "2026-06-30", val: 1 }] } } },
  },
};

describe("SEC market value facts", () => {
  it("reads both cover-page concepts as filed, keeping the latest filing per date", () => {
    const read = parseSecMarketFacts(COMPANY_FACTS);
    expect(read.missingFields).toEqual([]);
    expect(read.labelMismatches).toEqual([]);
    expect(read.repeatedDates).toBe(1);
    expect(read.facts.map((f) => [f.concept, f.periodEnd, f.value, f.frame, f.form])).toEqual([
      ["EntityPublicFloat", "2024-06-28", 61_200_000_000, "CY2024Q2I", "10-K"],
      ["EntityPublicFloat", "2025-06-30", 70_100_000_000, null, "10-K"],
      ["EntityCommonStockSharesOutstanding", "2026-07-31", 1_541_000_000, null, "10-Q/A"],
    ]);
  });

  it("reports a missing concept, a missing unit and an unexpected label", () => {
    const read = parseSecMarketFacts({
      facts: { dei: { EntityCommonStockSharesOutstanding: { label: "Something else", units: { pure: [{ end: "2026-01-01", val: 1 }] } } } },
    });
    expect(read.facts).toEqual([]);
    expect(read.missingFields).toEqual(["dei:EntityPublicFloat", "dei:EntityCommonStockSharesOutstanding:unit:shares"]);
    expect(read.labelMismatches).toEqual(["dei:EntityCommonStockSharesOutstanding: Something else"]);
    expect(read.unexpectedUnits).toEqual(["dei:EntityCommonStockSharesOutstanding:pure"]);
    expect(parseSecMarketFacts({}).missingFields).toHaveLength(2);
  });

  it("pads the CIK and treats a 404 as no facts", async () => {
    expect(SEC_COMPANY_FACTS_URL("36104")).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000036104.json");
    const fetchImpl = vi.fn(async () => new Response("nf", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchSecMarketFacts("36104", { fetchImpl, backoffMs: 0, retries: 0 })).toBeNull();
  });

  it("counts gaps per filer without changing values", () => {
    const read = parseSecMarketFacts(COMPANY_FACTS);
    const checks = checkSecMarketFacts([
      { cik: "1", facts: read.facts },
      { cik: "2", facts: read.facts.filter((f) => f.concept === "EntityCommonStockSharesOutstanding").map((f) => ({ ...f, value: 0 })) },
    ]);
    expect(checks).toMatchObject({ facts: 4, filers: 2, filersMissing: { EntityPublicFloat: 1 }, zeroValues: 1 });
  });
});
