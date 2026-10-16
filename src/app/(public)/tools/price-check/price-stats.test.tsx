import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriceStats } from "./price-stats";

const money = (value: number) => `$${value.toFixed(2)}`;
const props = { state: "TX", count: 24, lowerShare: 40, zero: 2, money };

describe("PriceStats unstated-audience asterisk (#1132)", () => {
  it("marks each median that rests on an unstated-audience fee and shows the footnote once", () => {
    const { container } = render(
      <PriceStats
        {...props}
        stateMedian={{ median_amount: 30, unstated_audience_institution_count: 3 }}
        nationalMedian={{ median_amount: 29, unstated_audience_institution_count: 900 }}
      />,
    );
    expect(screen.getAllByText("(audience not stated, treated as personal)", { exact: false })).toHaveLength(2);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "How audience is decided" })).toHaveAttribute("href", "/methodology#audience");
  });

  it("shows no mark and no footnote when the count is zero", () => {
    const { container } = render(
      <PriceStats
        {...props}
        stateMedian={{ median_amount: 30, unstated_audience_institution_count: 0 }}
        nationalMedian={{ median_amount: 29, unstated_audience_institution_count: 0 }}
      />,
    );
    expect(container.textContent).not.toContain("*");
    expect(screen.queryByRole("link", { name: "How audience is decided" })).toBeNull();
    expect(screen.getByText("$30.00")).toBeInTheDocument();
  });

  it("marks only the median whose count is above zero", () => {
    render(
      <PriceStats
        {...props}
        stateMedian={{ median_amount: 30, unstated_audience_institution_count: 0 }}
        nationalMedian={{ median_amount: 29, unstated_audience_institution_count: 5 }}
      />,
    );
    expect(screen.getAllByText("(audience not stated, treated as personal)", { exact: false })).toHaveLength(1);
    expect(screen.getByText("National median").nextElementSibling?.textContent).toContain("*");
    expect(screen.getByText("TX median").nextElementSibling?.textContent).not.toContain("*");
  });
});
