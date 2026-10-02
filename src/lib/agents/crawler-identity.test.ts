import { describe, expect, it } from "vitest";
import { CRAWLER_PRODUCT_TOKEN, crawlerUserAgent } from "./crawler-identity";

describe("crawlerUserAgent", () => {
  it("keeps one product token and names the agent in brackets", () => {
    expect(crawlerUserAgent("Magellan")).toBe("FeeInsightBot/1.0 (Magellan; +https://feeinsight.com/contact)");
    expect(crawlerUserAgent("Rosetta")).toBe("FeeInsightBot/1.0 (Rosetta; +https://feeinsight.com/contact)");
  });

  it("starts every agent's identity with the shared token sites match in robots.txt", () => {
    for (const agent of ["Magellan", "Rosetta"] as const) {
      expect(crawlerUserAgent(agent).startsWith(`${CRAWLER_PRODUCT_TOKEN}/`)).toBe(true);
    }
  });
});
