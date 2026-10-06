import { describe, expect, it } from "vitest";
import {
  formatDollarsInWords,
  formatAmount,
  formatAssets,
  formatCompactDollars,
  formatStoredPercent,
} from "./format";

describe("formatAmount", () => {
  it("renders Postgres numeric strings as dollar amounts", () => {
    expect(formatAmount("35.00")).toBe("$35.00");
    expect(formatAmount("0.35")).toBe("$0.35");
    expect(formatAmount(5000)).toBe("$5,000.00");
  });

  it("renders invalid or missing amounts as unavailable", () => {
    expect(formatAmount(null)).toBe("-");
    expect(formatAmount(undefined)).toBe("-");
    expect(formatAmount("not-a-number")).toBe("-");
  });
});

describe("formatAssets", () => {
  it("renders trillion-scale FDIC asset values without collapsing to billions", () => {
    expect(formatAssets(3_813_431_000)).toBe("$3.8T");
  });

  it("keeps billion and million asset tiers readable", () => {
    expect(formatAssets(679_293_260)).toBe("$679.3B");
    expect(formatAssets(9_610_864)).toBe("$9.6B");
    expect(formatAssets(69_891)).toBe("$70M");
  });
});

describe("formatCompactDollars", () => {
  it("renders whole-dollar financial values without FDIC-thousands scaling", () => {
    expect(formatCompactDollars(208_795)).toBe("$209K");
    expect(formatCompactDollars(12_450_000)).toBe("$12.4M");
    expect(formatCompactDollars(3_813_431_000)).toBe("$3.8B");
  });
});

describe("formatStoredPercent", () => {
  it("formats stored percentage values without multiplying by 100", () => {
    expect(formatStoredPercent(13.456, 1)).toBe("13.5%");
    expect(formatStoredPercent(0.048, 2)).toBe("0.05%");
  });
});

describe("formatDollarsInWords", () => {
  it("writes totals in words of scale", () => {
    expect(formatDollarsInWords(209_400)).toBe("$209 thousand");
    expect(formatDollarsInWords(2_640_000)).toBe("$2.6 million");
    expect(formatDollarsInWords(5_160_000_000)).toBe("$5.2 billion");
    expect(formatDollarsInWords(3_000_000)).toBe("$3 million");
    expect(formatDollarsInWords(-15_500)).toBe("-$15.5 thousand");
    expect(formatDollarsInWords(640)).toBe("$640");
  });
});
