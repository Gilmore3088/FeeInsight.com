import { afterEach, describe, expect, it } from "vitest";
import {
  FIRST_TOUCH_STORAGE_KEY,
  MAX_LANDING_PATH_LENGTH,
  MAX_UTM_LENGTH,
  parseLandingPath,
  parseMarketingTouch,
  parseReferrerHost,
  parseUtmValue,
  readFirstTouch,
  saveFirstTouch,
  touchFromLocation,
} from "./marketing-touch";

describe("parseUtmValue", () => {
  it("keeps ordinary campaign tags, trimmed", () => {
    expect(parseUtmValue(" linkedin ")).toBe("linkedin");
    expect(parseUtmValue("market-spread_2026-10")).toBe("market-spread_2026-10");
    expect(parseUtmValue("overdraft:tampa")).toBe("overdraft:tampa");
  });

  it("drops empty, non-string, overlong and markup values", () => {
    expect(parseUtmValue("")).toBeNull();
    expect(parseUtmValue("   ")).toBeNull();
    expect(parseUtmValue(42)).toBeNull();
    expect(parseUtmValue(null)).toBeNull();
    expect(parseUtmValue("a".repeat(MAX_UTM_LENGTH))).toBe("a".repeat(MAX_UTM_LENGTH));
    expect(parseUtmValue("a".repeat(MAX_UTM_LENGTH + 1))).toBeNull();
    expect(parseUtmValue("<script>")).toBeNull();
    expect(parseUtmValue("a\nb")).toBeNull();
  });
});

describe("parseLandingPath", () => {
  it("keeps a same-site path and strips its query and hash", () => {
    expect(parseLandingPath("/for-institutions")).toBe("/for-institutions");
    expect(parseLandingPath("/research/overdraft?utm_source=x#top")).toBe("/research/overdraft");
  });

  it("rejects full URLs, protocol-relative paths and overlong paths", () => {
    expect(parseLandingPath("https://evil.example/")).toBeNull();
    expect(parseLandingPath("//evil.example/")).toBeNull();
    expect(parseLandingPath("relative")).toBeNull();
    expect(parseLandingPath(`/${"a".repeat(MAX_LANDING_PATH_LENGTH)}`)).toBeNull();
  });
});

describe("parseReferrerHost", () => {
  it("keeps a plain host, lowercased", () => {
    expect(parseReferrerHost("www.LinkedIn.com")).toBe("www.linkedin.com");
    expect(parseReferrerHost("lnkd.in.")).toBe("lnkd.in");
  });

  it("rejects anything that is not a host", () => {
    expect(parseReferrerHost("https://linkedin.com/feed")).toBeNull();
    expect(parseReferrerHost("bad host")).toBeNull();
    expect(parseReferrerHost("")).toBeNull();
    expect(parseReferrerHost(undefined)).toBeNull();
  });
});

describe("parseMarketingTouch", () => {
  it("returns every checked field", () => {
    expect(
      parseMarketingTouch({
        utm_source: "linkedin",
        utm_medium: "social",
        utm_campaign: "market-spread",
        utm_content: "tampa-overdraft",
        utm_term: "overdraft",
        landing_path: "/for-institutions",
        referrer_host: "www.linkedin.com",
      }),
    ).toEqual({
      utm_source: "linkedin",
      utm_medium: "social",
      utm_campaign: "market-spread",
      utm_content: "tampa-overdraft",
      utm_term: "overdraft",
      landing_path: "/for-institutions",
      referrer_host: "www.linkedin.com",
    });
  });

  it("nulls bad fields one by one and ignores fields it does not know", () => {
    const touch = parseMarketingTouch({ utm_source: "mailerlite", utm_term: "<x>", landing_path: "//x", ip: "1.2.3.4" });
    expect(touch).toEqual({
      utm_source: "mailerlite",
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      landing_path: null,
      referrer_host: null,
    });
    expect(touch).not.toHaveProperty("ip");
  });

  it("rejects input with no source, medium or campaign", () => {
    expect(parseMarketingTouch({ utm_content: "x", landing_path: "/" })).toBeNull();
    expect(parseMarketingTouch({ utm_source: "" })).toBeNull();
    expect(parseMarketingTouch(null)).toBeNull();
    expect(parseMarketingTouch("linkedin")).toBeNull();
    expect(parseMarketingTouch([{ utm_source: "linkedin" }])).toBeNull();
  });
});

describe("touchFromLocation", () => {
  it("reads utm_ values and the landing path from a URL", () => {
    expect(
      touchFromLocation(
        "https://feeinsight.com/research?utm_source=linkedin&utm_medium=social&utm_campaign=fee-depth&utm_content=nsf",
        "https://www.linkedin.com/feed/",
      ),
    ).toEqual({
      utm_source: "linkedin",
      utm_medium: "social",
      utm_campaign: "fee-depth",
      utm_content: "nsf",
      utm_term: null,
      landing_path: "/research",
      referrer_host: "www.linkedin.com",
    });
  });

  it("drops a same-site referrer and returns null without utm_ values", () => {
    expect(touchFromLocation("https://feeinsight.com/?utm_source=x", "https://feeinsight.com/about")?.referrer_host).toBeNull();
    expect(touchFromLocation("https://feeinsight.com/?src=x", "")).toBeNull();
    expect(touchFromLocation("not a url", "")).toBeNull();
  });
});

describe("first touch in sessionStorage", () => {
  afterEach(() => window.sessionStorage.clear());

  it("round-trips a saved touch", () => {
    const touch = touchFromLocation("https://feeinsight.com/?utm_source=mailerlite&utm_campaign=pulse", "")!;
    expect(saveFirstTouch(touch)).toBe(true);
    expect(readFirstTouch()).toEqual(touch);
  });

  it("re-checks stored values and ignores junk", () => {
    window.sessionStorage.setItem(FIRST_TOUCH_STORAGE_KEY, "{not json");
    expect(readFirstTouch()).toBeNull();
    window.sessionStorage.setItem(FIRST_TOUCH_STORAGE_KEY, JSON.stringify({ utm_source: "<script>" }));
    expect(readFirstTouch()).toBeNull();
  });
});
