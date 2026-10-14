import { describe, expect, it } from "vitest";
import { defaultPrices, filedVolumeEstimate, parseCount, parsePercent, parsePrices } from "./model-params";

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

describe("filedVolumeEstimate", () => {
  it("divides a single-fee filed line by today's price", () => {
    expect(filedVolumeEstimate({ annualIncome: 19_464_000 }, 30)).toBe(649_000);
    expect(filedVolumeEstimate({ annualIncome: 9_000 }, 30)).toBe(300);
  });

  it("gives nothing for a combined line, no price or no income", () => {
    expect(filedVolumeEstimate({ annualIncome: 19_464_000, combinedWith: "NSF" }, 30)).toBeNull();
    expect(filedVolumeEstimate({ annualIncome: 19_464_000 }, 0)).toBeNull();
    expect(filedVolumeEstimate({ annualIncome: 0 }, 30)).toBeNull();
    expect(filedVolumeEstimate(null, 30)).toBeNull();
  });
});
