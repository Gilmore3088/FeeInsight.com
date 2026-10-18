import { describe, expect, it } from "vitest";
import { assetBandIndex, sharesByYear, subjectHistory, topShares, type CertYearRow } from "./market-position";
import { buildMetroMap } from "./geo/metro-market-map";

const names = new Map<number, string>([
  [1, "Subject Bank"],
  [2, "Big Bank"],
  [3, "Frost Bank"],
  [4, "Small Bank"],
]);

const rows: CertYearRow[] = [
  { year: 2025, cert: 10, institution_id: 1, deposits: 200, branches: 4 },
  { year: 2025, cert: 20, institution_id: 2, deposits: 500, branches: 9 },
  { year: 2025, cert: 30, institution_id: 3, deposits: 250, branches: 3 },
  { year: 2025, cert: 99, institution_id: null, deposits: 50, branches: 1 },
  { year: 2026, cert: 10, institution_id: 1, deposits: 300, branches: 5 },
  { year: 2026, cert: 20, institution_id: 2, deposits: 400, branches: 8 },
  { year: 2026, cert: 30, institution_id: 3, deposits: 250, branches: 3 },
  { year: 2026, cert: 40, institution_id: 4, deposits: 50, branches: 1 },
];

describe("sharesByYear", () => {
  const years = sharesByYear(rows, 1, names);

  it("keeps every bank's deposits in the total but leaves the excluded name off the ranks", () => {
    const y2026 = years.find((y) => y.year === 2026)!;
    expect(y2026.totalDeposits).toBe(1000);
    expect(y2026.institutions).toBe(3);
    expect(y2026.entries.map((e) => e.name)).toEqual(["Big Bank", "Subject Bank", "Small Bank"]);
    expect(y2026.entries[1]).toMatchObject({ sharePct: 30, rank: 2, subject: true, branches: 5 });
  });

  it("gives the subject's share, offices and rank each year", () => {
    expect(subjectHistory(years)).toEqual([
      { year: 2025, sharePct: 20, branches: 4, rank: 2, institutions: 3 },
      { year: 2026, sharePct: 30, branches: 5, rank: 2, institutions: 3 },
    ]);
  });

  it("appends the subject when it ranks below the chart's rows, and skips unnamed certificates", () => {
    const y2025 = years.find((y) => y.year === 2025)!;
    expect(topShares(y2025, 1).map((e) => e.name)).toEqual(["Big Bank", "Subject Bank"]);
    expect(topShares(y2025, 5).some((e) => e.name === null)).toBe(false);
  });
});

describe("assetBandIndex", () => {
  it("bands total assets stored in thousands", () => {
    expect(assetBandIndex(null)).toBe(-1);
    expect(assetBandIndex(500_000)).toBe(0);
    expect(assetBandIndex(4_300_000)).toBe(1);
    expect(assetBandIndex(50_000_000)).toBe(2);
    expect(assetBandIndex(2_000_000_000)).toBe(3);
  });
});

describe("buildMetroMap", () => {
  it("draws the metro's counties and places offices inside the frame", () => {
    // Leon County, FL (Tallahassee) and an office downtown.
    const map = buildMetroMap(["12073"], [{ latitude: 30.4383, longitude: -84.2807, inst: 0 }]);
    expect(map).not.toBeNull();
    expect(map!.counties.some((c) => c.inMetro)).toBe(true);
    expect(map!.counties.some((c) => !c.inMetro)).toBe(true);
    expect(map!.points).toHaveLength(3);
    expect(map!.points[2]).toBe(0);
  });

  it("returns null when no county is on file", () => {
    expect(buildMetroMap(["99999"], [])).toBeNull();
  });
});
