import { describe, expect, it } from "vitest";
import robots from "./robots";

/** Every filtered view of the /fees explorer; /fees itself stays crawlable. */
const FEE_EXPLORER_VIEWS = "/fees?";

describe("robots", () => {
  const rules = () => [robots().rules].flat();
  const rule = () => rules()[0];

  it("keeps crawlers out of the /fees explorer's filter views but not /fees itself", () => {
    const disallow = [rule().disallow ?? []].flat();
    expect(disallow).toContain(FEE_EXPLORER_VIEWS);
    expect(disallow).not.toContain("/fees");
    expect(disallow.some((path) => "/fees".startsWith(path) && path !== "/")).toBe(false);
  });

  it("still allows the site and its guide pages", () => {
    expect(rule().allow).toBe("/");
    const disallow = [rule().disallow ?? []].flat();
    for (const page of ["/fees/overdraft", "/fees/city/tx/austin", "/institution/23"]) {
      expect(disallow.some((path) => page.startsWith(path))).toBe(false);
    }
  });

  // 2026-11-01: Amazonbot's walk of uncached institution pages kept them past their read budget.
  it("keeps Amazonbot off institution pages and holds it to the shared rules", () => {
    const amazon = rules().find((r) => [r.userAgent].flat().includes("Amazonbot"));
    const disallow = [amazon?.disallow ?? []].flat();
    expect(disallow).toContain("/institution/");
    for (const path of [rule().disallow ?? []].flat()) expect(disallow).toContain(path);
    expect([rule().disallow ?? []].flat()).not.toContain("/institution/");
  });
});
