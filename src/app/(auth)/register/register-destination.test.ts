import { describe, expect, it } from "vitest";
import { registerCategoryFor, registerDestinationFor, registerVariantFor } from "./register-destination";

describe("registerVariantFor", () => {
  it.each([
    [{ plan: null, intent: "fee-alert" }, "consumer"],
    [{ plan: null }, "consumer"],
    [{ plan: null, from: "/institution/3?fee=overdraft" }, "consumer"],
    [{ plan: "monthly" as const }, "professional"],
    [{ plan: null, intent: "professional" }, "professional"],
    [{ plan: null, from: "/subscribe?from=%2Fpro" }, "professional"],
    [{ plan: null, from: "/workspace-invite" }, "professional"],
    [{ plan: null, from: "/pro/reports?instId=2" }, "professional"],
    [{ plan: null, from: "/process" }, "consumer"],
    [{ plan: null, from: "https://evil.example/pro" }, "consumer"],
  ])("%j → %s", (input, expected) => {
    expect(registerVariantFor(input)).toBe(expected);
  });
});

describe("registerDestinationFor", () => {
  it("sends a plan signup to checkout", () => {
    expect(registerDestinationFor({ plan: "annual" })).toBe("/subscribe?plan=annual&checkout=1");
  });

  it("honours a safe return path over the category", () => {
    expect(registerDestinationFor({ plan: null, from: "/institution/3?fee=nsf", category: "overdraft" })).toBe(
      "/institution/3?fee=nsf",
    );
  });

  it("sends a guide reader to the lookup focused on their fee", () => {
    expect(registerDestinationFor({ plan: null, intent: "fee-alert", category: "overdraft" })).toBe(
      "/institutions?fee=overdraft",
    );
  });

  it("ignores an unknown category and an external return path", () => {
    expect(registerDestinationFor({ plan: null, category: "not-a-fee" })).toBe("/account");
    expect(registerDestinationFor({ plan: null, from: "//evil.example" })).toBe("/account");
  });

  it("only accepts taxonomy categories", () => {
    expect(registerCategoryFor(" overdraft ")).toBe("overdraft");
    expect(registerCategoryFor("<script>")).toBeNull();
  });
});
