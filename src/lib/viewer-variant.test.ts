import { describe, expect, it } from "vitest";
import { signSessionId } from "./session-cookie";
import { cityMetroPath, isSignedInVariantPath, signedInVariantPath } from "./viewer-variant";

const signed = signSessionId("a".repeat(64));

describe("signedInVariantPath", () => {
  it("sends a reader with a signed session to the per-request route", () => {
    expect(signedInVariantPath("/research/state/TX", signed)).toBe("/research/state/TX/signed-in");
    expect(signedInVariantPath("/research/district/11", signed)).toBe("/research/district/11/signed-in");
    expect(signedInVariantPath("/research/national-fee-index", signed)).toBe("/research/national-fee-index/signed-in");
  });

  it("serves the cached page with no cookie or a forged one", () => {
    expect(signedInVariantPath("/research/state/TX", undefined)).toBeNull();
    expect(signedInVariantPath("/research/state/TX", "")).toBeNull();
    expect(signedInVariantPath("/research/state/TX", `abc.${"0".repeat(64)}`)).toBeNull();
    expect(signedInVariantPath("/research/state/TX", "not-a-session")).toBeNull();
  });

  it("leaves every other page alone", () => {
    expect(signedInVariantPath("/research", signed)).toBeNull();
    expect(signedInVariantPath("/research/state/TX/signed-in", signed)).toBeNull();
    expect(signedInVariantPath("/research/market-concentration", signed)).toBeNull();
    expect(signedInVariantPath("/fees/city/tx/austin", signed)).toBeNull();
  });
});

describe("isSignedInVariantPath", () => {
  it("matches only the per-request routes of the cached pages", () => {
    expect(isSignedInVariantPath("/research/state/TX/signed-in")).toBe(true);
    expect(isSignedInVariantPath("/research/district/3/signed-in")).toBe(true);
    expect(isSignedInVariantPath("/research/national-fee-index/signed-in")).toBe(true);
    expect(isSignedInVariantPath("/research/state/TX")).toBe(false);
    expect(isSignedInVariantPath("/signed-in")).toBe(false);
    expect(isSignedInVariantPath("/research/articles/signed-in")).toBe(false);
  });
});

describe("cityMetroPath", () => {
  it("serves ?area=metro from the cached metro route", () => {
    expect(cityMetroPath("/fees/city/tx/austin", new URLSearchParams("area=metro&fee=nsf"))).toBe("/fees/city/tx/austin/metro");
    expect(cityMetroPath("/fees/city/mo/st.%20louis", new URLSearchParams("area=metro"))).toBe("/fees/city/mo/st.%20louis/metro");
  });

  it("leaves the city view and other pages alone", () => {
    expect(cityMetroPath("/fees/city/tx/austin", new URLSearchParams("fee=nsf&sort=low"))).toBeNull();
    expect(cityMetroPath("/fees/city/tx/austin", new URLSearchParams("area=city"))).toBeNull();
    expect(cityMetroPath("/fees/city/tx", new URLSearchParams("area=metro"))).toBeNull();
    expect(cityMetroPath("/fees/city/tx/austin/metro", new URLSearchParams("area=metro"))).toBeNull();
  });
});
