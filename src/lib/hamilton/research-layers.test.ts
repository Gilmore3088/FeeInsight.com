import { describe, expect, it } from "vitest";
import { belowPeerMinimum, describePosition, layersFromEngine, minPeersForLayer, parseLayer, summarizeLayer, thinLayerText } from "./research-layers";
import { MIN_LOCAL_PEERS_FOR_POSITION, MIN_PEERS_FOR_POSITION } from "./workspace/scenario";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";
import { plainFeeName } from "./briefing-observations";
import type { MarketLayer, PeerValue } from "./workspace/types";

const layer = (scope: MarketLayer["scope"], label: string, amounts: number[]): MarketLayer => ({
  scope,
  label,
  n: amounts.length,
  p25: null,
  median: null,
  p75: null,
  position: null,
  amounts,
  bands: [],
  members: [],
  asOf: "2026-10-01",
  source: { label: "published_fee_catalog" },
});

describe("layersFromEngine", () => {
  const engine = [
    layer("national", "National", [0, 25, 30, 35]),
    layer("charter_size", "Banks, $100M to $1B in assets", [0, 30, 35]),
    layer("state", "Texas", [0, 30, 35]),
    layer("fed_district", "Fed district 11 (Dallas)", [0, 30, 35]),
    layer("local", "Local market (Travis County, TX)", [32, 35]),
  ];
  const local = { basis: "branch_counties" as const, places: ["Travis County, TX"], sodYear: 2025, institutions: 40, source: { label: "SOD" } };

  it("orders layers nearest first and keeps the engine's amounts and dates", () => {
    const layers = layersFromEngine(engine, 35, local);
    expect(layers.map((l) => [l.key, l.n])).toEqual([
      ["local", 2],
      ["state", 3],
      ["district", 3],
      ["peers", 3],
      ["national", 4],
    ]);
    expect(layers[0].scope).toBe("Institutions with branches in Travis County, TX");
    expect(layers[3].label).toBe("Peer group");
    expect(layers[3].scope).toBe("Banks, $100M to $1B in assets, nationwide");
    expect(layers[1].asOf).toBe("2026-10-01");
    const state = layers[1];
    expect(state.zeroCount).toBe(1);
    expect(state.position).toEqual({ more: 0, same: 1, less: 2 });
    expect(describePosition(state, 35)).toBe("2 of 3 charge less, 1 charge the same, 0 charge more");
  });

  it("carries the engine's member list for the CSV", () => {
    const member = { institutionId: 7, institutionName: "Lone Star Bank", amount: 30, stateCode: "TX", sourceDocumentIds: [3], documentUrls: ["https://lonestar.example/fees.pdf"], publishedAt: "2026-09-30" };
    const layers = layersFromEngine([{ ...layer("state", "Texas", [30]), members: [member] }], 35, null);
    expect(layers[0].members).toEqual([member]);
  });

  it("marks thin layers and has no position without the bank's amount", () => {
    const layers = layersFromEngine(engine, null, null);
    expect(layers[1].thin).toBe(true);
    expect(layers[1].position).toBeNull();
  });

  it("defaults an unknown layer to state", () => {
    expect(parseLayer("bogus")).toBe("state");
    expect(parseLayer("local")).toBe("local");
  });
});

