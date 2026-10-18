import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPeerFinancialRows, peerLinesFor, quarterOfDate, type ReportPeerContext } from "./peer-context";
import { PeerSection, rankText } from "@/app/market-report/peer-section";

describe("report peer context", () => {
  it("takes only the lines the report prices, with the amount the report shows", () => {
    expect(peerLinesFor([{ key: "overdraft", own: { amount: 35 } }, { key: "nsf", own: null }, { key: "stop_payment" }])).toEqual([["overdraft", 35]]);
  });

  it("sets reported figures in percent and drops a missing or zero line rather than showing zero", () => {
    const rows = buildPeerFinancialRows(
      { fee_income_ratio: 0.052, roa: 0, net_interest_margin: 3.41, efficiency_ratio: null },
      { fee_income_ratio: 0.04, roa: 1.1, net_interest_margin: 3.2, efficiency_ratio: 61 },
      { fee_income_ratio: 71, net_interest_margin: null },
    );
    expect(rows.map((r) => r.key)).toEqual(["fee_income_ratio", "net_interest_margin"]);
    expect(rows[0].own).toBeCloseTo(5.2);
    expect(rows[0].median).toBeCloseTo(4);
    expect(rows[1].percentile).toBeNull();
    expect(buildPeerFinancialRows({ efficiency_ratio: 340 }, { efficiency_ratio: 61 }, {})).toEqual([]);
  });

  it("names quarters and ranks in plain words", () => {
    expect(quarterOfDate("2026-06-30")).toBe("Q2 2026");
    expect(rankText(72)).toBe("Higher than 72% of peers");
    expect(rankText(30)).toBe("Lower than 70% of peers");
    expect(rankText(null)).toBe("Too few peers report it");
  });

  it("keeps pricing peers apart from local competitors and says which lines have too few peers", () => {
    const peers: ReportPeerContext = {
      groupLabel: "Banks with $1B to $10B in assets",
      fees: [{ key: "overdraft", own: 35, peerCount: 312, median: 32, p25: 30, p75: 35, percentile: 70 }],
      thinFeeKeys: ["paper_statement"],
      financial: { reportDate: "2026-06-30", source: "fdic", peerCount: 640, rows: [{ key: "fee_income_ratio", own: 5.2, median: 4, percentile: 71 }] },
    };
    const html = renderToStaticMarkup(<PeerSection name="Capital City Bank" peers={peers} />);
    expect(html).toContain("Capital City Bank beside banks with $1B to $10B in assets nationwide");
    expect(html).toContain("Q2 2026 FDIC Call Reports");
    expect(html).toContain("not the competitors in your market");
    expect(html).toContain('data-peer-fee="overdraft"');
    expect(html).toContain("$32");
    expect(html).toContain("$30 to $35");
    expect(html).toContain("640 peers filed");
    expect(html).toContain("312");
    expect(html).toContain("5.20%");
    expect(html).toContain("Higher than 71% of peers");
    expect(html).toMatch(/Too few of these peers publish paper statement/i);
    expect(html).not.toMatch(/Hamilton Pro|Frost/);
  });
});
