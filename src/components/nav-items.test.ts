import { describe, expect, it } from "vitest";
import { navItemsFor } from "./nav-items";

describe("navItemsFor", () => {
  it("gives Pro users the Hamilton workspace menu, not the old tool names", () => {
    const labels = navItemsFor({ signedIn: true, isPro: true }).map((i) => i.label);
    expect(labels).toEqual(["This month", "My fees", "Try a price", "Reports"]);
    expect(labels).not.toContain("Analyze");
    expect(labels).not.toContain("Monitor");
  });
});
