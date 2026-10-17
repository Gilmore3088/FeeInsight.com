import { describe, expect, it } from "vitest";
import type { ReportLine } from "@/lib/custom-report/analysis";
import { comparedAt, countiesText, headlineFinding, leftOutNote, marketFinding, priceText, widestGapFinding } from "./report-view";

function line(key: string, label: string, own: number | null, peers: [number, number, number, number] | null, position: ReportLine["position"]): ReportLine {
  return {
    key,
    label,
    own: own === null ? null : { amount: own, fee_name: label, source_url: null, updated_at: null, schedule_read_on: null, source_line: label },
    peers: peers ? { n: peers[0], p25: peers[1], median: peers[2], p75: peers[3], min: peers[1], max: peers[3] } : null,
    comparable: own !== null && peers !== null && peers[0] >= 8,
    position,
    percentile: null,
    chargingLess: null,
    peerFigures: [],
  };
}

const lines = [
  line("overdraft", "Overdraft (OD)", 36, [20, 28, 30, 33], "above_market"),
  line("nsf", "NSF", 30, [18, 27, 30, 32], "in_market"),
  line("wire", "Wire, outgoing domestic", 15, [12, 20, 25, 30], "below_market"),
  line("stop", "Stop payment", 30, [4, 25, 30, 32], null),
  line("atm", "ATM, out of network", null, [15, 2, 3, 3], null),
];

describe("the report's section findings", () => {
  it("opens on the counts, in words", () => {
    expect(headlineFinding(lines)).toBe("One of three compared fees sits above the local middle 50%; one sits inside it and one below.");
    expect(headlineFinding([lines[1]])).toBe("The one compared fee sits inside the local middle 50%.");
  });

  it("names the widest gap and never calls a median a price", () => {
    const text = widestGapFinding("Capital City Bank", lines);
    expect(text).toBe(
      "The widest gap is wire, outgoing domestic: Capital City Bank's fee is $15, against a local median of $25 across 12 competitors.",
    );
    expect(text).not.toMatch(/charge/);
  });

  it("does not force a finding when every fee sits inside the middle 50%", () => {
    expect(widestGapFinding("Capital City Bank", [lines[1]])).toBe("Every compared fee sits inside the local middle 50%.");
  });

  it("says once which fees were left out and why", () => {
    expect(leftOutNote("Capital City Bank", lines)).toBe(
      "Not compared, because fewer than 8 local competitors publish them: Stop payment. Not found on Capital City Bank's published schedule: ATM, out of network.",
    );
    expect(leftOutNote("Capital City Bank", [lines[0]])).toBeNull();
  });

  it("shows a range for several prices and labels the compared value", () => {
    const own = { amount: 8.45, tiers: [{ amount: 7.95 }, { amount: 8.95 }] };
    expect(priceText(own)).toBe("$7.95 to $8.95, depending on account");
    expect(comparedAt("monthly_maintenance", own)).toBe("Compared at $8.45, the middle of its prices");
    expect(comparedAt("overdraft", { amount: 35, tiers: [{ amount: 20 }, { amount: 35 }] })).toBe(
      "Compared at $35, its standard fee, the highest of its prices",
    );
    expect(comparedAt("nsf", { amount: 30 })).toBeNull();
  });

  it("names the market's counties and counts", () => {
    expect(countiesText(["12073", "12039", "12129"])).toBe("Leon, Gadsden and Wakulla counties, FL");
    expect(countiesText(["12073"])).toBe("Leon County, FL");
    expect(marketFinding("Leon County, FL", 36, 30)).toBe("36 institutions identified in Leon County, FL; 30 publish fees this report can use.");
  });
});
