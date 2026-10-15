import { describe, expect, it } from "vitest";
import { buildFindings } from "./findings";
import type { HeadlineRow, MarketBand } from "./market-position";

const band = (median: number, institutions = 40): MarketBand => ({
  min: 0,
  p25: median * 0.8,
  median,
  p75: median * 1.2,
  max: median * 2,
  institutions,
});

const row = (category: string, label: string, amount: number, median: number): HeadlineRow => ({
  category,
  label,
  amount,
  spread: null,
  sourceUrl: `https://bank.example/${category}.pdf`,
  state: band(median, 71),
  nation: band(median, 1200),
});

const counts = { below: 3, within: 18, above: 4 };

describe("buildFindings", () => {
  it("leads with the fees furthest above and below their state median, each sourced", () => {
    const findings = buildFindings({
      rows: [
        row("overdraft", "Overdraft", 40, 30),
        row("monthly_maintenance", "Monthly Maintenance", 4, 10),
        row("nsf", "NSF", 31, 30),
      ],
      stateGroup: "Texas banks",
      stateCode: "TX",
      peerRank: null,
      peerGroup: null,
      positionCounts: counts,
    });
    expect(findings).toHaveLength(3);
    expect(findings[0]).toMatchObject({ key: "fee-overdraft", figure: "+$10", tone: "above", comparedWith: "71 Texas banks" });
    expect(findings[0].text).toBe("Its overdraft fee is $40, $10 above the $30 median of 71 Texas banks.");
    expect(findings[0].sourceUrl).toBe("https://bank.example/overdraft.pdf");
    expect(findings[1]).toMatchObject({ key: "fee-monthly_maintenance", figure: "−$6", tone: "below" });
    expect(findings[2]).toMatchObject({ key: "spread", figure: "4 of 25" });
  });

  it("never leads with a $0 fee and uses the peer rank for a fee it has not used", () => {
    const findings = buildFindings({
      rows: [row("overdraft", "Overdraft", 0, 30), row("nsf", "NSF", 40, 30)],
      stateGroup: "Florida banks",
      stateCode: "FL",
      peerRank: {
        scope: "state",
        state_code: "FL",
        fed_district: 6,
        charter_type: "bank",
        lines: [{ key: "monthly_maintenance", own: 8.45, lower: 10, same: 0, higher: 13, peers: 23 }],
      },
      peerGroup: "Florida banks",
      positionCounts: counts,
    });
    expect(findings.map((f) => f.key)).toEqual(["fee-nsf", "rank-monthly_maintenance", "spread"]);
    expect(findings[1].text).toBe(
      "Of 23 Florida banks that publish a monthly maintenance fee, 13 charge more than its $8.45 and 10 charge less.",
    );
  });

  it("keeps an acronym's capitals inside a sentence", () => {
    const findings = buildFindings({
      rows: [{ ...row("atm_non_network", "Non-Network ATM", 3, 3), nation: band(1.5, 1638) }],
      stateGroup: "Florida banks",
      stateCode: "FL",
      peerRank: null,
      peerGroup: null,
      positionCounts: { below: 0, within: 1, above: 0 },
    });
    expect(findings[0].text).toBe("Its non-network ATM fee is $3, $1.50 above the $1.50 median of 1,638 U.S. institutions.");
  });

  it("falls back to the national market when every fee sits inside the state's middle half", () => {
    const wire: HeadlineRow = { ...row("wire_domestic_outgoing", "Wire Transfer (Domestic Outgoing)", 35, 30), nation: band(25, 900) };
    const findings = buildFindings({
      rows: [row("overdraft", "Overdraft (OD)", 30, 30), wire],
      stateGroup: "Florida banks",
      stateCode: "FL",
      peerRank: null,
      peerGroup: null,
      positionCounts: { below: 1, within: 2, above: 1 },
    });
    expect(findings[0]).toMatchObject({ key: "fee-wire_domestic_outgoing", figure: "+$10", comparedWith: "900 U.S. institutions" });
    expect(findings[0].text).toBe("Its wire transfer fee is $35, $10 above the $25 median of 900 U.S. institutions.");
    expect(findings[1].text).toBe("Its overdraft fee, $30, sits inside the middle half of 71 Florida banks.");
  });
});
