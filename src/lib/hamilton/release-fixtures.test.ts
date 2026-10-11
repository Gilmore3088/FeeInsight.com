import { describe, expect, it } from "vitest";
import { assertFixtureIsSynthetic, createHamiltonReleaseFixture } from "./release-fixtures";

describe("Hamilton H07 reusable acceptance fixture", () => {
  it("contains the two-user, Space Coast-home, peer, fee and correction cases H07 requires", () => {
    const fixture = createHamiltonReleaseFixture();
    expect(assertFixtureIsSynthetic(fixture)).toEqual([]);
    expect(fixture.users).toHaveLength(2);
    expect(fixture.institutions.find((institution) => institution.id === 8109)?.name).toBe("Synthetic Space Coast CU");
    expect(fixture.peerGroups.complete).toHaveLength(10);
    expect(fixture.peerGroups.complete.every((id) => fixture.institutions.find((institution) => institution.id === id)?.totalAssetsUsd !== null)).toBe(true);
    expect(fixture.peerGroups.complete).not.toContain(9105);
    expect(fixture.peerGroups.thin.length).toBeLessThan(10);
  });

  it("keeps asset zero/missing semantics and different reporting dates available to acceptance tests", () => {
    const fixture = createHamiltonReleaseFixture();
    expect(fixture.institutions.some((institution) => institution.totalAssetsUsd === null && institution.assetReportDate === null)).toBe(true);
    expect(new Set(fixture.institutions.map((institution) => institution.assetReportDate).filter(Boolean)).size).toBeGreaterThan(1);
  });

  it("contains a genuine $0 fee, an unknown amount and a rate without conflating them", () => {
    const fixture = createHamiltonReleaseFixture();
    expect(fixture.fees.some((fee) => fee.amount === 0 && fee.unit === "usd")).toBe(true);
    expect(fixture.fees.some((fee) => fee.amount === null && fee.ratePercent === null)).toBe(true);
    expect(fixture.fees.some((fee) => fee.amount === null && fee.ratePercent === 3 && fee.unit === "percent")).toBe(true);
  });

  it("includes saved-answer authorization and legacy-context negative cases", () => {
    const fixture = createHamiltonReleaseFixture();
    expect(fixture.savedAnalyses.find((analysis) => analysis.id === "fixture-analysis-legacy")).toMatchObject({
      institutionId: null,
      legacyMissingContext: true,
    });
    expect(fixture.savedAnalyses.find((analysis) => analysis.id === "fixture-analysis-other-user")?.userId)
      .not.toBe(fixture.users[0].id);
  });

  it("models old held evidence, a reviewed correction and a newer unresolved source", () => {
    const statuses = createHamiltonReleaseFixture().correctionHistory.versions.map((version) => version.status);
    expect(statuses).toEqual(["held", "published", "proposed"]);
  });

  it("returns a fresh deep fixture for every acceptance case", () => {
    const first = createHamiltonReleaseFixture();
    const second = createHamiltonReleaseFixture();
    first.peerGroups.complete.splice(0);
    first.users[0].label = "mutated";
    expect(second.peerGroups.complete).toHaveLength(10);
    expect(second.users[0].label).toBe("Synthetic primary analyst");
  });

  it("uses only the reserved fixture.invalid domain for fee source URLs", () => {
    const fixture = createHamiltonReleaseFixture();
    expect(fixture.fees.every((fee) => new URL(fee.sourceUrl).hostname === "fixture.invalid")).toBe(true);
  });
});
