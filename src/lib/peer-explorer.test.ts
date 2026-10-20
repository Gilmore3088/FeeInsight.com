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
  briefingSet,
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
  capPeerExplorerSet,
  peerSnapshot,
  SNAPSHOT_CAVEAT,
  carryExplorerState,
  comparisonTag,
  isComparisonProxy,
  rosterOrder,
  rosterPricing,
  signedPercent,
  shownLine,
  PEER_EXPLORER_MAX_SHOWN,
  BANKS_ONLY_METRO_KEY,
  homeMetroHasCreditUnions,
  HOME_METRO_NOTE,
  isHomeMetroKey,
  peerSetChipKey,
  isPeerSetVariant,
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
    // An asset-band set is titled by its band, so its chip names the peers' actual range.
    expect(whyThesePeers(set, "size")).toEqual(["Banks only", "Actual range: $2.1B to $6.1B", "Headquartered in 2 states"]);
    expect(whyThesePeers({ ...set, peers: set.peers.slice(0, 2), charterType: "credit_union" })).toEqual([
      "Credit unions only",
      "$2.1B to $3.1B in assets",
      "Headquartered in Florida",
    ]);
  });
});

describe("home metro with credit unions", () => {
  const mixed: PeerExplorerSet = {
    ...set,
    peers: [...set.peers.slice(0, 3).map((peer) => ({ ...peer, charter: "bank" })), { ...inst(6, 1.2e9, {}), name: "Tally Federal CU", charter: "credit_union" }],
    market: { name: "Tallahassee, FL", cities: [] },
  };

  it("should_say_whether_the_home_metro_holds_credit_unions_from_its_two_counts", () => {
    expect(homeMetroHasCreditUnions([{ key: "metro", count: 17 }, { key: BANKS_ONLY_METRO_KEY, count: 9 }])).toBe(true);
    expect(homeMetroHasCreditUnions([{ key: "metro", count: 9 }, { key: BANKS_ONLY_METRO_KEY, count: 9 }])).toBe(false);
    // No banks-only view offered (no bank there publishes fees): the metro set is all credit unions.
    expect(homeMetroHasCreditUnions([{ key: "metro", count: 4 }])).toBe(true);
    expect(homeMetroHasCreditUnions([{ key: "nearest", count: 25 }])).toBe(false);
  });

  it("should_name_banks_and_credit_unions_when_the_metro_set_holds_both", () => {
    expect(whyThesePeers(mixed, "metro")[0]).toBe("Banks and credit unions");
    expect(whyThesePeers({ ...mixed, peers: mixed.peers.slice(0, 3) }, BANKS_ONLY_METRO_KEY)[0]).toBe("Banks only");
  });

  it("should_say_what_the_metro_set_is_for_with_both_charters", () => {
    expect(purposeLine("metro", mixed)).toBe(
      "Banks and credit unions with branches in the Tallahassee, FL metro: the local competitors for deposits and customers. They range from $1.2B to $5.8B in assets, so compare prices here, not size.",
    );
    expect(purposeLine(BANKS_ONLY_METRO_KEY, { ...mixed, peers: mixed.peers.slice(0, 3) })).toBe(
      "Banks with branches in the Tallahassee, FL metro: the local competitors for deposits and customers. They range from $2.1B to $5.8B in assets, so compare prices here, not size.",
    );
    expect(HOME_METRO_NOTE).toBe(
      "Banks are counted by their branches in the metro (FDIC Summary of Deposits). Credit unions report no deposits by branch, so a credit union is counted when it has a branch in one of the metro's cities (NCUA branch file).",
    );
  });

  it("should_treat_the_banks_only_view_as_a_variant_of_the_home_metro_chip", () => {
    expect(isHomeMetroKey("metro")).toBe(true);
    expect(isHomeMetroKey(BANKS_ONLY_METRO_KEY)).toBe(true);
    expect(isHomeMetroKey("nearest")).toBe(false);
    expect(isPeerSetVariant(BANKS_ONLY_METRO_KEY)).toBe(true);
    expect(isPeerSetVariant("metro")).toBe(false);
    expect(peerSetChipKey(BANKS_ONLY_METRO_KEY)).toBe("metro");
    expect(peerSetChipKey("state")).toBe("state");
    expect(PEER_SET_PURPOSE_GROUP[BANKS_ONLY_METRO_KEY]).toBe("Market competitors");
  });

  it("should_keep_the_whole_sets_charters_when_a_mixed_set_is_capped", () => {
    const many: PeerExplorerSet = {
      ...set,
      peers: Array.from({ length: 60 }, (_, i) => ({ ...inst(i + 10, (i + 1) * 1e8, {}), charter: i === 0 ? "credit_union" : "bank" })),
    };
    const capped = capPeerExplorerSet(many, 50);
    expect(capped.peers.some((peer) => peer.charter === "credit_union")).toBe(false);
    expect(capped.whole?.charters).toEqual(["bank", "credit_union"]);
    expect(whyThesePeers(capped, "metro")[0]).toBe("Banks and credit unions");
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
    // A $0.03 gap on $8.48 is within 1%: about the same, with the gap still stated.
    expect(gapText(8.45, 8.48)).toEqual({ direction: "same", text: "About the same as the peer median: within 1% ($0.03 below)" });
    expect(gapText(10, 10)).toEqual({ direction: "same", text: "About the same as the peer median: within 1% (the same price)" });
  });
});

