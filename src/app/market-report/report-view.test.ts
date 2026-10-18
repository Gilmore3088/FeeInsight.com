import { describe, expect, it } from "vitest";
import type { ReportLine } from "@/lib/custom-report/analysis";
import type { CheckingLineupView } from "@/lib/custom-report/checking-lineup";
import type { RevenueContext } from "@/lib/custom-report/revenue-context";
import { bandText, comparedAt, countiesText, headlineFinding, leftOutNote, marketFinding, medianMethod, positionWord, priceText, reviewPriorities, widestGapFinding } from "./report-view";

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

describe("priorities for review", () => {
  const wires = [
    line("wire_domestic_outgoing", "Outgoing domestic wire", 35, [19, 25, 27.5, 30], "above_market"),
    line("wire_intl_outgoing", "Outgoing international wire", 75, [16, 43.125, 47.5, 50], "above_market"),
    line("monthly_maintenance", "Monthly maintenance (checking)", 7.95, [18, 8, 10, 11.5], "below_market"),
  ];
  const revenue: RevenueContext = {
    quarters: [{ quarter: "2026-Q2", thousands: 5656 }],
    trailingThousands: null,
    peer: { tierLabel: "$1B-$10B", medianThousands: 449, rank: 13, count: 872, population: "banks", feeShare: 0.087089, peerMedianFeeShare: 0.021662, peerShareCount: 869 },
  };

  it("names where to look from the report's own figures, never a price to change, each linked to its section", () => {
    const items = reviewPriorities(wires, { revenue, lineup: { peersWithLineup: 20 } as CheckingLineupView });
    expect(items).toEqual([
      { text: "Wires: investigate the two fees above the local middle 50% (outgoing domestic and outgoing international).", href: "#position" },
      { text: "Checking: compare equivalent account types and waiver conditions. Lineups are on file for 20 local competitors.", href: "#lineup" },
      { text: "Deposit service charges: 8.7% of revenue against a 2.2% median for 869 banks with $1B to $10B in assets.", href: "#revenue" },
    ]);
    expect(items.map((i) => i.text).join(" ")).not.toMatch(/\b(raise|lower|cut|increase|reduce|should)\b/i);
  });

  it("falls back to the dollar rank, and leaves out an item whose data is missing", () => {
    expect(reviewPriorities([lines[1]])).toEqual([]);
    const noShare = { ...revenue, peer: { ...revenue.peer!, feeShare: null } };
    expect(reviewPriorities([lines[0]], { revenue: noShare })).toEqual([
      { text: "Overdraft: investigate the fee above the local middle 50%.", href: "#position" },
      { text: "Deposit service charges: rank 13 of 872 banks with $1B to $10B in assets in dollars.", href: "#revenue" },
    ]);
  });

  it("says a credit union's share is of total income", () => {
    const cu = { ...revenue, peer: { ...revenue.peer!, population: "credit unions" as const, peerShareCount: 300 } };
    expect(reviewPriorities([], { revenue: cu })[0].text).toBe("Fee income: 8.7% of total income against a 2.2% median for 300 credit unions with $1B to $10B in assets.");
  });

  it("says beside each local median how it is built", () => {
    expect(medianMethod("monthly_maintenance")).toBe("Median of local competitors, each at the middle of its checking fees");
    expect(medianMethod("atm_non_network")).toBe("Median of local competitors, each at its domestic fee");
    expect(medianMethod("overdraft")).toBe("Median of local competitors, each at its standard fee");
    expect(medianMethod("stop_payment")).toBe("Median of local competitors, one fee each");
    expect(bandText("$1B-$10B")).toBe("$1B to $10B");
  });
});

describe("an incomplete comparison's wording", () => {
  const incomplete = { ...line("monthly_maintenance", "Monthly maintenance (checking)", 7.95, [20, 10, 14, 18], "below_market"), incomplete: [{ record_id: 140267, fee_name: "Monthly service charge (Everyday Checking)", amount: 8.95 }] };

  it("says the position rests on incomplete inputs", () => {
    expect(positionWord(incomplete)).toBe("Below, on incomplete inputs");
    expect(positionWord({ ...incomplete, incomplete: [] })).toBe("Below");
    expect(headlineFinding([lines[0], lines[1], incomplete])).toBe(
      "One of three compared fees sits above the local middle 50%; one sits inside it and one below. Monthly maintenance (checking) rests on incomplete inputs.",
    );
    expect(widestGapFinding("Capital City Bank", [incomplete])).toBe(
      "The widest gap is monthly maintenance: Capital City Bank's fee is $7.95, against a local median of $14 across 20 competitors, on incomplete inputs.",
    );
  });

  it("adds nothing when every compared line is complete", () => {
    expect(headlineFinding(lines)).not.toContain("incomplete");
    expect(widestGapFinding("Bank", lines)).not.toContain("incomplete");
  });
});
