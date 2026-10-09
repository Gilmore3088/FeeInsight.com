import { describe, expect, it } from "vitest";
import { buildMarketBranchFootprint } from "@/lib/data-store/branches";
import { MIN_LOCAL_PEERS_PER_LINE, type ReportLine } from "@/lib/custom-report/analysis";
import { footprintLine, unavailableStatus } from "./report-body";

const footprint = buildMarketBranchFootprint(
  2025,
  [
    { institution_id: 7, branches: 12, deposits: 168_000 },
    { institution_id: 8, branches: "1", deposits: "1000" },
    { institution_id: null, branches: 27, deposits: 1_831_000 },
  ],
  [
    { institution_id: 20, branches: "4" },
    { institution_id: 21, branches: 1 },
    { institution_id: 7, branches: 3 },
  ],
);

describe("footprintLine", () => {
  it("gives a bank its branches and local deposit share", () => {
    expect(footprintLine(footprint, 7)).toBe("12 branches · 8.4% of local deposits");
    expect(footprintLine(footprint, 8)).toBe("1 branch · under 0.1% of local deposits");
  });

  it("gives a credit union its branch count and no share", () => {
    expect(footprintLine(footprint, 20)).toBe("4 branches");
    expect(footprintLine(footprint, 21)).toBe("1 branch");
  });

  it("is null for an institution with no branches on file", () => {
    expect(footprintLine(footprint, 9)).toBeNull();
    expect(footprintLine(null, 7)).toBeNull();
  });
});

describe("buildMarketBranchFootprint", () => {
  it("keeps market totals to bank branches, which carry deposits", () => {
    expect(footprint.totalBranches).toBe(40);
    expect(footprint.totalDeposits).toBe(2_000_000_000);
    expect(footprint.byInstitution[20]).toEqual({ branches: 4, deposits: null });
  });
});

describe("cityLabel and placeLabel", () => {
  it("title-cases all-caps city names and keeps mixed case", async () => {
    const { cityLabel, placeLabel } = await import("./report-body");
    expect(cityLabel("READING")).toBe("Reading");
    expect(cityLabel("WILKES-BARRE")).toBe("Wilkes-Barre");
    expect(cityLabel("KING OF PRUSSIA")).toBe("King of Prussia");
    expect(cityLabel("McAllen")).toBe("McAllen");
    expect(cityLabel("Blue Bell")).toBe("Blue Bell");
    expect(placeLabel("READING, PA")).toBe("Reading, PA");
    expect(placeLabel("Ambler, PA")).toBe("Ambler, PA");
  });
});

describe("unavailableStatus", () => {
  const own: ReportLine["own"] = { amount: 3, fee_name: "Foreign ATM", source_url: null, updated_at: null, schedule_read_on: null, source_line: "Foreign ATM | $3" };
  const peers = (n: number): ReportLine["peers"] => ({ n, p25: 2, median: 3, p75: 4, min: 1, max: 5 });

  it("says the institution's fee was not found, not that there are too few competitors", () => {
    const status = unavailableStatus({ own: null, peers: peers(11), comparable: false })!;
    expect(status.label).toBe("Your fee not found");
    expect(status.detail).toContain("11 local competitors publish this fee");
    expect(status.detail).toContain("not the same as no fee");
    expect(status.action).toContain("Send your current fee schedule");
    expect(`${status.label} ${status.detail}`).not.toMatch(/\$0|too few|not enough/i);
  });

  it("says too few competitors, with the real threshold, when the institution's fee is on file", () => {
    const status = unavailableStatus({ own, peers: peers(5), comparable: false })!;
    expect(status.label).toBe("Too few local competitors");
    expect(status.detail).toBe(`Only 5 local competitors publish this fee; a comparison needs ${MIN_LOCAL_PEERS_PER_LINE}.`);
    expect(status.action).toContain("competitor schedules");
    expect(unavailableStatus({ own, peers: null, comparable: false })!.detail).toContain("No local competitor publishes");
  });

  it("names both missing inputs when neither is there", () => {
    const status = unavailableStatus({ own: null, peers: peers(1), comparable: false })!;
    expect(status.label).toBe("Your fee not found; too few competitors");
    expect(status.detail).toContain("only 1 local competitor publishes this fee");
    expect(status.detail).toContain(`(${MIN_LOCAL_PEERS_PER_LINE} needed)`);
    expect(status.action).toContain("Send your current fee schedule");
    expect(unavailableStatus({ own: null, peers: null, comparable: false })!.detail).toContain("and no local competitors publish");
  });

  it("is null for a compared line", () => {
    expect(unavailableStatus({ own, peers: peers(MIN_LOCAL_PEERS_PER_LINE), comparable: true })).toBeNull();
  });
});
