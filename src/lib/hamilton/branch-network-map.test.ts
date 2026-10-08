import { describe, expect, it } from "vitest";
import { branchNetworkMap } from "./branch-network-map";

// Test figures only.
const cities = [
  { city: "Testville", state: "FL", branches: 9, lat: 28.1, lon: -80.65 },
  { city: "Southtown", state: "FL", branches: 7, lat: 25.77, lon: -80.19 },
  { city: "Nowhere", state: "FL", branches: 2, lat: null, lon: null },
];

describe("branchNetworkMap", () => {
  it("draws every located city with its count and shades the market county", () => {
    const svg = branchNetworkMap(cities, ["12009"])!;
    expect(svg).toContain("<svg");
    expect(svg.match(/<circle/g)).toHaveLength(2);
    expect(svg).toContain("Southtown <tspan");
    expect(svg).toContain("Brevard County: your market");
    expect(svg).not.toContain("Nowhere");
  });

  it("draws nothing when no city has a location", () => {
    expect(branchNetworkMap([cities[2]], ["12009"])).toBeNull();
  });
});
