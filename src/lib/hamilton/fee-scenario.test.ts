import { describe, expect, it } from "vitest";
import { median, modelScenario, peerPosition, priceBands, quantile } from "./fee-scenario";

const peers = [0, 10, 25, 25, 30, 32, 35, 35];

describe("peerPosition", () => {
  it("counts peers above, at and below an amount", () => {
    expect(peerPosition(peers, 32)).toEqual({ n: 8, more: 2, same: 1, less: 5 });
  });
});

describe("modelScenario", () => {
  it("gives market position and a per-1,000 change without the bank's figures", () => {
    const r = modelScenario(peers, 32, 25);
    expect(r.peersMore).toBe(4);
    expect(r.per1000Delta).toBe(-7000);
    expect(r.annualDelta).toBeNull();
    expect(r.evidence).toBe("market");
  });

  it("sizes the yearly change from the bank's paid items and waiver rate", () => {
    const r = modelScenario(peers, 32, 25, { paidItems: 14500, waiverRate: 0.1 });
    expect(r.annualDelta).toBe(Math.round(-7 * 14500 * 0.9));
    expect(r.evidence).toBe("institution");
  });

  it("treats zero or missing paid items as no figure", () => {
    expect(modelScenario(peers, 32, 25, { paidItems: 0 }).annualDelta).toBeNull();
  });
});

describe("priceBands", () => {
  it("puts $0 in its own band and the rest by lower edge", () => {
    const bands = priceBands(peers, [1, 25, 30, 35]);
    expect(bands.map((b) => b.count)).toEqual([1, 1, 2, 2, 2]);
  });
});

describe("median and quantile", () => {
  it("match the usual definitions", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([25, 30, 35], 0.5)).toBe(30);
    expect(median([])).toBeNull();
  });
});
