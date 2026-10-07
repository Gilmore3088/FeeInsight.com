import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BranchFootprintCard } from "./registry-cards";
import type { BranchFootprint } from "@/lib/data-store/registry-profile";

const CREDIT_UNION: BranchFootprint = {
  source: "ncua",
  reportDate: "2026-06-30",
  latestYear: 2026,
  byYear: [{ year: 2026, branches: 12, deposits: 0 }],
  byState: [
    { state: "TX", branches: 10, deposits: 0 },
    { state: "OK", branches: 2, deposits: 0 },
  ],
  topMarkets: [
    { msa_name: "Austin, TX", branches: 7, deposits: 0 },
    { msa_name: "Tulsa, OK", branches: 2, deposits: 0 },
  ],
};

describe("BranchFootprintCard", () => {
  it("shows a credit union's offices from NCUA without any deposit figures", () => {
    const { container } = render(<BranchFootprintCard footprint={CREDIT_UNION} />);
    expect(screen.getByText("12 offices in 2 states (June 30, 2026)")).toBeInTheDocument();
    expect(screen.getByText("Cities with the most offices")).toBeInTheDocument();
    expect(screen.getByText("Austin, TX")).toBeInTheDocument();
    expect(container.textContent).toContain("NCUA does not report deposits by office.");
    expect(container.textContent).not.toMatch(/\$/);
  });

  it("keeps deposits for a bank", () => {
    render(
      <BranchFootprintCard
        footprint={{
          source: "fdic_sod",
          latestYear: 2026,
          byYear: [{ year: 2026, branches: 3, deposits: 250_000 }],
          byState: [{ state: "TX", branches: 3, deposits: 250_000 }],
          topMarkets: [{ msa_name: "Austin-Round Rock-San Marcos, TX", branches: 3, deposits: 250_000 }],
        }}
      />,
    );
    expect(screen.getByText("Largest markets by deposits")).toBeInTheDocument();
    expect(screen.getByText(/in branch deposits \(June 2026\)/)).toBeInTheDocument();
  });
});
