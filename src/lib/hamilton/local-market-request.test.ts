import { describe, expect, it } from "vitest";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import {
  DEFAULT_LOCAL_MARKET_CATEGORIES, HOMEPAGE_MARKET_CATEGORIES, LocalMarketRequestError,
  homepageLocalMarketRequest, parseLocalMarketRequest, resolveLocalMarketCategories, selectMarketFees,
} from "./local-market-request";

describe("local-market request scope", () => {
  it("retains legacy defaults only when categories are omitted", () => {
    expect(parseLocalMarketRequest({ institutionId: 101 })).toEqual({
      institutionId: 101, categories: [...DEFAULT_LOCAL_MARKET_CATEGORIES],
    });
    expect(parseLocalMarketRequest({}).institutionId).toBeNull();
  });

  it("uses all four non-overdraft homepage categories without preferring stop payment", () => {
    const request = homepageLocalMarketRequest(101);
    expect(request.categories).toEqual(["cashiers_check", "paper_statement", "money_order", "stop_payment"]);
    expect(request.categories).not.toContain("overdraft");
    expect(request.categories).not.toContain("nsf");
  });

  it("preserves a single selection and deduplicates without reordering", () => {
    expect(homepageLocalMarketRequest(101, ["paper_statement"]).categories).toEqual(["paper_statement"]);
    expect(resolveLocalMarketCategories(["money_order", "cashiers_check", "money_order"]))
      .toEqual(["money_order", "cashiers_check"]);
  });

  it("does not mutate an input or share mutable default arrays", () => {
    const frozen = Object.freeze(["paper_statement", "cashiers_check"]);
    expect(resolveLocalMarketCategories(frozen)).toEqual(frozen);
    const a = homepageLocalMarketRequest(101);
    a.categories.push("overdraft");
    expect(homepageLocalMarketRequest(101).categories).toEqual([...HOMEPAGE_MARKET_CATEGORIES]);
  });

  it.each(Object.values(FEE_FAMILIES).flat())("accepts the current canonical category %s", (category) => {
    expect(resolveLocalMarketCategories([category])).toEqual([category]);
  });

  it.each([null, [], "paper_statement", ["not_a_fee"], ["paper_statement", 1], ["paper_statement "]]
    .map((value) => ({ value })))("rejects an invalid category selection: $value", ({ value }) => {
    expect(() => resolveLocalMarketCategories(value)).toThrow(LocalMarketRequestError);
  });

  it("rejects a sparse category list", () => {
    expect(() => resolveLocalMarketCategories(new Array(2))).toThrow(LocalMarketRequestError);
  });

  it("rejects an oversized category list before deduplication", () => {
    expect(() => resolveLocalMarketCategories(Array(51).fill("paper_statement"))).toThrow(LocalMarketRequestError);
  });

  it.each([null, [], "bad", 17, false].map((value) => ({ value })))
    ("rejects malformed bodies: $value", ({ value }) => {
      expect(() => parseLocalMarketRequest(value)).toThrow(LocalMarketRequestError);
    });

  it.each([0, -1, 1.2, "", "101junk", "1e2", " 101 ", "00101", true, [], {}, 2_147_483_648]
    .map((value) => ({ value })))("rejects an invalid explicit subject: $value", ({ value }) => {
    expect(() => parseLocalMarketRequest({ institutionId: value })).toThrow(LocalMarketRequestError);
  });

  it("normalizes canonical string IDs without deriving ownership", () => {
    expect(parseLocalMarketRequest({ institutionId: "101", categories: ["paper_statement"] }))
      .toEqual({ institutionId: 101, categories: ["paper_statement"] });
  });

  it.each(["state", "stateCode", "charterType", "institutionType", "snapshotAt", "evidencePolicy", "accountInstitutionId", "userId", "categoriesExtra"])
    ("does not silently discard unsupported scope %s", (field) => {
      expect(() => parseLocalMarketRequest({ institutionId: 101, [field]: "untrusted" })).toThrow(/not applied/);
    });

  it("requires an explicit subject for the homepage adapter", () => {
    expect(() => homepageLocalMarketRequest(null as unknown as number)).toThrow(/Choose an institution/);
  });

  it("keeps a real zero, removes nonfinite and unrequested values, and does not invent missing fees", () => {
    const result = selectMarketFees(
      { paper_statement: 0, cashiers_check: 5, overdraft: 30, money_order: NaN, stop_payment: Infinity },
      [...HOMEPAGE_MARKET_CATEGORIES],
    );
    expect(result).toEqual({ cashiers_check: 5, paper_statement: 0 });
    expect(result).not.toHaveProperty("money_order");
  });
});