describe("Hamilton's median minimum (James, 2026-10-25)", () => {
  const amounts = (n: number) => Array.from({ length: n }, (_, i) => 20 + i);

  it("gives the local market a median from 5 institutions and every other layer from 10", () => {
    expect(minPeersForLayer("local")).toBe(MIN_LOCAL_PEERS_FOR_POSITION);
    for (const key of ["state", "district", "peers", "national"] as const) expect(minPeersForLayer(key)).toBe(MIN_PEERS_FOR_POSITION);

    const local4 = summarizeLayer("local", "Your market", "x", amounts(4), null);
    const local5 = summarizeLayer("local", "Your market", "x", amounts(5), null);
    expect(local4).toMatchObject({ thin: true, minPeers: 5, median: null, p25: null, p75: null, n: 4 });
    expect(local5).toMatchObject({ thin: false, minPeers: 5, median: 22 });

    const state9 = summarizeLayer("state", "Ohio", "x", amounts(9), null);
    const state10 = summarizeLayer("state", "Ohio", "x", amounts(10), null);
    expect(state9).toMatchObject({ thin: true, minPeers: 10, median: null, p25: null, p75: null, n: 9 });
    expect(state10.thin).toBe(false);
    expect(state10.median).not.toBeNull();
    expect(state10.p25).not.toBeNull();
  });

  it("keeps counts for a thin layer: where the bank sits and who charges nothing are counts, not a median", () => {
    const thin = summarizeLayer("peers", "Peer group", "x", [0, 25, 30], 28);
    expect(thin.thin).toBe(true);
    expect(thin.zeroCount).toBe(1);
    expect(thin.position).toEqual({ more: 1, same: 0, less: 2 });
    expect(thin.amounts).toEqual([0, 25, 30]);
  });

  it("does not use the public index's lower minimum for Hamilton layers", () => {
    expect(MIN_INSTITUTIONS_FOR_MEDIAN).toBe(5);
    expect(summarizeLayer("national", "National", "x", amounts(MIN_INSTITUTIONS_FOR_MEDIAN), null).thin).toBe(true);
  });

  const member = (institutionName: string, amount: number, institutionId: number, extra: Partial<PeerValue> = {}): PeerValue => ({
    institutionId, institutionName, amount, stateCode: "OH", sourceDocumentIds: [], documentUrls: [], publishedAt: "2026-09-30", ...extra,
  });
  const money = (n: number) => `$${n}`;

  it("writes a plain note and names every institution, lowest first, for a thin layer", () => {
    const [state] = layersFromEngine(
      [{ ...layer("state", "Ohio", [30, 25, 30]), members: [member("Harbor Savings", 30, 1), member("Bayside Bank", 25, 2), member("Alder Credit Union", 30, 3)] }],
      null,
      null,
    );
    expect(thinLayerText(state, money)).toEqual({
      note: "Only 3 institutions publish this fee here, fewer than the 10 needed for a median.",
      names: "Bayside Bank $25; Alder Credit Union $30; Harbor Savings $30",
    });

    const one = summarizeLayer("local", "Your market", "x", [12], null);
    expect(thinLayerText(one, money)?.note).toBe("Only 1 institution publishes this fee here, fewer than the 5 needed for a median.");
  });

  it("names an institution that states several fees by its range and each fee, never the median it counts at", () => {
    const several = { low: 25, high: 35, fees: [{ name: "Paper item", amount: 25 }, { name: "Electronic item", amount: 35 }] };
    const [state] = layersFromEngine(
      [{ ...layer("state", "Ohio", [28, 30]), members: [member("Harbor Savings", 28, 1), member("Bayside Bank", 30, 2, { several } as Partial<PeerValue>)] }],
      null,
      null,
    );
    const names = thinLayerText(state, money)?.names;
    expect(names).toBe("Harbor Savings $28; Bayside Bank $25 to $35 (Paper item $25; Electronic item $35)");
    expect(names).not.toContain("Bayside Bank $30");
  });

  it("counts sister charters on one schedule once, names each of them, and says why the names outnumber the count", () => {
    // Three institutions, two of them sisters sharing one schedule: the engine counts two amounts.
    const [state] = layersFromEngine(
      [{ ...layer("state", "Ohio", [25, 30]), members: [member("Harbor Savings", 30, 1), member("Harbor Savings of Dayton", 30, 4, { countedAs: 1 }), member("Bayside Bank", 25, 2)] }],
      null,
      null,
    );
    expect(state.n).toBe(2);
    expect(thinLayerText(state, money)).toEqual({
      note: "Only 2 institutions publish this fee here, fewer than the 10 needed for a median. Institutions that share one fee schedule count once, so 3 are named.",
      names: "Bayside Bank $25; Harbor Savings $30; Harbor Savings of Dayton $30",
    });
  });

  it("names nobody when the engine did not list every institution, and says nothing for an empty or full layer", () => {
    const partial = { ...summarizeLayer("state", "Ohio", "x", [25, 30], null), members: [member("Harbor Savings", 30, 1)] };
    expect(thinLayerText(partial, String)).toEqual({ note: "Only 2 institutions publish this fee here, fewer than the 10 needed for a median.", names: null });
    expect(thinLayerText(summarizeLayer("state", "Ohio", "x", [], null), String)).toBeNull();
    expect(thinLayerText(summarizeLayer("state", "Ohio", "x", amounts(12), null), String)).toBeNull();
  });
});

describe("plainFeeName", () => {
  it("strips the abbreviation from display names", () => {
    expect(plainFeeName("Overdraft (OD)")).toBe("Overdraft");
  });
});

describe("belowPeerMinimum", () => {
  it("needs 10 institutions for every layer but the local market, which needs 5", () => {
    for (const key of ["state", "district", "peers", "national"] as const) {
      expect(belowPeerMinimum({ key, n: 9 })).toBe(true);
      expect(belowPeerMinimum({ key, n: 5 })).toBe(true);
      expect(belowPeerMinimum({ key, n: 10 })).toBe(false);
    }
    expect(belowPeerMinimum({ key: "local", n: 4 })).toBe(true);
    expect(belowPeerMinimum({ key: "local", n: 5 })).toBe(false);
  });
});
