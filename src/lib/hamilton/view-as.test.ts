import { describe, expect, it } from "vitest";
import { viewAsCustomerFromCookieHeader } from "./view-as";

describe("viewAsCustomerFromCookieHeader", () => {
  it("is on only when the cookie is exactly 1", () => {
    expect(viewAsCustomerFromCookieHeader("a=b; hamilton_view_as_customer=1")).toBe(true);
    expect(viewAsCustomerFromCookieHeader("hamilton_view_as_customer=0")).toBe(false);
    expect(viewAsCustomerFromCookieHeader(null)).toBe(false);
  });
});
