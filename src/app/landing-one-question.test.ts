import { describe, expect, it } from "vitest";
import { priceLabelOf } from "./landing-one-question";

describe("priceLabelOf", () => {
  it("should_quote_the_published_range_not_a_midpoint_when_accounts_differ", () => {
    expect(priceLabelOf([7.95, 8.95])).toBe("$7.95 to $8.95");
  });

  it("should_quote_the_one_price_when_every_account_charges_it", () => {
    expect(priceLabelOf([25, 25])).toBe("$25");
  });
});
