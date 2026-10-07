import { describe, expect, it } from "vitest";
import { describePosition, layersFromEngine, parseLayer } from "./research-layers";
import { plainFeeName } from "./briefing-observations";
import type { MarketLayer } from "./workspace/types";

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

describe("plainFeeName", () => {
  it("strips the abbreviation from display names", () => {
    expect(plainFeeName("Overdraft (OD)")).toBe("Overdraft");
  });
});
