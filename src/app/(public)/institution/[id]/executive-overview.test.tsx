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

  it("renders the cards with date, entity level and Details, and says when a value is missing", () => {
    render(
      <ExecutiveOverview
        institutionName="Subject Bank"
        ledger={ledger}
        cohort={cohort}
        cohortName="banks with $1B to $10B in assets"
        counts={null}
        stateName="Florida"
        feesReadOn={null}
        terms={feeIncomeTerms("fdic")}
        observations={[]}
      />,
    );
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(5);
    expect(within(cards[0]).getByText("$4.4B")).toBeTruthy();
    expect(within(cards[0]).getByText(/Jun 30, 2026 · Bank level/)).toBeTruthy();
    expect(within(cards[0]).getByText("RCON2170")).toBeTruthy();
    expect(within(cards[2]).getByText("$5.7M")).toBeTruthy();
    expect(within(cards[2]).getByText(/Standalone quarter/)).toBeTruthy();
    expect(within(cards[3]).getByText(/Median 0.7% for 12 banks/)).toBeTruthy();
    expect(within(cards[4]).getByText("Insufficient sample")).toBeTruthy();
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
