import { describe, expect, it } from "vitest";
import { feeIncomeAssumptions, median, modelScenario, peerPosition, priceBands, quantile } from "./fee-scenario";

const peers = [0, 10, 25, 25, 30, 32, 35, 35];

describe("peerPosition", () => {
  it("counts peers above, at and below an amount", () => {
    expect(peerPosition(peers, 32)).toEqual({ n: 8, more: 2, same: 1, less: 5 });
  });
});

describe("modelScenario", () => {
  it("gives market position and no fee income figure of any kind without the bank's volume (#1896)", () => {
    const r = modelScenario(peers, 32, 25);
    expect(r.peersMore).toBe(4);
    expect(r).not.toHaveProperty("per1000Delta");
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

describe("feeIncomeAssumptions (#1896)", () => {
  const base = { feeName: "Overdraft", current: 32, paidItems: 14500, waiverRate: 0.1, figuresFrom: "typed" as const };

  it("states nothing when the bank has not supplied its volume, since no fee income is shown", () => {
    expect(feeIncomeAssumptions({ ...base, paidItems: null })).toEqual([]);
    expect(feeIncomeAssumptions({ ...base, paidItems: 0 })).toEqual([]);
  });

  it("states every input and assumption behind the figure", () => {
    const a = feeIncomeAssumptions(base).join(" ");
    expect(a).toContain("Starting price: $32, your published overdraft fee.");
    expect(a).toContain("Items charged a year: 14,500, before waivers, your figure entered on this page.");
    expect(a).toContain("Share waived or refunded: 10%, your figure entered on this page.");
    expect(a).toContain("How customers respond to a price change is not estimated.");
    expect(a).toContain("stays the same at every price tested");
    expect(a).toContain("Calculation: change per item, times items charged a year, times the share not waived.");
    expect(a).toContain("not a prediction");
  });

  it("names a missing waiver share, a missing published price and saved figures plainly", () => {
    const a = feeIncomeAssumptions({ ...base, waiverRate: null, current: null, figuresFrom: "saved" }).join(" ");
    expect(a).toContain("Share waived or refunded: none, because no share was entered.");
    expect(a).toContain("Starting price: $0, because no overdraft fee is published for you.");
    expect(a).toContain("saved in My bank and data");
  });

  it("never calls the figure a forecast or projection", () => {
    const a = feeIncomeAssumptions(base).join(" ");
    expect(a).not.toMatch(/forecast|project(ed|ion)|will earn|expected revenue|—/i);
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
