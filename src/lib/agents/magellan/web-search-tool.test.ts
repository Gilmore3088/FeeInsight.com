import { describe, expect, it } from "vitest";

import { LARGE_BANK_ASSETS } from "./link-coverage";
import {
  bankWebSearchTool,
  domainRule,
  MAX_SITE_DOMAINS,
  OWN_SITE_MAX_USES,
  ownSiteDomains,
  usableSearchHost,
  webSearchTool,
} from "./web-search-tool";

describe("Magellan's web search tool (#1035)", () => {
  it("limits a bank under $10B to its own site, at most twice", () => {
    expect(bankWebSearchTool({ website_url: "https://www.pinnaclecu.org/", asset_size: "90000" }, 3)).toEqual({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: OWN_SITE_MAX_USES,
      allowed_domains: ["pinnaclecu.org"],
    });
  });

  it("never raises a finder's own limit", () => {
    expect(bankWebSearchTool({ website_url: "https://alpha.example", asset_size: 1 }, 1).max_uses).toBe(1);
  });

  it("keeps the open web for $10B+ banks, whose schedules can sit on a parent company's domain", () => {
    expect(bankWebSearchTool({ website_url: "https://www.citi.com", asset_size: LARGE_BANK_ASSETS }, 3)).toEqual(webSearchTool(3));
  });

  it("keeps the open web when the website has no usable host", () => {
    expect(ownSiteDomains({ website_url: "", asset_size: 90_000 })).toBeNull();
    expect(ownSiteDomains({ website_url: "http://localhost/", asset_size: 90_000 })).toBeNull();
    expect(bankWebSearchTool({ website_url: null, asset_size: 90_000 }, 3)).toEqual(webSearchTool(3));
  });
});

describe("site-limited search follow-ups (#1251)", () => {
  it("searches the open web when no asset size is on file: the bank may be over $10B", () => {
    expect(ownSiteDomains({ website_url: "pinnaclecu.org" })).toBeNull();
    expect(ownSiteDomains({ website_url: "pinnaclecu.org", asset_size: null })).toBeNull();
    expect(ownSiteDomains({ website_url: "pinnaclecu.org", asset_size: "" })).toBeNull();
    expect(ownSiteDomains({ website_url: "pinnaclecu.org", asset_size: 0 })).toBeNull();
    expect(ownSiteDomains({ website_url: "pinnaclecu.org", asset_size: "90000" })).toEqual(["pinnaclecu.org"]);
  });

  it("searches the open web for a host the API may refuse, or a third-party host stored as the website", () => {
    for (const website of [
      "http://192.168.10.4/",
      "https://bank.example./",
      "https://N/A",
      "https://www/brownsvillecityfcu.com",
      "http://validate.perfdrive.com",
      "http://www.facebook.com/noccfcu",
      "http://www.sites.google.com/a/apps.fairmont.k12.mn.us/fcu",
    ]) {
      expect(ownSiteDomains({ website_url: website, asset_size: 90_000 })).toBeNull();
    }
    expect(usableSearchHost("first.bank")).toBe(true);
    expect(usableSearchHost("tulane-loyolafcu.net")).toBe(true);
    expect(usableSearchHost("10.0.0.1")).toBe(false);
    expect(usableSearchHost("bank.example.")).toBe(false);
    expect(usableSearchHost("bank_name.com")).toBe(false);
  });

  it("adds the bank's other own hosts after its website, without repeats, up to the cap", () => {
    expect(ownSiteDomains({ website_url: "https://www.machiassavings.com", asset_size: 600_000 }, ["machiassavings.bank"])).toEqual([
      "machiassavings.com",
      "machiassavings.bank",
    ]);
    expect(
      ownSiteDomains({ website_url: "https://a-bank.com", asset_size: 600_000 }, ["a-bank.com", "a.bank", "a.bank", "bad host", "b.bank", "c.bank", "d.bank"]),
    ).toEqual(["a-bank.com", "a.bank", "b.bank", "c.bank"].slice(0, MAX_SITE_DOMAINS));
    expect(bankWebSearchTool({ website_url: "https://cashmerevalleybank.com", asset_size: 2_000_000 }, 3, ["cvb.bank"]).allowed_domains).toEqual([
      "cashmerevalleybank.com",
      "cvb.bank",
    ]);
    // A $10B+ bank keeps the open web whatever hosts it owns.
    expect(bankWebSearchTool({ website_url: "https://www.citi.com", asset_size: LARGE_BANK_ASSETS }, 3, ["citi.bank"])).toEqual(webSearchTool(3));
  });

  it("offers a parent company's domain only to an open-web search", () => {
    expect(domainRule("citi.com", null)).toContain("parent company's domain");
    const limited = domainRule("machiassavings.com", ["machiassavings.com", "machiassavings.bank"]);
    expect(limited).not.toContain("parent company");
    expect(limited).toContain("machiassavings.com or machiassavings.bank");
  });
});
