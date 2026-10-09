import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BranchFootprintCard, EnforcementCard } from "./registry-cards";
import type { BranchFootprint, EnforcementRecord } from "@/lib/data-store/registry-profile";

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
    expect(screen.getByText("More offices")).toBeInTheDocument();
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

describe("BranchFootprintCard map waiting on addresses", () => {
  it("shows a placeholder instead of a nearly empty map", () => {
    render(<BranchFootprintCard footprint={{ ...CREDIT_UNION, localMap: null, mappedOffices: 1, mapPending: true }} />);
    expect(screen.getByText("Map coming soon")).toBeInTheDocument();
    expect(screen.getByText(/1 of 12 are placed so far/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Branches by state/ })).toBeNull();
  });
});

describe("EnforcementCard", () => {
  const base: EnforcementRecord = { agenciesChecked: ["OCC", "FRB"], open: [], past: [], pastCount: 0, asOf: "2026-10-07" };

  it("says none only for the lists that were checked", () => {
    render(<EnforcementCard record={base} />);
    expect(screen.getByText("None on file with the OCC and Federal Reserve")).toBeInTheDocument();
    expect(screen.getByText(/FDIC orders are not included yet/)).toBeInTheDocument();
  });

  it("lists orders with no end date on file, never calling them active, and labels holding-company ones", () => {
    render(
      <EnforcementCard
        record={{
          ...base,
          open: [
            { agency: "FRB", party_name: "Example Bancorp", against_holding_company: true, action_type: "Written Agreement", subject: null, start_date: "2023-03-01", termination_date: null, penalty_amount: null, document_url: "https://www.federalreserve.gov/x.pdf" },
          ],
          past: [
            { agency: "OCC", party_name: "Example Bank", against_holding_company: false, action_type: "Formal Agreement", subject: "BSA/AML", start_date: "2018-01-05", termination_date: "2020-02-01", penalty_amount: 1_000_000, document_url: null },
          ],
          pastCount: 3,
        }}
      />,
    );
    expect(screen.getByText("1 order with no end date on file")).toBeInTheDocument();
    expect(screen.queryByText(/active/i)).toBeNull();
    expect(screen.getByText(/against the holding company, Example Bancorp/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Order" })).toHaveAttribute("href", "https://www.federalreserve.gov/x.pdf");
    expect(screen.getByText(/latest 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/Ended February 1, 2020/)).toBeInTheDocument();
  });
});
