import { describe, expect, it } from "vitest";
import {
  dotPlot,
  niceCeil,
  openingGroup,
  openingPrice,
  ordinal,
  parseItems,
  parseWaiver,
  peerStrip,
  placePrice,
  sliderRange,
  tryPriceGroups,
  yearlyChange,
  type LayerInput,
} from "./try-price";

const layer = (key: string, amounts: number[], thin = amounts.length < 10): LayerInput => ({
  key,
  label: key === "state" ? "Ohio" : key,
  scope: "Synthetic group",
  n: amounts.length,
  minPeers: key === "local" ? 5 : 10,
  thin,
  amounts,
  p25: thin ? null : 25,
  median: thin ? null : 30,
  p75: thin ? null : 35,
});

describe("placePrice", () => {
  const ten = [10, 20, 25, 25, 30, 30, 32, 35, 35, 40];
  it("counts more, same and less with the half-cent tie and gives the mid-rank percentile", () => {
    const g = tryPriceGroups([layer("state", ten)])[0];
    const p = placePrice(g, 30.004);
    expect(p).toMatchObject({ n: 10, more: 4, same: 2, less: 4, percentile: 50, position: "in_range", min: 10, max: 40 });
    expect(placePrice(g, 36).position).toBe("above");
    expect(placePrice(g, 12).position).toBe("below");
  });

  it("gives no percentile or position below the median minimum, only the spread", () => {
    const g = tryPriceGroups([layer("state", [10, 20, 30])])[0];
    expect(g.p25).toBeNull();
    const p = placePrice(g, 25);
    expect(p.percentile).toBeNull();
    expect(p.position).toBe("too_few");
    expect([p.min, p.max]).toEqual([10, 30]);
  });
});

describe("helpers", () => {
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 63].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "63rd"]);
  });

  it("rounds the axis up to a plain figure", () => {
    expect([0, 3.4, 12, 46, 120].map(niceCeil)).toEqual([5, 4, 15, 50, 150]);
  });

  it("sets the slider above today's price and nearly every group price", () => {
    expect(sliderRange([{ amounts: [10, 25, 35, 37] }], 35, 35)).toEqual({ max: 50, step: 0.5 });
    expect(sliderRange([{ amounts: [0, 1, 2.5, 3] }], 3, 3)).toEqual({ max: 4, step: 0.05 });
  });

  it("reads typed counts and shares, and leaves bad input empty", () => {
    expect(parseItems("14,500")).toBe(14500);
    expect(parseItems("")).toBeNull();
    expect(parseItems("lots")).toBeNull();
    expect(parseItems("0")).toBeNull();
    expect(parseWaiver("12%")).toBeCloseTo(0.12);
    expect(parseWaiver("")).toBeNull();
    expect(parseWaiver("120")).toBeNull();
  });

  it("sizes fee income only from the bank's yearly count", () => {
    expect(yearlyChange(27, 35, null, 0.1)).toBeNull();
    // (35 - 27) x 14,500 x 0.9 = 104,400, the same arithmetic as the side-by-side table.
    expect(yearlyChange(27, 35, 14500, 0.1)).toBe(104400);
    expect(yearlyChange(null, 5, 100, null)).toBe(500);
    expect(yearlyChange(35, 30, 1000, 0)).toBe(-5000);
  });

  it("opens on a saved price, then a checked one, then a typed one, then today's", () => {
    expect(openingPrice({ saved: 20, checked: 30, typed: [40], current: 27 })).toBe(20);
    expect(openingPrice({ saved: null, checked: 30, typed: [40], current: 27 })).toBe(30);
    expect(openingPrice({ saved: null, checked: null, typed: [27, 40], current: 27 })).toBe(40);
    expect(openingPrice({ saved: null, checked: null, typed: [], current: 27 })).toBe(27);
    expect(openingPrice({ saved: null, checked: null, typed: [], current: null })).toBe(0);
  });

  it("opens on the state with a median, else the peer group, else the first group", () => {
    const ten = Array.from({ length: 10 }, (_, i) => i + 20);
    expect(openingGroup(tryPriceGroups([layer("peers", ten), layer("state", ten)]))).toBe("state");
    expect(openingGroup(tryPriceGroups([layer("peers", ten), layer("state", [1, 2])]))).toBe("peers");
    expect(openingGroup(tryPriceGroups([layer("local", [1, 2]), layer("state", [3])]))).toBe("local");
    expect(openingGroup([])).toBeNull();
  });

  it("drops layers with no published price", () => {
    expect(tryPriceGroups([layer("state", []), layer("national", [5])]).map((g) => g.key)).toEqual(["national"]);
  });
});

describe("dotPlot", () => {
  it("stacks one dot per institution and colours the peers among them", () => {
    const plot = dotPlot([10, 10, 20, 35], 50, [10, 35]);
    expect(plot.perDot).toBe(1);
    expect(plot.tallest).toBe(2);
    expect(plot.columns.map((c) => [c.count, c.peers])).toEqual([[2, 1], [1, 0], [1, 1]]);
    expect(plot.offScale).toBe(0);
  });

  it("lets a dot stand for several institutions in a large group and counts those off the scale", () => {
    const plot = dotPlot([...Array(100).fill(30), 500], 50, [], 60, 10);
    expect(plot.perDot).toBe(10);
    expect(plot.tallest).toBe(10);
    expect(plot.offScale).toBe(1);
    expect(plot.columns[plot.columns.length - 1].x).toBeGreaterThan(99);
  });
});

describe("peerStrip", () => {
  const member = (id: number, name: string, amount: number) => ({ institutionId: id, institutionName: name, amount });
  const base = { never: (n: string) => /frost bank|space coast/i.test(n), money: (n: number) => `$${n}` };

  it("lists a saved peer group lowest first and never names the excluded institutions", () => {
    const peers = { members: [member(1, "Synthetic B", 35), member(2, "Frost Bank", 10), member(3, "Synthetic A", 27)] };
    const strip = peerStrip({ ...base, peers, peersSaved: true, local: null });
    expect(strip?.title).toBe("Your saved peers");
    expect(strip?.tiles.map((t) => t.name)).toEqual(["Synthetic A", "Synthetic B"]);
  });

  it("falls back to local competitors when the default peer group is too large to list", () => {
    const peers = { members: Array.from({ length: 40 }, (_, i) => member(i, `Peer ${i}`, 30)) };
    const strip = peerStrip({ ...base, peers, peersSaved: false, local: [member(99, "Synthetic Local", 25)] });
    expect(strip?.title).toBe("Your local competitors");
    expect(strip?.tiles[0]).toMatchObject({ name: "Synthetic Local", label: "$25" });
    expect(peerStrip({ ...base, peers, peersSaved: false, local: null })).toBeNull();
  });

  it("states a range for a schedule with several fees", () => {
    const strip = peerStrip({ ...base, peers: { members: [{ ...member(1, "Synthetic C", 30), several: { low: 25, high: 35 } }] }, peersSaved: false, local: null });
    expect(strip?.tiles[0].label).toBe("$25 to $35");
  });
});
