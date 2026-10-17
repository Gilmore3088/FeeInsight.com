import { describe, expect, it } from "vitest";
import type { ReportLine } from "@/lib/custom-report/analysis";
import { leftOutNote, namedFinding, positionFinding, widestGapFinding } from "./report-view";

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
  it("counts fees above, inside and below the local middle 50%", () => {
    expect(positionFinding("Capital City Bank", lines)).toBe(
      "Of Capital City Bank's 3 compared fees, 1 sits above the local middle 50%, 1 inside it and 1 below it.",
    );
  });

  it("names the widest gap and never calls a median a price", () => {
    const text = widestGapFinding("Capital City Bank", lines);
    expect(text).toBe(
      "The widest gap is wire, outgoing domestic: $15 at Capital City Bank against a local median of $25 across 12 competitors.",
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

  it("gives the named competitors' published range on the first fee", () => {
    const competitors: { fees: Record<string, number> }[] = [{ fees: { overdraft: 35 } }, { fees: { overdraft: 29 } }, { fees: {} }];
    expect(namedFinding("Capital City Bank", { key: "overdraft", label: "Overdraft (OD)" }, 36, competitors)).toBe(
      "On overdraft, the 2 named competitors that publish it list $29 to $35; Capital City Bank's is $36.",
    );
    expect(namedFinding("Capital City Bank", { key: "overdraft", label: "Overdraft (OD)" }, 36, [competitors[0]])).toBeNull();
  });
});
