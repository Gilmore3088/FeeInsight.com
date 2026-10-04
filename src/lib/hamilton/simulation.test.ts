import { describe, it, expect } from "vitest";
import {
  estimatePercentile,
  classifyRisk,
  computeFeePosition,
  computeTradeoffs,
  type DistributionData,
} from "./simulation";

const MOCK_DIST: DistributionData = {
  fee_category: "overdraft",
  median_amount: 35,
  p25_amount: 25,
  p75_amount: 45,
  min_amount: 5,
  max_amount: 75,
  institution_count: 40,
  approved_count: 30,
};

describe("estimatePercentile", () => {
  it("returns 0 for fee at or below min", () => {
    expect(estimatePercentile(5, MOCK_DIST)).toBe(0);
    expect(estimatePercentile(0, MOCK_DIST)).toBe(0);
  });

  it("returns 100 for fee at or above max", () => {
    expect(estimatePercentile(75, MOCK_DIST)).toBe(100);
    expect(estimatePercentile(100, MOCK_DIST)).toBe(100);
  });

  it("returns 50 for fee at median", () => {
    expect(estimatePercentile(35, MOCK_DIST)).toBe(50);
  });

  it("returns 25 for fee at p25", () => {
    expect(estimatePercentile(25, MOCK_DIST)).toBe(25);
  });

  it("returns 75 for fee at p75", () => {
    expect(estimatePercentile(45, MOCK_DIST)).toBe(75);
  });
});

describe("classifyRisk", () => {
  it("returns low for percentile below 50", () => {
    expect(classifyRisk(0)).toBe("low");
    expect(classifyRisk(49)).toBe("low");
  });

  it("returns medium for percentile 50-74", () => {
    expect(classifyRisk(50)).toBe("medium");
    expect(classifyRisk(74)).toBe("medium");
  });

  it("returns high for percentile 75+", () => {
    expect(classifyRisk(75)).toBe("high");
    expect(classifyRisk(100)).toBe("high");
  });
});

describe("computeFeePosition", () => {
  it("computes correct position for below-median fee", () => {
    const pos = computeFeePosition(20, MOCK_DIST);
    expect(pos.medianGap).toBe(-15);
    expect(pos.riskProfile).toBe("low");
    expect(pos.percentile).toBeLessThan(50);
  });

  it("computes correct position for above-p75 fee", () => {
    const pos = computeFeePosition(55, MOCK_DIST);
    expect(pos.riskProfile).toBe("high");
    expect(pos.percentile).toBeGreaterThan(75);
  });
});

describe("computeTradeoffs", () => {
  it("returns three tradeoff dimensions", () => {
    const current = computeFeePosition(35, MOCK_DIST);
    const proposed = computeFeePosition(45, MOCK_DIST);
    const tradeoffs = computeTradeoffs(35, 45, current, proposed);
    expect(tradeoffs).toHaveProperty("revenueImpact");
    expect(tradeoffs).toHaveProperty("riskMitigation");
    expect(tradeoffs).toHaveProperty("operationalImpact");
  });

  it("shows positive fee change direction", () => {
    const current = computeFeePosition(35, MOCK_DIST);
    const proposed = computeFeePosition(45, MOCK_DIST);
    const tradeoffs = computeTradeoffs(35, 45, current, proposed);
    expect(tradeoffs.revenueImpact.value).toContain("+");
  });
});
