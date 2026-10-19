import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UNSTATED_AUDIENCE_FOOTNOTE } from "@/lib/fee-audience";
import type { CheckRow } from "./check-data";
import { CheckTable } from "./check-table";

const row = (unstated: number): CheckRow => ({
  category: "nsf", label: "NSF / Returned Item", value: 35, low: 35, high: 35,
  prices: [], amounts: [35], comparedAt: null, sourceUrl: "https://bank.example/fees.pdf",
  state: null,
  nation: { min: 0, p25: 25, median: 30, p75: 35, max: 40, institutions: 40, unstated_audience_institution_count: unstated },
});

describe("CheckTable audience context", () => {
  it("marks a median that counts unstated-audience fees and explains the qualification", () => {
    const { container } = render(<CheckTable rows={[row(8)]} stateCode={null} stateLabel={null} guideHrefs={{}} />);
    expect(container.textContent).toContain("$30*");
    expect(screen.getByText(UNSTATED_AUDIENCE_FOOTNOTE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How audience is decided" })).toHaveAttribute("href", "/methodology#audience");
  });

  it("does not add the qualification to a fully stated-audience median", () => {
    const { container } = render(<CheckTable rows={[row(0)]} stateCode={null} stateLabel={null} guideHrefs={{}} />);
    expect(container.textContent).not.toContain("$30*");
    expect(screen.queryByText(UNSTATED_AUDIENCE_FOOTNOTE)).not.toBeInTheDocument();
  });
});
