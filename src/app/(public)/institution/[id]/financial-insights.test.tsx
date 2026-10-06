import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FinancialInsights } from "./financial-insights";

describe("FinancialInsights", () => {
  it("renders growth, peer rank and flags with plain figures", () => {
    render(
      <FinancialInsights
        growth={[
          { key: "assets", label: "Total assets", kind: "balance", latest: 1_400_000_000, latestQuarter: "Q2 2026", qoq: 0.72, yoy: 40, cagr5: null, cagr10: 3.4 },
          { key: "members", label: "Members", kind: "count", latest: 82_909, latestQuarter: "Q2 2026", qoq: -1, yoy: null, cagr5: null, cagr10: null },
        ]}
        ranks={[
          { metric: "roa", label: "Return on assets", percentile: 2 },
          { metric: "fee_income_ratio", label: "Fee income share of revenue", percentile: 11 },
        ]}
        flags={[{ id: "net-loss", text: "Net loss over the four quarters to Q2 2026." }]}
        peerCount={894}
        peerQuarter="Q2 2026"
        charterLabel="Bank"
      />,
    );
    expect(screen.getByText("Worth a look")).toBeTruthy();
    expect(screen.getByText("Net loss over the four quarters to Q2 2026.")).toBeTruthy();
    expect(screen.getByText("+0.7%")).toBeTruthy();
    expect(screen.getByText("+40%")).toBeTruthy();
    expect(screen.getByText("82,909")).toBeTruthy();
    expect(screen.getByText("2nd percentile")).toBeTruthy();
    expect(screen.getByText("11th percentile")).toBeTruthy();
    expect(screen.getByText(/894 bank institutions in the same asset tier, Q2 2026/)).toBeTruthy();
  });

  it("renders nothing without data", () => {
    const { container } = render(
      <FinancialInsights growth={[]} ranks={[]} flags={[]} peerCount={null} peerQuarter={null} charterLabel="Bank" />,
    );
    expect(container.innerHTML).toBe("");
  });
});
