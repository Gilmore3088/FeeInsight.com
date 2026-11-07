import { describe, expect, it } from "vitest";
import { middleHalfText, ordinal, rankPhrase, type PlottedLine } from "./at-a-glance";

describe("the At a glance rank label", () => {
  it("reads as a percentile, not a count of competitors", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 50, 100].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "50th", "100th",
    ]);
  });
});

describe("the rank and middle-half wording", () => {
  const line = (own: number, peers: number[]) =>
    ({
      key: "monthly_maintenance",
      own: { amount: own },
      peers: { n: peers.length, p25: 0, p75: 0, median: 0 },
      peerFigures: peers.map((amount) => ({ amount })),
    }) as unknown as PlottedLine;

  it("should_say_highest_of_n_when_the_fee_is_above_every_competitor", () => {
    expect(rankPhrase(line(40, [10, 15, 20]), 100)).toBe("highest of 3 local competitors");
  });

  it("should_say_lowest_of_n_when_the_fee_is_below_every_competitor", () => {
    expect(rankPhrase(line(1, [10, 15, 20]), 0)).toBe("lowest of 3 local competitors");
  });

  it("should_hold_a_percentile_between_1st_and_99th_otherwise", () => {
    expect(rankPhrase(line(15, [10, 15, 20]), 99.6)).toBe("99th percentile among 3 local competitors");
    expect(rankPhrase(line(15, [10, 15, 20]), 50)).toBe("50th percentile among 3 local competitors");
  });

  it("should_not_print_a_one_price_middle_half_as_a_range", () => {
    expect(middleHalfText(15, 15)).toBe("all of the middle 50% at $15");
    expect(middleHalfText(10, 15)).toBe("middle 50% $10 to $15");
  });
});
