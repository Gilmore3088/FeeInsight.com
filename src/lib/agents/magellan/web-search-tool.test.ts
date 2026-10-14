import { describe, expect, it } from "vitest";

import { LARGE_BANK_ASSETS } from "./link-coverage";
import { bankWebSearchTool, OWN_SITE_MAX_USES, ownSiteDomain, webSearchTool } from "./web-search-tool";

describe("Magellan's web search tool (#1035)", () => {
  it("limits a bank under $10B to its own site, at most twice", () => {
    expect(bankWebSearchTool({ website_url: "https://www.pinnaclecu.org/", asset_size: "90000" }, 3)).toEqual({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: OWN_SITE_MAX_USES,
      allowed_domains: ["pinnaclecu.org"],
    });
    // A bank with no size on file is treated as a small one.
    expect(ownSiteDomain({ website_url: "pinnaclecu.org" })).toBe("pinnaclecu.org");
  });

  it("never raises a finder's own limit", () => {
    expect(bankWebSearchTool({ website_url: "https://alpha.example", asset_size: 1 }, 1).max_uses).toBe(1);
  });

  it("keeps the open web for $10B+ banks, whose schedules can sit on a parent company's domain", () => {
    expect(bankWebSearchTool({ website_url: "https://www.citi.com", asset_size: LARGE_BANK_ASSETS }, 3)).toEqual(webSearchTool(3));
  });

  it("keeps the open web when the website has no usable host", () => {
    expect(ownSiteDomain({ website_url: "" })).toBeNull();
    expect(ownSiteDomain({ website_url: "http://localhost/" })).toBeNull();
    expect(bankWebSearchTool({ website_url: null }, 3)).toEqual(webSearchTool(3));
  });
});
