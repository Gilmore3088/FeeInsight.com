import { describe, expect, it } from "vitest";
import { buildLayers, describePosition, parseLayer } from "./research-layers";
import { buildBriefingObservations, plainFeeName } from "./briefing-observations";
import type { PeerAmount } from "@/lib/data-store/fee-research";
import type { InstitutionPositioning } from "./institution-position";

const peer = (id: number, amount: number, over: Partial<PeerAmount> = {}): PeerAmount => ({
  institutionId: id,
  name: `I${id}`,
  stateCode: "TX",
  charterType: "bank",
  fedDistrict: 11,
  assetTier: "community",
  amount,
  ...over,
});

const self = { id: 1, stateCode: "TX", charterType: "bank", fedDistrict: 11, assetTier: "community" };

describe("buildLayers", () => {
  const peers = [
    peer(1, 35),
    peer(2, 0),
    peer(3, 30),
    peer(4, 35, { stateCode: "OK", fedDistrict: 10 }),
    peer(5, 25, { charterType: "credit_union" }),
  ];

  it("builds every layer from one read and leaves the bank out of its own comparison", () => {
    const layers = buildLayers(self, peers, 35, [32, 35]);
    expect(layers.map((l) => [l.key, l.n])).toEqual([
      ["local", 2],
      ["state", 3],
      ["district", 3],
      ["peers", 3],
      ["national", 4],
    ]);
    const state = layers.find((l) => l.key === "state")!;
    expect(state.zeroCount).toBe(1);
    expect(state.position).toEqual({ more: 0, same: 0, less: 3 });
    expect(describePosition(state, 35)).toBe("3 of 3 charge less, 0 charge more");
  });

  it("skips the local layer without branch data and marks thin layers", () => {
    const layers = buildLayers(self, peers, null, null);
    expect(layers[0].key).toBe("state");
    expect(layers[0].thin).toBe(true);
    expect(layers[0].position).toBeNull();
  });

  it("defaults an unknown layer to state", () => {
    expect(parseLayer("bogus")).toBe("state");
    expect(parseLayer("local")).toBe("local");
  });
});

describe("buildBriefingObservations", () => {
  const entry = (feeCategory: string, yourAmount: number, benchmarkMedian: number) => ({
    feeCategory,
    displayName: `${feeCategory} (X)`,
    yourAmount,
    benchmarkMedian,
    benchmarkP25: null,
    benchmarkP75: null,
    benchmarkCount: 40,
    maturityTier: "strong" as const,
    gapAmount: yourAmount - benchmarkMedian,
    gapPct: ((yourAmount - benchmarkMedian) / benchmarkMedian) * 100,
  });
  const positioning = {
    benchmarkLabel: "Texas community banks",
    entries: [entry("a", 30, 30), entry("b", 15, 10), entry("c", 5, 10), entry("d", 11, 10), entry("e", 40, 30)],
  } as unknown as InstitutionPositioning;

  it("picks the furthest from the middle and never advises", () => {
    const obs = buildBriefingObservations(positioning);
    expect(obs.map((o) => o.feeCategory)).toEqual(["b", "c", "e"]);
    expect(obs[1].detail).toBe("50% below the middle of Texas community banks (40 institutions).");
    const text = obs.map((o) => o.headline + o.detail).join(" ");
    expect(text).not.toMatch(/raise|lower|should|recommend/i);
  });

  it("strips the abbreviation from display names", () => {
    expect(plainFeeName("Overdraft (OD)")).toBe("Overdraft");
  });
});
