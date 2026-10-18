import { describe, expect, it } from "vitest";
import {
  assetDifference,
  assetScale,
  cellShade,
  comparisonLabel,
  landscapeAxes,
  landscapeValue,
  matrixSummary,
  PEER_SET_PURPOSE_GROUP,
  percentileRank,
  purposeLine,
  signedMoney,
  sortMatrixRows,
  splitOutliers,
  coverageLine,
  feeCoverage,
  feeFindings,
  gapText,
  hamiltonPeerSetHref,
  linearScale,
  locationGroups,
  matrixBand,
  matrixRows,
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
    expect(comparisonLabel("monthly_maintenance", set.subject.fees.monthly_maintenance)).toBe("Comparison price: middle of 2 account prices");
    expect(comparisonLabel("overdraft", { amount: 35, prices: [{ amount: 30, name: null, conditions: null }, { amount: 35, name: null, conditions: null }, { amount: 35, name: null, conditions: null }] })).toBe(
      "Comparison price: highest of 3 prices",
    );
    expect(comparisonLabel("overdraft", set.subject.fees.overdraft)).toBeNull();
    expect(comparisonLabel("atm_non_network", undefined)).toBeNull();
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

  it("groups a metro set by the cities where each institution has a branch, one institution in several", () => {
    const metro = {
      ...set,
      market: {
        name: "Tallahassee, FL",
        cities: [
          { city: "QUINCY", state: "FL", ids: [2] },
          { city: "TALLAHASSEE", state: "FL", ids: [1, 2, 4, 99] },
        ],
      },
    };
    const { by, groups } = locationGroups(metro);
    expect(by).toBe("branch");
    // The subject's city first; an id outside the shown set is dropped.
    expect(groups.map((g) => [g.name, g.members.map((m) => m.id)])).toEqual([
      ["Tallahassee, FL", [4, 1, 2]],
      ["Quincy, FL", [2]],
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

  it("carries the selected fee to Hamilton", () => {
    expect(hamiltonPeerSetHref(323, [10], "Home metro", "monthly_maintenance")).toBe(
      "/pro/settings?instId=323&peers=10&name=Home+metro&fee=monthly_maintenance#peer-sets",
    );
  });
});

describe("peer set purpose", () => {
  it("groups the sets into pricing peers and market competitors", () => {
    expect(PEER_SET_PURPOSE_GROUP.nearest).toBe("Pricing peers");
    expect(PEER_SET_PURPOSE_GROUP.regulator).toBe("Pricing peers");
    expect(PEER_SET_PURPOSE_GROUP.metro).toBe("Market competitors");
  });

  it("states what the set is for and how spread out it is", () => {
    expect(purposeLine("nearest", set)).toBe("Banks of similar size, for comparing published prices. Not local competitors: they're spread over 2 states.");
    expect(purposeLine("size", { ...set, peers: set.peers.slice(0, 3) })).toBe(
      "Banks in the same asset-size band, for comparing published prices. All are headquartered in Florida.",
    );
    expect(purposeLine("metro", { ...set, market: { name: "Tallahassee, FL", cities: [] } })).toBe(
      "Banks with branches in the Tallahassee, FL metro: the local competitors for deposits and customers. They range from $2.1B to $6.1B in assets, so compare prices here, not size.",
    );
  });
});

describe("matrix investigation", () => {
  it("summarises where the subject sits and its largest gap", () => {
    const withWire: PeerExplorerSet = {
      ...set,
      subject: { ...set.subject, fees: { ...set.subject.fees, wire_domestic_outgoing: { amount: 30 } } },
      medians: { ...set.medians, overdraft: { median: 33, peers: 8 }, wire_domestic_outgoing: { median: 25, peers: 8 } },
    };
    expect(matrixSummary(withWire)).toBe(
      "Of 3 compared fees, Bank 1 is above the peer median on 1, below on 0 and near it on 2. Largest gap: Domestic wire, +$5.",
    );
    expect(matrixSummary({ ...set, medians: {} })).toBe("Bank 1 has no fee here with enough peers publishing it for a median.");
  });

  it("states asset and dollar differences with a sign", () => {
    expect(assetDifference(5.8e9, 4.4e9)).toBe("+$1.4B");
    expect(assetDifference(2.1e9, 4.4e9)).toBe("-$2.3B");
    expect(assetDifference(4.4e9, 4.4e9)).toBe("Same");
    expect(assetDifference(null, 4.4e9)).toBe("Not on record");
    expect(signedMoney(1.2)).toBe("+$1.20");
    expect(signedMoney(-0.5)).toBe("-$0.50");
    expect(signedMoney(0.001)).toBe("$0");
  });

  it("shades a cell by its band and how far into the cohort's tail it sits", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileRank(10, values)).toBeCloseTo(0.95);
    expect(percentileRank(1, values)).toBeCloseTo(0.05);
    expect(cellShade(10, values, 5.5)).toEqual({ band: "above", step: 3 });
    expect(cellShade(1, values, 5.5)).toEqual({ band: "below", step: 3 });
    expect(cellShade(5.6, values, 5.5)).toEqual({ band: "near", step: 0 });
    expect(cellShade(undefined, values, 5.5)).toEqual({ band: "none", step: 0 });
  });

  it("splits far outliers off only when asked, never dropping one", () => {
    const values = [10, 8, 9, 11, 10, 45];
    expect(splitOutliers(values, false)).toEqual({ shown: [8, 9, 10, 10, 11], outliers: [45] });
    expect(splitOutliers(values, true)).toEqual({ shown: [8, 9, 10, 10, 11, 45], outliers: [] });
    expect(splitOutliers([1, 2, 45], false).outliers).toEqual([]);
  });

  it("sorts rows with the subject always first and missing fees last", () => {
    expect(sortMatrixRows(set, "monthly_maintenance", "asc").map((r) => r.id)).toEqual([1, 4, 3, 2, 5]);
    expect(sortMatrixRows(set, "monthly_maintenance", "desc").map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(sortMatrixRows(set, "assets", "desc").map((r) => r.id)).toEqual([1, 5, 4, 3, 2]);
    expect(sortMatrixRows(set, "name", "asc").map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("landscape axes", () => {
  it("offers metro branches and deposit share only when the branch records are there", () => {
    expect(landscapeAxes(set)).toEqual(["assets"]);
    const metro: PeerExplorerSet = {
      ...set,
      market: { name: "Tallahassee, FL", cities: [], totalDeposits: 1000, presence: { 1: { branches: 15, deposits: 400 }, 2: { branches: 3, deposits: null } } },
    };
    expect(landscapeAxes(metro)).toEqual(["assets", "branches", "share"]);
    expect(landscapeValue(metro, metro.subject, "share")).toBeCloseTo(0.4);
    expect(landscapeValue(metro, metro.peers[0], "branches")).toBe(3);
    expect(landscapeValue(metro, metro.peers[0], "share")).toBeNull();
    expect(landscapeValue(metro, metro.peers[1], "branches")).toBeNull();
    expect(landscapeValue(metro, metro.subject, "assets")).toBe(4.4e9);
  });
});
