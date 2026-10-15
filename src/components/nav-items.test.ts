import { describe, expect, it } from "vitest";
import { MOBILE_NAV_SECTIONS, navItemsFor, PRIMARY_CTA_NAV, PRO_PLANS_NAV, PRODUCT_NAV_GROUPS, RESOURCES_NAV } from "./nav-items";

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

  it("shows signed-out visitors Product, Reports, Resources and Pricing", () => {
    const items = navItemsFor(null);
    expect(items.map((i) => i.label)).toEqual(["Product", "Reports", "Resources", "Pricing"]);
    expect(items.find((i) => i.label === "Reports")?.href).toBe("/reports");
    expect(items.find((i) => i.label === "Pricing")?.href).toBe("/subscribe");
    expect(items.map((i) => i.label)).not.toContain("Request your report");
    expect(items.map((i) => i.label)).not.toContain("Explore data");
    expect(items.map((i) => i.label)).not.toContain("For Institutions");
  });

  it("lays the Product menu out as the three pillars", () => {
    expect(PRODUCT_NAV_GROUPS.map((g) => g.heading)).toEqual(["Every fee", "Every market", "One workspace"]);
    expect(PRODUCT_NAV_GROUPS.map((g) => g.items.map((i) => i.href))).toEqual([
      ["/institutions", "/fees"],
      ["/research", "/research/national-fee-index"],
      ["/for-institutions#hamilton", "/subscribe"],
    ]);
    expect(PRODUCT_NAV_GROUPS[2].items[1].label).toBe("See Hamilton plans");
  });

  it("keeps every page the header linked before reachable from it", () => {
    const hrefs = navItemsFor(null).flatMap((i) => [i.href, ...(i.groups ?? []).flatMap((g) => g.items.map((x) => x.href))]);
    for (const href of ["/institutions", "/fees", "/research", "/guides", "/for-institutions#hamilton", "/subscribe", "/reports"]) {
      expect(hrefs).toContain(href);
    }
    expect(RESOURCES_NAV.map((i) => i.label)).toEqual(["Guides", "Methodology", "Data sources", "API", "Submit a fee source"]);
  });

  it("points the navy CTA at the institution search and the Pro button at the plans", () => {
    expect(PRIMARY_CTA_NAV).toEqual({ label: "See where your fees stand", href: "/institutions" });
    expect(PRO_PLANS_NAV).toEqual({ label: "See Hamilton plans", href: "/subscribe" });
  });

  it("gives the phone drawer the short grouped list", () => {
    expect(MOBILE_NAV_SECTIONS.map((s) => [s.heading ?? null, s.items.map((i) => i.label)])).toEqual([
      ["Product", ["Find your institution", "Bank Fee Index", "Market data", "Hamilton"]],
      [null, ["Reports", "Pricing"]],
      ["Resources", ["Guides", "Methodology", "API"]],
    ]);
  });
});
