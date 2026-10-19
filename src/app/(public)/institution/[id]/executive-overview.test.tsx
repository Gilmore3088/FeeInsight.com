import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CallItemHistoryRow } from "@/lib/data-store/institution-quarterly";
import { ExecutiveOverview } from "./executive-overview";
import { FinancialPerformanceSection } from "./financial-performance-section";
import { buildCohortDistribution } from "./fee-share-cohort";
import { feeIncomeTerms } from "./financial-units";
import { buildLedger } from "./quarterly-ledger";

const line = (report_date: string, item_key: string, item_code: string, value: number, period_basis = "ytd"): CallItemHistoryRow => ({
  report_date, item_key, item_code, item_description: null, value, unit: "thousands", period_basis, fetched_at: "2026-08-15T00:00:00Z",
});

const ledger = buildLedger([], [
  line("2026-03-31", "service_charges_deposits_ytd", "RIAD4080", 5_600),
  line("2026-06-30", "service_charges_deposits_ytd", "RIAD4080", 11_300),
  line("2026-03-31", "net_interest_income_ytd", "RIAD4074", 40_000),
  line("2026-06-30", "net_interest_income_ytd", "RIAD4074", 81_000),
  line("2026-03-31", "noninterest_income_total_ytd", "RIAD4079", 15_000),
  line("2026-06-30", "noninterest_income_total_ytd", "RIAD4079", 30_000),
  line("2026-03-31", "total_assets", "RCON2170", 4_300_000, "point_in_time"),
  line("2026-06-30", "total_assets", "RCON2170", 4_400_000, "point_in_time"),
]);

const cohort = buildCohortDistribution(
  {
    report_date: "2026-06-30",
    source: "fdic",
    charter_type: "bank",
    asset_size_tier: "community_large",
    filers: 13,
    members: [
      { id: 1, name: "Subject Bank", city: null, state: "FL", total_assets: 4_400_000, service_charge_income: 5_700, total_revenue: 56_000, fee_income_ratio: 0.1018 },
      ...Array.from({ length: 12 }, (_, i) => ({
        id: i + 2, name: `Peer ${i + 2}`, city: null, state: "GA", total_assets: 2_000_000, service_charge_income: 500, total_revenue: 40_000, fee_income_ratio: (i + 1) / 1000,
      })),
    ],
  },
  1,
);

describe("overview and financial performance", () => {
  beforeAll(() => {
    // jsdom has no matchMedia; the cards' count-up reads it for reduced motion.
    window.matchMedia ??= ((media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} })) as never;
  });

  const renderOverview = (props: Partial<Parameters<typeof ExecutiveOverview>[0]> = {}) =>
    render(
      <ExecutiveOverview
        institutionName="Subject Bank"
        ledger={ledger}
        cohort={cohort}
        cohortName="banks with $1B to $10B in assets"
        counts={null}
        stateName="Florida"
        feesReadOn="Oct 17, 2026"
        terms={feeIncomeTerms("fdic")}
        observations={[]}
        cohortRead
        {...props}
      />,
    );

  it("gives every card the same four parts and keeps the provenance out of the cards", () => {
    const { container } = renderOverview();
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      expect(card.className).toContain("grid-rows-subgrid");
      expect(card.children).toHaveLength(4);
      expect(card.querySelector("details")).toBeNull();
    }
    expect(within(cards[0]).getByText("$4.4B")).toBeTruthy();
    expect(within(cards[0]).getByText("Q2 2026, quarter end")).toBeTruthy();
    expect(within(cards[0]).getByText("FFIEC call report · Jun 30, 2026")).toBeTruthy();
    expect(within(cards[2]).getByText("$5.7M")).toBeTruthy();
    expect(within(cards[2]).getByText("Q2 2026, one quarter")).toBeTruthy();
    expect(within(cards[3]).getByText(/percentile; peer median 0.7%/)).toBeTruthy();
    expect(within(cards[4]).getByText("None compared")).toBeTruthy();
    expect(within(cards[4]).getByText("Fee schedule read Oct 17, 2026")).toBeTruthy();
    // The intro line is gone: the bank-level note appears once, inside the drawer.
    expect(screen.getAllByText(/not its holding company/)).toHaveLength(1);
    expect(container.querySelectorAll("details")).toHaveLength(2); // the drawer and the chart's Details
  });

  it("puts every metric's provenance in one collapsed drawer table", () => {
    renderOverview();
    const drawer = screen.getByText("How these figures are measured").closest("details") as HTMLDetailsElement;
    expect(drawer.open).toBe(false);
    expect(within(drawer).getByText(/Subject Bank at the bank level, not its holding company/)).toBeTruthy();
    const table = within(drawer).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Metric",
      "Measure and calculation",
      "Source and fields",
      "Period",
      "Retrieved",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "Total assets",
      "Revenue",
      "Service-charge income",
      "Service-charge share of revenue",
      "Fees above the U.S. median",
    ]);
    expect(within(rows[0]).getByText("RCON2170").className).toContain("--fi-font-mono");
    expect(within(rows[1]).getByText("RIAD4074 + RIAD4079")).toBeTruthy();
    expect(within(rows[1]).getByText(/Standalone quarter/)).toBeTruthy();
    expect(within(rows[1]).getByText("Quarter ended Jun 30, 2026")).toBeTruthy();
    expect(within(rows[4]).getByText("Oct 17, 2026")).toBeTruthy();
  });

  it("says why the share card has no value", () => {
    renderOverview({ cohort: null, cohortName: null, cohortRead: true, feesSparse: true });
    const cards = screen.getAllByRole("listitem");
    expect(within(cards[3]).getByText("Not enough peers")).toBeTruthy();
    expect(within(cards[3]).getByText("Fewer than 10 banks its size reported a share")).toBeTruthy();
    expect(within(cards[4]).getByText("Too few fees")).toBeTruthy();
    expect(within(cards[4]).getByText("Fewer than 5 verified fees on file")).toBeTruthy();
  });

  it("gives the fee card one action when fees were compared", () => {
    renderOverview({ counts: { above: 16, below: 5, same: 3, compared: 24, level: "state" } });
    const card = screen.getAllByRole("listitem")[4];
    expect(within(card).getByText("Fees above the Florida median")).toBeTruthy();
    expect(within(card).getByText("of 24 compared; 5 below, 3 about the same")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "See the fees" }).getAttribute("href")).toBe("#compare-heading");
  });

  it("names the cohort with its size and lists its members", () => {
    render(
      <FinancialPerformanceSection
        institutionId={1}
        institutionName="Subject Bank"
        ledger={ledger}
        terms={feeIncomeTerms("fdic")}
        cohort={cohort}
        cohortName="banks with $1B to $10B in assets"
      />,
    );
    expect(screen.getByText(/13 banks with \$1B to \$10B in assets filing for Q2 2026; 12 reported a share above 0%/)).toBeTruthy();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toContain("Revenue (net interest + noninterest income)");
    expect(within(screen.getByRole("list", { name: "Cohort members" })).getAllByRole("button")).toHaveLength(12); // 12 peers, under the preview cap of 15
  });
});
