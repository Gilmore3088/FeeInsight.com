import { describe, expect, it } from "vitest";
import { navItemsFor } from "./nav-items";

describe("navItemsFor", () => {
  it("gives Pro users the Hamilton workspace menu, not the old tool names", () => {
    const labels = navItemsFor({ signedIn: true, isPro: true }).map((i) => i.label);
    expect(labels).toEqual(["Overview", "Ask Hamilton", "Research", "Try a price", "Reports", "Monitor", "Saved analyses"]);
    expect(labels).not.toContain("Analyze");
    expect(labels).not.toContain("Admin");
  });

  it("keeps Pricing in the menu for signed-in free users, who are the people upgrading", () => {
    expect(navItemsFor({ signedIn: true }).map((i) => i.label)).toContain("Pricing");
    expect(navItemsFor(null).map((i) => i.label)).toContain("Pricing");
  });
});
