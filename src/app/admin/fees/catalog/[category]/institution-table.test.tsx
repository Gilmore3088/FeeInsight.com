// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InstitutionTable } from "./institution-table";
import type { FeeInstance } from "@/lib/data-store";

afterEach(() => cleanup());

function fee(id: number, institution_id: number, name: string, amount: number, extra: Partial<FeeInstance> = {}): FeeInstance {
  return {
    id,
    institution_id,
    institution_name: name,
    amount,
    frequency: "per_item",
    conditions: null,
    charter_type: "bank",
    state_code: "TX",
    asset_size_tier: null,
    asset_size: null,
    review_status: "approved",
    extraction_confidence: 0.9,
    canonical_fee_key: "overdraft",
    variant_type: null,
    fee_name: "Overdraft Item",
    document_url: `https://example.com/${institution_id}.pdf`,
    source_document_id: institution_id,
    ...extra,
  };
}

const fees = [
  fee(1, 10, "Alpha Bank", 20),
  fee(2, 11, "Bravo Bank", 35),
  fee(3, 12, "Charlie CU", 55, { charter_type: "credit_union" }),
  fee(4, 13, "Delta Bank", 35, { document_url: null, source_document_id: null }),
];

describe("InstitutionTable", () => {
  it("opens on a chart bar's amount range and lists only those institutions", () => {
    render(
      <InstitutionTable fees={fees} median={35} highestTier countedValues={{ 10: 20, 11: 35, 12: 55 }} initialMin={50} initialMax={59.99} />,
    );
    expect(screen.getByText("Charlie CU")).toBeTruthy();
    expect(screen.queryByText("Alpha Bank")).toBeNull();
    expect(screen.queryByText("Bravo Bank")).toBeNull();
  });

  it("filters to one amount from the common-amount chips", () => {
    render(<InstitutionTable fees={fees} median={35} countedValues={{ 10: 20, 11: 35, 12: 55 }} />);
    fireEvent.click(screen.getByRole("button", { name: /\$20\.00/ }));
    expect(screen.getByText("Alpha Bank")).toBeTruthy();
    expect(screen.queryByText("Bravo Bank")).toBeNull();
  });

  it("shows the fee name and the bank's schedule when a row opens, and flags unsourced rows", () => {
    render(<InstitutionTable fees={fees} median={35} countedValues={{ 10: 20, 11: 35, 12: 55 }} />);
    fireEvent.click(screen.getByText("Alpha Bank").closest("tr")!);
    expect(screen.getByText("Overdraft Item")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Bank's schedule/ }).getAttribute("href")).toBe("https://example.com/10.pdf");
    expect(screen.getByText("no source, not counted")).toBeTruthy();
  });
});
