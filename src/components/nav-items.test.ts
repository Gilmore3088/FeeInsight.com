import { describe, expect, it } from "vitest";
import { HEADER_CTA_NAV, menuLinks, MOBILE_NAV_SECTIONS, navItemsFor, PRIMARY_CTA_NAV, PRO_PLANS_NAV, PRODUCT_NAV_GROUPS, PUBLIC_NAV_ITEMS, RESOURCES_NAV } from "./nav-items";

describe("navItemsFor", () => {
  it("gives Pro users the Hamilton workspace menu, not the old tool names", () => {
    const labels = navItemsFor({ signedIn: true, isPro: true }).map((i) => i.label);
    expect(labels).toEqual(["This month", "My fees", "Try a price", "Reports", "Regulatory Wire"]);
    expect(labels).not.toContain("Analyze");
    expect(labels).not.toContain("Monitor");
  });

  it("keeps Pricing in the menu for signed-in free users, who are the people upgrading", () => {
    expect(navItemsFor({ signedIn: true }).map((i) => i.label)).toContain("Pricing");
    expect(navItemsFor(null).map((i) => i.label)).toContain("Pricing");
  });

  it("gives signed-out visitors a direct For consumers entry alongside the business navigation", () => {
    const items = navItemsFor(null);
    expect(items.map((i) => i.label)).toEqual(["Product", "Reports", "Resources", "For consumers", "Pricing"]);
    expect(items.find((i) => i.label === "For consumers")?.href).toBe("/for-consumers");
    expect(items.find((i) => i.label === "Reports")?.href).toBe("/reports");
    expect(items.find((i) => i.label === "Pricing")?.href).toBe("/subscribe");
    expect(items.map((i) => i.label)).not.toContain("Request your report");
    expect(items.map((i) => i.label)).not.toContain("Explore data");
    expect(items.map((i) => i.label)).not.toContain("For Institutions");
  });

  it("lays the Product menu out as three cards: the index, market benchmarks and Hamilton (James, 2026-10-19)", () => {
    expect(PRODUCT_NAV_GROUPS.map((g) => g.title?.label)).toEqual(["Bank Fee Index", "Market Benchmarks", "Hamilton"]);
    expect(PRODUCT_NAV_GROUPS.map((g) => [g.title?.href, ...g.items.map((i) => i.href)])).toEqual([
      ["/fees", "/institutions", "/research/national-fee-index"],
      ["/research", "/research", "/reports"],
      ["/for-institutions#hamilton", "/subscribe", "/for-institutions#demo"],
    ]);
    expect(PRODUCT_NAV_GROUPS.filter((g) => g.feature).map((g) => g.title?.label)).toEqual(["Hamilton"]);
  });

  it("never claims every fee in the Product menu", () => {
    const words = PRODUCT_NAV_GROUPS.flatMap((g) => [g.title?.label ?? "", g.title?.description ?? "", ...g.items.map((i) => i.label)]);
    for (const word of words) expect(word).not.toMatch(/every fee/i);
  });

  it("names Hamilton only on its Product card and in the phone drawer, never as a top-level header item (James, 2026-10-19)", () => {
    expect(PUBLIC_NAV_ITEMS.map((i) => i.label).join(" ")).not.toMatch(/Hamilton/);
    expect(RESOURCES_NAV.map((i) => i.label).join(" ")).not.toMatch(/Hamilton/);
    const named = PRODUCT_NAV_GROUPS.filter((g) =>
      [g.title?.label, g.title?.description, ...g.items.map((i) => i.label)].some((t) => t?.includes("Hamilton")),
    );
    expect(named.map((g) => g.title?.href)).toEqual(["/for-institutions#hamilton"]);
  });

  it("keeps every page the header linked before reachable from it", () => {
    const hrefs = navItemsFor(null).flatMap((i) => [i.href, ...menuLinks(i).map((x) => x.href)]);
    for (const href of ["/institutions", "/fees", "/research", "/guides", "/for-institutions#hamilton", "/subscribe", "/reports"]) {
      expect(hrefs).toContain(href);
    }
    expect(RESOURCES_NAV.map((i) => i.label)).toEqual(["Consumer guides", "Methodology", "Data sources", "API", "Submit a fee source"]);
  });

  it("points the navy CTA at the institution search and the Pro button at the plans", () => {
    expect(PRIMARY_CTA_NAV).toEqual({ label: "See where your fees stand", href: "/institutions" });
    expect(HEADER_CTA_NAV).toEqual({ label: "See plans", href: "/subscribe" });
    expect(PRO_PLANS_NAV).toEqual({ label: "See Hamilton plans", href: "/subscribe" });
  });

  it("gives the phone drawer the short grouped list", () => {
    expect(MOBILE_NAV_SECTIONS.map((s) => [s.heading ?? null, s.items.map((i) => i.label)])).toEqual([
      ["Product", ["Find your institution", "Bank Fee Index", "Market Benchmarks", "Hamilton"]],
      [null, ["Reports", "Pricing"]],
      ["For consumers", ["Consumer home", "Consumer guides", "Find your bank or credit union"]],
      ["Resources", ["Methodology", "API"]],
    ]);
    const consumerSection = MOBILE_NAV_SECTIONS.find((section) => section.heading === "For consumers");
    expect(consumerSection?.items.map((item) => item.href)).toEqual(["/for-consumers", "/guides", "/institutions"]);
    expect(MOBILE_NAV_SECTIONS.flatMap((section) => section.items).filter((item) => item.href === "/guides")).toHaveLength(1);
  });
});
