import { describe, expect, it } from "vitest";
import { HEADER_CTA_NAV, MOBILE_NAV_SECTIONS, navItemsFor, PRIMARY_CTA_NAV, PRO_PLANS_NAV, PRODUCT_NAV_GROUPS, PUBLIC_NAV_ITEMS, RESOURCES_NAV } from "./nav-items";

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
    expect(PRODUCT_NAV_GROUPS[2].items.map((i) => i.label)).toEqual(["Workspace", "Plans"]);
  });

  it("never names Hamilton in the signed-out header or phone drawer (James, 2026-10-15)", () => {
    const labels = [
      ...PUBLIC_NAV_ITEMS.flatMap((i) => [i.label, ...(i.groups ?? []).flatMap((g) => [g.heading ?? "", ...g.items.flatMap((x) => [x.label, x.description ?? ""])])]),
      ...MOBILE_NAV_SECTIONS.flatMap((s) => [s.heading ?? "", ...s.items.map((x) => x.label)]),
    ];
    for (const label of labels) expect(label).not.toMatch(/Hamilton/);
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
    expect(HEADER_CTA_NAV).toEqual({ label: "See plans", href: "/subscribe" });
    expect(PRO_PLANS_NAV).toEqual({ label: "See Hamilton plans", href: "/subscribe" });
  });

  it("gives the phone drawer the short grouped list", () => {
    expect(MOBILE_NAV_SECTIONS.map((s) => [s.heading ?? null, s.items.map((i) => i.label)])).toEqual([
      ["Product", ["Find your institution", "Bank Fee Index", "Market data", "Workspace"]],
      [null, ["Reports", "Pricing"]],
      ["Resources", ["Guides", "Methodology", "API"]],
    ]);
  });
});
