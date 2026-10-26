import { describe, expect, it } from "vitest";
import robots from "./robots";

/** Every filtered view of the /fees explorer; /fees itself stays crawlable. */
const FEE_EXPLORER_VIEWS = "/fees?";

describe("robots", () => {
  const rule = () => {
    const rules = robots().rules;
    return Array.isArray(rules) ? rules[0] : rules;
  };

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
});
