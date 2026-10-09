import { describe, expect, it } from "vitest";
import { asksIncomeLevel, asksIncomeWhy, explainIncome, incomeSplit, priceIndex, withIncomeSplit } from "./why";
import type { FeePositionRow } from "./types";

// Fixture rows for tests only; no figure here is live data.
const row = (feeCategory: string, current: number, median: number | null): FeePositionRow => ({
  feeCategory,
  displayName: feeCategory,
  current,
  band: median === null ? null : { p25: median - 2, median, p75: median + 2, n: 20 },
  peerLabel: "Banks, $300M to $1B in assets",
});

const intensity = (own: number | null, peerMedian: number | null) => ({
  quarterEnd: "2026-06-30",
  own,
  peerMedian,
  peers: 1413,
  peersBelow: 900,
});

describe("asksIncomeWhy", () => {
  it("catches why questions about fee income", () => {
    expect(asksIncomeWhy("Why is our fee income lower than peers?")).toBe(true);
    expect(asksIncomeWhy("What is driving our service charge revenue?")).toBe(true);
    expect(asksIncomeWhy("Why is our overdraft fee where it is?")).toBe(false);
    expect(asksIncomeWhy("How has our overdraft fee income trended?")).toBe(false);
  });

  it("catches questions about where fee income stands against peers", () => {
    expect(asksIncomeLevel("How does Space Coast's service-charge income compare with only credit unions over $1 billion?")).toBe(true);
    expect(asksIncomeLevel("What is the income level on service charges for the peer group")).toBe(true);
    expect(asksIncomeLevel("How has our overdraft fee income trended?")).toBe(false);
    expect(asksIncomeLevel("How does our overdraft fee compare?")).toBe(false);
  });
});

describe("priceIndex", () => {
  it("is the geometric mean of each fee over its median, skipping free fees and thin bands", () => {
    const index = priceIndex([row("overdraft", 33, 30), row("nsf", 30, 30), row("wire", 0, 25), row("stop", 30, null)]);
    expect(index?.fees).toBe(2);
    expect(index?.ratio).toBeCloseTo(Math.sqrt(1.1), 6);
  });
});

describe("incomeSplit", () => {
  it("splits the income gap so the price part and the rest add up on a log scale", () => {
    // Income 21% higher; prices 10% higher on both fees: price is half the gap (1.1 x 1.1 = 1.21).
    const split = incomeSplit(intensity(1.21, 1), [row("overdraft", 33, 30), row("nsf", 33, 30)], "banks with $300M to $1B in assets");
    expect(split?.priceShare).toBe(50);
    expect(split?.percentile).toBe(64);
  });

  it("gives no share when price pulls the other way", () => {
    const split = incomeSplit(intensity(1.3, 1), [row("overdraft", 27, 30)], "Banks");
    expect(split?.priceShare).toBeNull();
    expect(explainIncome(split!).shortAnswer).toContain("Price does not explain the gap");
  });

  it("returns null without the bank's own income or a peer median", () => {
    expect(incomeSplit(intensity(null, 1), [row("overdraft", 30, 30)], "Banks")).toBeNull();
    expect(incomeSplit(intensity(1, null), [row("overdraft", 30, 30)], "Banks")).toBeNull();
  });
});

describe("explainIncome", () => {
  it("leads with the income figure, then price, then the share price accounts for", () => {
    const split = incomeSplit(intensity(0.28, 1.02), [row("overdraft", 25, 30), row("nsf", 27, 30)], "banks with $300M to $1B in assets")!;
    const { shortAnswer, facts } = explainIncome(split);
    expect(shortAnswer).toMatch(/^Your deposit service charges came to \$0\.28 per \$1,000 of deposits over the four quarters to June 30, 2026\./);
    expect(shortAnswer).toContain("73% lower than the median ($1.02) of 1,413 banks with $300M to $1B in assets.");
    expect(shortAnswer).toContain("your published prices sit 13% lower than their peer medians on average");
    expect(shortAnswer).toMatch(/Price accounts for about 11% of the income gap; the other 89% comes from how often/);
    expect(shortAnswer).not.toMatch(/\bshould\b|cheap/i);
    expect(facts[0].sampleSize).toBe(1413);
  });

  it("answers outright when the question named no fee", () => {
    const split = incomeSplit(intensity(1.21, 1), [row("overdraft", 33, 30)], "Banks")!;
    const response = withIncomeSplit(
      { kind: "clarifying_question", shortAnswer: "Which fee do you want to look at?", pageChange: { screen: "none" } },
      explainIncome(split),
    );
    expect(response.kind).toBe("research");
    expect(response.shortAnswer).not.toContain("Which fee");
  });
});

describe("explainIncome near the median", () => {
  it("says both sit close when neither gap is material", () => {
    const split = incomeSplit(intensity(4.63, 4.76), [row("atm", 3.62, 2.25), row("stop", 15, 29.5), row("od", 30, 30)], "credit unions")!;
    expect(explainIncome(split).shortAnswer).toContain("That is about the median");
  });
});
