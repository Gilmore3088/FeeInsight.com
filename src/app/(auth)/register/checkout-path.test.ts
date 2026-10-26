import { describe, expect, it } from "vitest";
import { checkoutPathFor } from "./checkout-path";

describe("checkoutPathFor", () => {
  it("should_land_on_subscribe_with_checkout_when_no_from", () => {
    expect(checkoutPathFor("annual", undefined)).toBe("/subscribe?plan=annual&checkout=1");
  });

  it("should_preserve_subscribe_query_and_add_checkout", () => {
    const result = checkoutPathFor("annual", "/subscribe?invite=workspace&plan=annual");
    const url = new URL(result, "https://internal.invalid");
    expect(url.pathname).toBe("/subscribe");
    expect(url.searchParams.get("invite")).toBe("workspace");
    expect(url.searchParams.get("plan")).toBe("annual");
    expect(url.searchParams.get("checkout")).toBe("1");
  });

  it("should_carry_non_subscribe_from_as_return_path", () => {
    const result = checkoutPathFor("annual", "/institution/42");
    const url = new URL(result, "https://internal.invalid");
    expect(url.pathname).toBe("/subscribe");
    expect(url.searchParams.get("from")).toBe("/institution/42");
    expect(url.searchParams.get("checkout")).toBe("1");
  });

  it("should_reject_external_from", () => {
    expect(checkoutPathFor("annual", "https://evil.example/x")).toBe(
      "/subscribe?plan=annual&checkout=1",
    );
  });
});
