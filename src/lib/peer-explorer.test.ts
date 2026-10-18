import { describe, expect, it } from "vitest";
import {
  assetScale,
  coverageLine,
  feeCoverage,
  feeFindings,
  gapText,
  hamiltonPeerSetHref,
  linearScale,
  locationGroups,
  matrixBand,
  matrixRows,
  pricesSummary,
  scalePosition,
  whyThesePeers,
  type ExplorerInstitution,
  type PeerExplorerSet,
} from "./peer-explorer";

const inst = (id: number, assets: number | null, fees: ExplorerInstitution["fees"], city = "Tallahassee", state = "FL"): ExplorerInstitution => ({
  id,
  name: `Bank ${id}`,
  assets,
  city,
  state,
  fees,
});

const set: PeerExplorerSet = {
  subject: inst(1, 4.4e9, {
    monthly_maintenance: { amount: 8.45, prices: [{ amount: 5, name: "Basic Checking Monthly Service Fee", conditions: "Waived with $500 balance" }, { amount: 11.9, name: "Premier Checking Monthly Service Fee", conditions: null }] },
    overdraft: { amount: 35 },
  }),
  peers: [
    inst(2, 2.1e9, { monthly_maintenance: { amount: 10 }, overdraft: { amount: 30 } }),
    inst(3, 3.1e9, { monthly_maintenance: { amount: 8.45 } }),
    inst(4, 5.8e9, { monthly_maintenance: { amount: 6 }, overdraft: { amount: 36 } }, "Quincy"),
    inst(5, 6.1e9, {}, "Atlanta", "GA"),
  ],
  charterType: "bank",
  medians: { monthly_maintenance: { median: 8.45, peers: 3 } },
};

describe("peer explorer coverage", () => {
  it("counts the set and the peers that publish each fee separately", () => {
    expect(feeCoverage(set, "monthly_maintenance")).toEqual({ selected: 4, publish: 3 });
    expect(feeCoverage(set, "wire_intl_outgoing")).toEqual({ selected: 4, publish: 0 });
    expect(coverageLine(set, "overdraft")).toBe("4 peers selected · 2 publish this fee");
  });

  it("says why these peers belong from the set's own charter, assets and states", () => {
    expect(whyThesePeers(set)).toEqual(["Banks only", "$2.1B to $6.1B in assets", "Headquartered in 2 states"]);
    expect(whyThesePeers({ ...set, peers: set.peers.slice(0, 2), charterType: "credit_union" })).toEqual([
      "Credit unions only",
      "$2.1B to $3.1B in assets",
      "Headquartered in Florida",
    ]);
  });
});

describe("selection math", () => {
  it("names the peers charging less, the same and more than the selected institution", () => {
    expect(feeFindings(set, "monthly_maintenance", 1)).toEqual([
      { kind: "lower", label: "1 peer charges less", ids: [4] },
      { kind: "same", label: "1 peer charges the same", ids: [3] },
      { kind: "higher", label: "1 peer charges more", ids: [2] },
    ]);
    // With a peer selected, the subject counts among the others.
    expect(feeFindings(set, "monthly_maintenance", 2).map((f) => [f.kind, f.ids])).toEqual([["lower", [1, 3, 4]]]);
    // No finding for an institution that does not publish the fee.
    expect(feeFindings(set, "monthly_maintenance", 5)).toEqual([]);
  });

  it("states the gap from the median in dollars", () => {
    expect(gapText(8.45, 10)).toEqual({ direction: "below", text: "$1.55 below the peer median" });
    expect(gapText(12, 10)).toEqual({ direction: "above", text: "$2 above the peer median" });
    expect(gapText(10.004, 10).direction).toBe("same");
  });
});

describe("equivalent products", () => {
  it("labels a value built from several prices as their middle, or overdraft's highest", () => {
    expect(pricesSummary("monthly_maintenance", set.subject.fees.monthly_maintenance)).toBe("The middle of 2 prices");
    expect(pricesSummary("overdraft", { amount: 35, prices: [{ amount: 30, name: null, conditions: null }, { amount: 35, name: null, conditions: null }, { amount: 35, name: null, conditions: null }] })).toBe(
      "The highest of 3 prices",
    );
    expect(pricesSummary("overdraft", set.subject.fees.overdraft)).toBeNull();
    expect(pricesSummary("atm_non_network", undefined)).toBeNull();
  });
});

describe("matrix", () => {
  it("bands a cell below, near or above its column median, and marks a missing one", () => {
    expect(matrixBand(10, 10)).toBe("near");
    expect(matrixBand(10.9, 10)).toBe("near");
    expect(matrixBand(11.5, 10)).toBe("above");
    expect(matrixBand(8, 10)).toBe("below");
    expect(matrixBand(undefined, 10)).toBe("none");
    expect(matrixBand(5, undefined)).toBe("none");
    expect(matrixBand(0, 0)).toBe("near");
  });

  it("puts the subject first, then the peers by total assets, largest first", () => {
    expect(matrixRows(set).map((r) => r.id)).toEqual([1, 5, 4, 3, 2]);
  });
});

describe("locations", () => {
  it("groups by state when the set spans states, the subject's group first", () => {
    const { by, groups } = locationGroups(set);
    expect(by).toBe("state");
    expect(groups.map((g) => [g.name, g.members.map((m) => m.id)])).toEqual([
      ["Florida", [4, 1, 3, 2]],
      ["Georgia", [5]],
    ]);
  });

  it("groups by city when the whole set is in one state", () => {
    const { by, groups } = locationGroups({ ...set, peers: set.peers.slice(0, 3) });
    expect(by).toBe("city");
    expect(groups.map((g) => g.name)).toEqual(["Tallahassee, FL", "Quincy, FL"]);
  });
});

describe("scales", () => {
  it("keeps assets linear within tenfold and goes logarithmic beyond", () => {
    const linear = assetScale([2.1e9, 6.1e9]);
    expect(linear.kind).toBe("linear");
    expect(linear.min).toBeLessThanOrEqual(2.1e9);
    expect(linear.max).toBeGreaterThanOrEqual(6.1e9);
    const log = assetScale([4e7, 4e9]);
    expect(log.kind).toBe("log");
    expect([log.min, log.max]).toEqual([1e7, 1e10]);
    expect(scalePosition(log, 1e8)).toBeCloseTo(1 / 3);
  });

  it("starts the fee axis at zero with clean ticks", () => {
    expect(linearScale([5.9, 16.2], 4)).toEqual({ kind: "linear", min: 0, max: 20, ticks: [0, 5, 10, 15, 20] });
    expect(linearScale([0, 0]).max).toBeGreaterThan(0);
  });
});

describe("Hamilton hand-off", () => {
  it("carries the subject, the peers and the set's name to Hamilton's peer sets", () => {
    expect(hamiltonPeerSetHref(323, [10, 11, 10], "The 25 banks closest in assets")).toBe(
      "/pro/settings?instId=323&peers=10%2C11&name=The+25+banks+closest+in+assets#peer-sets",
    );
  });

  it("leaves the peers off when Hamilton could not hold them all", () => {
    const many = Array.from({ length: 26 }, (_, i) => i + 1);
    expect(hamiltonPeerSetHref(323, many, "Banks in Florida")).toBe("/pro/settings?instId=323&name=Banks+in+Florida#peer-sets");
  });
});
