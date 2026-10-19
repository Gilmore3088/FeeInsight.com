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

describe("research hub benchmark board", () => {
  it("is a compact table: fee, bank median, credit union median, sample size, with the lower median said in words", () => {
    render(<BenchmarkBoard benchmarks={[summary({ bank_median_amount: 32, cu_median_amount: 25 })]} asOf={null} />);
    const row = screen.getByRole("list", { name: "National benchmark fees" }).querySelector("summary")!;
    expect(row.textContent).toContain("$32.00");
    expect(row.textContent).toContain("$25.00");
    expect(row.textContent).toContain("40");
    expect(row.textContent).toContain("lower");
  });

  it("labels the $0 share as observed prices, with its coverage caveat", () => {
    const { container } = render(<BenchmarkBoard benchmarks={[summary({})]} asOf={null} />);
    expect(screen.getByText("All observed prices are $0")).toBeTruthy();
    expect(container.textContent).toContain("doesn't show every account is free");
    expect(container.textContent).not.toContain("Publish only $0");
  });

  it("states the unstated-audience count and that a median without those fees isn't published", () => {
    const { container } = render(<BenchmarkBoard benchmarks={[summary({ unstated_audience_institution_count: 3 })]} asOf={null} />);
    expect(container.textContent).toContain("3 of 40 institutions");
    expect(container.textContent).toContain("counted as personal");
    expect(container.textContent).toContain("A median without them isn't published yet.");
    expect(screen.queryAllByTitle(UNSTATED_AUDIENCE_FOOTNOTE)).toHaveLength(0);
  });

  it("says so when every schedule states the audience", () => {
    const { container } = render(<BenchmarkBoard benchmarks={[summary({ unstated_audience_institution_count: 0 })]} asOf={null} />);
    expect(container.textContent).toContain("Every schedule in this benchmark states the audience.");
  });
});
