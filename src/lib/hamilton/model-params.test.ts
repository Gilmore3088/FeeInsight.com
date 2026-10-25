import { describe, expect, it } from "vitest";
import { defaultPrices, parseCount, parsePercent, parsePrices } from "./model-params";

describe("model params", () => {
  it("reads prices loosely and caps them", () => {
    expect(parsePrices("0, $25 37.50,25,abc,-3,1,2,3")).toEqual([0, 25, 37.5, 1]);
    expect(parsePrices(undefined)).toEqual([]);
  });

  it("reads counts and percents", () => {
    expect(parseCount("14,500")).toBe(14500);
    expect(parseCount("0")).toBeNull();
    expect(parsePercent("12%")).toBe(0.12);
    expect(parsePercent("120")).toBeNull();
  });

  it("starts with no fee, the market middle and five dollars more, never today's price", () => {
    expect(defaultPrices(32, 30)).toEqual([0, 30, 37]);
    expect(defaultPrices(30, 30)).toEqual([0, 35]);
    expect(defaultPrices(null, null)).toEqual([0]);
  });
});

describe("no volume estimate (#1896)", () => {
  it("offers no estimate of items a year; fee income comes only from the bank's own figures", async () => {
    const mod = await import("./model-params");
    expect(Object.keys(mod)).not.toContain("filedVolumeEstimate");
  });
});
