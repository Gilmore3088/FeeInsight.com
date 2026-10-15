import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store";
import { UNSTATED_AUDIENCE_FOOTNOTE } from "@/lib/fee-audience";
import { BenchmarkBoard } from "./benchmark-board";

function summary(overrides: Partial<FeeCategorySummary>): FeeCategorySummary {
  return {
    fee_category: "overdraft",
    institution_count: 40,
    total_observations: 60,
    min_amount: 0,
    max_amount: 40,
    avg_amount: 28,
    median_amount: 30,
    p25_amount: 25,
    p75_amount: 35,
    bank_count: 20,
    cu_count: 20,
    zero_count: 2,
    bank_median_amount: 30,
    cu_median_amount: 28,
    ...overrides,
  };
}

describe("research hub benchmark board, unstated audience (#1132)", () => {
  it("marks a median that rests on an unstated-audience row and shows the footnote", () => {
    render(
      <BenchmarkBoard
        benchmarks={[summary({ unstated_audience_institution_count: 3 }), summary({ fee_category: "nsf" })]}
        institutionsLabel="100"
        asOf={null}
      />,
    );
    expect(screen.getAllByText("*", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(UNSTATED_AUDIENCE_FOOTNOTE)).toHaveLength(1);
    expect(screen.getByText(UNSTATED_AUDIENCE_FOOTNOTE, { exact: false })).toBeTruthy();
  });

  it("shows no asterisk or footnote when every row states its audience", () => {
    render(<BenchmarkBoard benchmarks={[summary({ unstated_audience_institution_count: 0 })]} institutionsLabel="100" asOf={null} />);
    expect(screen.queryAllByTitle(UNSTATED_AUDIENCE_FOOTNOTE)).toHaveLength(0);
    expect(screen.queryByText(UNSTATED_AUDIENCE_FOOTNOTE, { exact: false })).toBeNull();
  });
});
