import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ComplaintChart, DepositStrip, IncomeLine, PriceMoves, StatePanel, incomeTrend, leadersShare } from "./district-hub";
import type { StateHubRow } from "./district-hub-view";

const row: StateHubRow = {
  code: "MO",
  name: "Missouri",
  institutions: 40,
  banks: 30,
  creditUnions: 10,
  withFees: 20,
  coveragePct: 50,
  fees: { overdraft: { median: 32, institutions: 12 }, nsf: { median: null, institutions: 3 } },
  bankServiceCharges: 1_500_000,
  cuFeeIncome: null,
  bankBranches: null,
  cuBranches: null,
  deposits: null,
  unemployment: { rate: 3.9, date: "2026-08-01" },
  payrollYoyPct: null,
  medianIncome: null,
};

describe("StatePanel", () => {
  it("shows the state's figures, its fees against the district and no tile for unknowns", () => {
    render(<StatePanel row={row} feeKeys={["overdraft", "nsf", "atm_non_network"]} districtMedians={{ overdraft: 30 }} districtName="St. Louis district" />);
    expect(screen.getByText("Banks 30 · Credit unions 10")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("Unemployment, Aug 2026")).toBeTruthy();
    expect(screen.getByText(/^\$32(\.00)?$/)).toBeTruthy();
    expect(screen.getByText(/vs \$30/)).toBeTruthy();
    expect(screen.getByText("3 so far")).toBeTruthy();
    expect(screen.queryByText("Median household income")).toBeNull();
    expect(screen.queryByText("Out-of-network ATM")).toBeNull();
    expect(screen.getByRole("link", { name: /Missouri fee report/ }).getAttribute("href")).toBe("/research/state/MO");
  });
});

const quarters = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2"].map((quarter, i) => ({
  quarter,
  banks: [100, 101, 102, 112, 110, 108][i] * 1_000_000,
  creditUnions: [50, 51, 52, 53, 54, 55][i] * 1_000_000,
  total: 0,
  institutions: 40,
}));

describe("incomeTrend", () => {
  it("compares the latest quarter with the same quarter a year earlier and finds the biggest move", () => {
    const t = incomeTrend(quarters, "banks")!;
    expect(t.latest).toEqual({ quarter: "2026-Q2", value: 108_000_000 });
    expect(t.yearAgoQuarter).toBe("2025-Q2");
    expect(t.yoyPct).toBeCloseTo((108 / 101 - 1) * 100);
    expect(t.biggestMove?.quarter).toBe("2025-Q4");
  });

  it("has no year-on-year change without four earlier quarters, and no note for small moves", () => {
    const t = incomeTrend(quarters.slice(0, 3), "creditUnions")!;
    expect(t.yoyPct).toBeNull();
    expect(t.biggestMove).toBeNull();
  });
});

describe("IncomeLine", () => {
  it("draws one charter on its own, never the banks and credit unions summed", () => {
    render(<IncomeLine series="banks" title="Banks: service charges on deposit accounts" quarters={quarters} />);
    expect(screen.getByText("$108.0M")).toBeTruthy();
    expect(screen.getByText("+6.9%")).toBeTruthy();
    expect(screen.getByText("+9.8% in Q4 2025")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Banks: service charges on deposit accounts by quarter, Q1 2025 to Q2 2026: $100.0M, $101.0M, $102.0M, $112.0M, $110.0M, $108.0M",
    );
    expect(screen.queryByText("$163.0M")).toBeNull();
  });
});

const branches = {
  sod_year: 2025,
  by_state: [],
  cu_by_state: [],
  leaders: [
    { institution_id: 7, name: "First Bank", branches: 12, deposits: 250_000_000 },
    { institution_id: 8, name: "Second Bank", branches: 9, deposits: 150_000_000 },
  ],
  total_deposits: 1_000_000_000,
};

describe("DepositStrip", () => {
  it("names each leading bank's share and everyone else as one share", () => {
    render(<DepositStrip branches={branches} />);
    expect(screen.getByText("First Bank")).toBeTruthy();
    expect(screen.getByText(/^25\.0% · \$250\.0M across 12 branches$/)).toBeTruthy();
    expect(screen.getByText("Every other bank")).toBeTruthy();
    expect(screen.getByText("Other 60%")).toBeTruthy();
    expect(leadersShare(branches)).toEqual({ banks: 2, pct: 40 });
  });
});

describe("ComplaintChart", () => {
  it("names states with too few matched institutions instead of drawing a rate", () => {
    render(
      <ComplaintChart
        minPeers={10}
        view={{
          year: "2025",
          district: { rate: 6.6, matched: 15, feeComplaints: 33 },
          us: { rate: 2.9, matched: 55, feeComplaints: 73 },
          states: [
            { code: "MO", name: "Missouri", rate: 6, matched: 12, feeComplaints: 24 },
            { code: "AR", name: "Arkansas", rate: null, matched: 3, feeComplaints: 9 },
          ],
        }}
      />,
    );
    expect(screen.getByText("6.6")).toBeTruthy();
    expect(screen.getByText("Too few matched institutions for a rate: Arkansas (3).")).toBeTruthy();
  });

  it("shows only the coverage line when the district is under the floor", () => {
    render(
      <ComplaintChart
        minPeers={10}
        view={{ year: "2025", district: { rate: null, matched: 4, feeComplaints: 2 }, us: { rate: null, matched: 4, feeComplaints: 2 }, states: [] }}
      />,
    );
    expect(screen.getByText("4 district institutions are matched to CFPB records, under the 10 a rate needs.")).toBeTruthy();
  });
});

describe("PriceMoves", () => {
  it("marks capped counts and lists recent moves", () => {
    render(
      <PriceMoves
        showAll={false}
        summary={{
          up: 500,
          down: 0,
          added: 0,
          removed: 0,
          capped: true,
          recent: [
            {
              id: 1,
              institution_id: 9,
              institution_name: "Second Bank",
              fee_category: "overdraft",
              old_amount: 30,
              new_amount: 35,
              change_type: "increase",
              changed_at: "2026-09-01T00:00:00Z",
              charter_type: "bank",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("500+")).toBeTruthy();
    expect(screen.getByText("Second Bank")).toBeTruthy();
    expect(screen.getByText("Overdraft · Sep 2026")).toBeTruthy();
  });
});
