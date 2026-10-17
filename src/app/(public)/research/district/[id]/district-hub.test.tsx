import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ComplaintChart, LeadersTable, PriceMoves, RevenueChart, StatePanel } from "./district-hub";
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

describe("RevenueChart", () => {
  it("draws one charter on its own, never the banks and credit unions summed", () => {
    render(
      <RevenueChart
        series="banks"
        title="Banks: service charges on deposit accounts"
        quarters={[
          { quarter: "2026-Q1", banks: 90_000_000, creditUnions: 10_000_000, total: 100_000_000, institutions: 40 },
          { quarter: "2026-Q2", banks: 80_000_000, creditUnions: 20_000_000, total: 100_000_000, institutions: 40 },
        ]}
      />,
    );
    expect(screen.getByText("$90.0M")).toBeTruthy();
    expect(screen.getByText("$80.0M")).toBeTruthy();
    expect(screen.queryByText("$100.0M")).toBeNull();
    // The year sits on its own line on phones, so the label spans two elements.
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Q2 ’26")).toBeTruthy();
    // Phones show only the newest figure; the chart's label carries every one.
    expect(screen.getByText("$90.0M").className).toContain("hidden sm:block");
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Banks: service charges on deposit accounts by quarter, Q1 2026 to Q2 2026: $90.0M, $80.0M",
    );
  });
});

describe("LeadersTable", () => {
  it("shows each bank's share of the district's deposits", () => {
    render(
      <LeadersTable
        branches={{
          sod_year: 2025,
          by_state: [],
          cu_by_state: [],
          leaders: [{ institution_id: 7, name: "First Bank", branches: 12, deposits: 250_000_000 }],
          total_deposits: 1_000_000_000,
        }}
      />,
    );
    expect(screen.getByText("First Bank")).toBeTruthy();
    expect(screen.getByText("25.0%")).toBeTruthy();
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