describe("equivalent products", () => {
  it("labels a value built from several prices as their middle, or overdraft's highest", () => {
    expect(comparisonLabel("monthly_maintenance", set.subject.fees.monthly_maintenance)).toBe("Comparison price: middle of 2 account prices, not a fee anyone is charged");
    expect(comparisonLabel("overdraft", { amount: 35, prices: [{ amount: 30, name: null, conditions: null }, { amount: 35, name: null, conditions: null }, { amount: 35, name: null, conditions: null }] })).toBe(
      "Comparison price: highest of 3 prices",
    );
    expect(comparisonLabel("overdraft", set.subject.fees.overdraft)).toBeNull();
    expect(comparisonLabel("atm_non_network", undefined)).toBeNull();
  });
});

describe("matrix", () => {
  it("bands a cell below, about the same (within 1%) or above its column median, and marks a missing one", () => {
    expect(matrixBand(10, 10)).toBe("same");
    expect(matrixBand(10.1, 10)).toBe("same");
    expect(matrixBand(8.45, 8.48)).toBe("same");
    expect(matrixBand(10.2, 10)).toBe("above");
    expect(matrixBand(9.8, 10)).toBe("below");
    expect(matrixBand(11.5, 10)).toBe("above");
    expect(matrixBand(8, 10)).toBe("below");
    expect(matrixBand(undefined, 10)).toBe("none");
    expect(matrixBand(5, undefined)).toBe("none");
    expect(matrixBand(0, 0)).toBe("same");
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
    expect(hamiltonPeerSetHref(323, [10], "Set", "overdraft", "2026-10-17")).toBe("/pro/settings?instId=323&peers=10&name=Set&fee=overdraft&asof=2026-10-17#peer-sets");
    expect(hamiltonPeerSetHref(323, [10], "Set", "overdraft", "not a date")).not.toContain("asof");
  });

  it("leaves the peers off when Hamilton could not hold them all", () => {
    const many = Array.from({ length: 26 }, (_, i) => i + 1);
    expect(hamiltonPeerSetHref(323, many, "Banks in Florida")).toBe("/pro/settings?instId=323&name=Banks+in+Florida#peer-sets");
  });

  it("lists the set to bring to Hamilton without claiming the link loads it", () => {
    const rows = briefingSet({ ...set, asOf: "2026-10-17" }, "Home metro", "monthly_maintenance", "Published prices against the peer median");
    expect(rows.map((row) => row.label)).toEqual(["Peer set", "Peers", "Fee", "Comparison", "Data as of"]);
    expect(rows[4].value).toBe("Oct 17, 2026");
    expect(rows.map((row) => row.value).join(" ")).not.toMatch(/link|carries|opens/i);
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
      "Banks in the same asset-size band that publish fees, for comparing published prices. All are headquartered in Florida. A pricing set: it is not the financial cohort under Financial performance, which is drawn from Call Report filings in the band.",
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
      "Of 3 compared fees, Bank 1 is above the peer median on 2, below on 0 and about the same on 1. Largest gap: Domestic wire, +$5.",
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
    expect(cellShade(5.53, values, 5.5)).toEqual({ band: "same", step: 0 });
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

describe("large sets", () => {
  /**
   * A heavy peer: all five fees, each from three account prices, one with a waiver note at the
   * 220-character limit, and a source link. Most published values have one price and no note.
   */
  const heavyPeer = (id: number): ExplorerInstitution => {
    const fee = {
      amount: 10 + (id % 7),
      prices: Array.from({ length: 3 }, (_, i) => ({ amount: 5 + i, name: `Checking account ${i} monthly service fee`, conditions: i === 0 ? "x".repeat(220) : null })),
      source: { url: `https://bank${id}.example.com/fee-schedule.pdf`, published: "2026-10-17" },
    };
    return { ...inst(id, id * 1e6, { monthly_maintenance: fee, overdraft: fee, wire_intl_outgoing: fee, atm_non_network: fee, wire_domestic_outgoing: fee }, "Springfield", id % 2 ? "IL" : "MO"), name: `Community Bank ${id} of Springfield` };
  };
  const big: PeerExplorerSet = {
    subject: heavyPeer(1),
    peers: Array.from({ length: 3000 }, (_, i) => heavyPeer(i + 2)),
    charterType: "bank",
    medians: { monthly_maintenance: { median: 13, peers: 3000 } },
  };

  it("ships the 50 closest in assets and keeps the whole set's counts and medians", () => {
    const capped = capPeerExplorerSet(big);
    expect(capped.peers).toHaveLength(PEER_EXPLORER_MAX_SHOWN);
    expect(capped.peers.map((p) => p.id).slice(0, 3)).toEqual([2, 3, 4]);
    expect(capped.medians).toBe(big.medians);
    expect(capped.whole).toEqual({ peers: 3000, publish: { monthly_maintenance: 3000, atm_non_network: 3000, wire_domestic_outgoing: 3000, wire_intl_outgoing: 3000, overdraft: 3000 }, states: ["IL", "MO"], assets: { min: 2e6, max: 3001e6 } });
    expect(feeCoverage(capped, "overdraft")).toEqual({ selected: 3000, publish: 3000 });
    expect(coverageLine(capped, "overdraft")).toBe("3,000 peers selected · 3,000 publish this fee");
    expect(whyThesePeers(capped)).toEqual(["Banks only", "$2M to $3B in assets", "Headquartered in 2 states"]);
    expect(shownLine(capped)).toBe("Showing the 50 closest in assets of 3,000 peers; medians use all 3,000.");
  });

  it("leaves a set at or under the cap as it is", () => {
    expect(capPeerExplorerSet(set)).toBe(set);
    expect(shownLine(set)).toBeNull();
  });

  it("keeps the serialized props for a heavy 3,000-member set under 200 KB", () => {
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
    // Uncapped, the same set is megabytes: the budget is a real limit, not a formality.
    expect(bytes({ set: big })).toBeGreaterThan(1_000_000);
    expect(bytes({ set: capPeerExplorerSet(big) })).toBeLessThan(200 * 1024);
  });
});

describe("peer pricing snapshot", () => {
  const withMedian = (median: number, peers = 16): PeerExplorerSet => ({ ...set, medians: { monthly_maintenance: { median, peers } } });
  const mm = (amount: number, prices?: number[]) => ({
    ...set,
    subject: { ...set.subject, fees: { monthly_maintenance: { amount, ...(prices ? { prices: prices.map((p) => ({ amount: p, name: null, conditions: null })) } : {}) } } },
  });

  it("reads broadly aligned within 1%, with the comparison price, both checking prices and the proxy note", () => {
    const s = { ...mm(8.45, [7.95, 8.95]), medians: withMedian(8.48).medians };
    expect(peerSnapshot(s, "nearest", "monthly_maintenance")).toEqual({
      headline: "Monthly maintenance is broadly aligned with similar-sized banks: within 1% of their median.",
      facts: [
        "Compared at $8.45, the middle of its two prices, against a peer median of $8.48 among 16 publishing peers.",
        "Its two checking prices are $7.95 and $8.95.",
        "$8.45 is a comparison price, not a fee anyone is charged.",
      ],
      caveat: SNAPSHOT_CAVEAT,
    });
  });

  it("puts the 1% edge in the right band", () => {
    // $10.10 on a $10 median is exactly 1%: broadly aligned. $10.11 is above.
    expect(peerSnapshot({ ...mm(10.1), medians: withMedian(10).medians }, "nearest", "monthly_maintenance").headline).toMatch(/broadly aligned/);
    expect(peerSnapshot({ ...mm(9.9), medians: withMedian(10).medians }, "nearest", "monthly_maintenance").headline).toMatch(/broadly aligned/);
    expect(peerSnapshot({ ...mm(10.11), medians: withMedian(10).medians }, "nearest", "monthly_maintenance").headline).toBe(
      "Monthly maintenance is $0.11 (1.1%) above the median of similar-sized banks.",
    );
    expect(peerSnapshot({ ...mm(9.89), medians: withMedian(10).medians }, "nearest", "monthly_maintenance").headline).toBe(
      "Monthly maintenance is $0.11 (1.1%) below the median of similar-sized banks.",
    );
  });

  it("states the dollar and percent gap above or below, in the set's own words", () => {
    expect(peerSnapshot({ ...mm(12), medians: withMedian(10).medians }, "size", "monthly_maintenance").headline).toBe(
      "Monthly maintenance is $2 (20%) above the median of similar-sized banks.",
    );
    expect(peerSnapshot({ ...mm(8), medians: withMedian(10).medians }, "metro", "monthly_maintenance").headline).toBe(
      "Monthly maintenance is $2 (20%) below the median of local competitors.",
    );
    expect(peerSnapshot({ ...mm(8), medians: withMedian(10).medians }, "state", "monthly_maintenance").headline).toBe(
      "Monthly maintenance is $2 (20%) below the median of banks in Florida.",
    );
    expect(peerSnapshot({ ...mm(8), medians: withMedian(10).medians, charterType: "credit_union" }, "regulator", "monthly_maintenance").headline).toBe(
      "Monthly maintenance is $2 (20%) below the median of credit unions with the same charter.",
    );
    expect(peerSnapshot({ ...mm(12), medians: withMedian(10).medians }, "nearest", "monthly_maintenance").facts).toEqual([
      "Its published price is $12, against a peer median of $10 among 16 publishing peers.",
    ]);
  });

  it("names overdraft's comparison price as its highest, a price it charges, so no proxy note", () => {
    const od = { ...set, subject: { ...set.subject, fees: { overdraft: { amount: 36, prices: [10, 25, 36].map((p) => ({ amount: p, name: null, conditions: null })) } } }, medians: { overdraft: { median: 32, peers: 16 } } };
    expect(peerSnapshot(od, "nearest", "overdraft").facts).toEqual([
      "Compared at $36, the highest of its three prices, against a peer median of $32 among 16 publishing peers.",
      "Its three prices are $10, $25 and $36.",
    ]);
  });

  it("says when the fee is not published or too few peers publish it", () => {
    expect(peerSnapshot(set, "nearest", "wire_intl_outgoing").headline).toBe("Bank 1 does not publish an international wire fee in the index.");
    expect(peerSnapshot({ ...mm(8), medians: {} }, "nearest", "monthly_maintenance").headline).toBe("Too few similar-sized banks publish a monthly maintenance fee for a median.");
  });

  it("never recommends a price or names a cause", () => {
    const forbidden = /\b(should|recommend\w*|consider|raise|lower(ing)?|cut|increase|decrease|reduce|because|due to|driven|caus\w*|opportunit\w*|overpriced|underpriced|too high|too low|must|need to)\b/i;
    const cases: PeerExplorerSet[] = [
      { ...mm(8.45, [7.95, 8.95]), medians: withMedian(8.48).medians },
      { ...mm(12), medians: withMedian(10).medians },
      { ...mm(8), medians: withMedian(10).medians },
      { ...mm(8), medians: {} },
      set,
    ];
    for (const s of cases) {
      for (const key of ["nearest", "size", "metro", "state", "district", "regulator", "other"]) {
        for (const fee of ["monthly_maintenance", "overdraft", "wire_intl_outgoing"] as const) {
          const out = peerSnapshot(s, key, fee);
          expect(`${out.headline} ${out.facts.join(" ")} ${out.caveat}`).not.toMatch(forbidden);
        }
      }
    }
  });
});

describe("comparison price as a proxy", () => {
  const p = (amount: number) => ({ amount, name: null, conditions: null });
  it("is a proxy only when it equals none of the prices behind it", () => {
    expect(isComparisonProxy({ amount: 8.45, prices: [p(7.95), p(8.95)] })).toBe(true);
    expect(isComparisonProxy({ amount: 8, prices: [p(5), p(8), p(11)] })).toBe(false);
    expect(isComparisonProxy({ amount: 36, prices: [p(30), p(36)] })).toBe(false);
    expect(isComparisonProxy({ amount: 8 })).toBe(false);
    expect(comparisonTag("monthly_maintenance", { amount: 8.45, prices: [p(7.95), p(8.95)] })).toBe("comparison price, not charged to anyone");
    expect(comparisonTag("overdraft", { amount: 36, prices: [p(30), p(36)] })).toBe("comparison price, its highest");
    expect(comparisonLabel("overdraft", { amount: 36, prices: [p(30), p(36)] })).toBe("Comparison price: highest of 2 prices");
  });

  it("writes a percent gap", () => {
    expect(signedPercent(12, 10)).toBe("+20%");
    expect(signedPercent(8.45, 8.48)).toBe("-0.4%");
    expect(signedPercent(10, 10)).toBe("0%");
    expect(signedPercent(5, 0)).toBeNull();
  });
});

describe("roster pricing", () => {
  it("lists the same institutions in the same order as coverage, with amount, gap and source", () => {
    const priced: PeerExplorerSet = {
      ...set,
      peers: set.peers.map((peer) => (peer.id === 2 ? { ...peer, fees: { ...peer.fees, monthly_maintenance: { amount: 10, source: { url: "https://bank2.example/fees.pdf", published: "2026-09-02" } } } } : peer)),
      medians: { monthly_maintenance: { median: 8, peers: 3 } },
    };
    const rows = rosterPricing(priced, "monthly_maintenance");
    expect(rows.map((row) => row.id)).toEqual(rosterOrder(priced).map((inst) => inst.id));
    expect(rows[0]).toMatchObject({ id: 1, subject: true, amount: 8.45, proxy: true, prices: [5, 11.9], gap: { dollars: "+$0.45", percent: "+5.6%", band: "above" } });
    expect(rows.find((row) => row.id === 2)).toMatchObject({ amount: 10, proxy: false, prices: [], gap: { dollars: "+$2", percent: "+25%", band: "above" }, source: { url: "https://bank2.example/fees.pdf", published: "2026-09-02" } });
    expect(rows.find((row) => row.id === 4)).toMatchObject({ amount: 6, gap: { dollars: "-$2", percent: "-25%", band: "below" } });
    expect(rows.find((row) => row.id === 5)).toMatchObject({ amount: null, gap: null, source: null });
  });

  it("has no gap without a median", () => {
    expect(rosterPricing({ ...set, medians: {} }, "monthly_maintenance").every((row) => row.gap === null)).toBe(true);
  });
});

describe("peer-set links keep the explorer's fee and view", () => {
  it("writes the fee always and the view unless it is the default", () => {
    expect(carryExplorerState("/institution/323?peers=metro#peers", { fee: "overdraft", view: "matrix" })).toBe("/institution/323?peers=metro&pfee=overdraft&pview=matrix#peers");
    expect(carryExplorerState("/institution/323?peers=metro&pview=matrix#peers", { fee: "monthly_maintenance", view: "distribution" })).toBe(
      "/institution/323?peers=metro&pfee=monthly_maintenance#peers",
    );
  });
});

describe("snapshot caveat", () => {
  it("is the fixed wording", () => {
    expect(SNAPSHOT_CAVEAT).toBe("This describes published pricing only. Account mix, waivers and actual fee revenue are not represented.");
  });
});
