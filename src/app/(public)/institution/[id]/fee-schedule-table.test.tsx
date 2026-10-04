import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeeScheduleTable, describeMedianDelta, type DisplayFee } from "./fee-schedule-table";

function fee(overrides: Partial<DisplayFee>): DisplayFee {
  return {
    id: "1",
    feeName: "Paid item overdraft",
    feeCategory: "overdraft",
    amount: 35,
    frequency: "per_item",
    conditions: null,
    status: "verified",
    sourceUrl: null,
    ...overrides,
  };
}

describe("describeMedianDelta", () => {
  it("states the distance from the median in words", () => {
    expect(describeMedianDelta(35, 32.5)).toEqual({ text: "$2.50 above the national median", tone: "above" });
    expect(describeMedianDelta(30, 32.5)).toEqual({ text: "$2.50 below the national median", tone: "below" });
    expect(describeMedianDelta(32.5, 32.5)).toEqual({ text: "At the national median", tone: "at" });
  });

  it("says nothing when either side is missing", () => {
    expect(describeMedianDelta(null, 30)).toBeNull();
    expect(describeMedianDelta(30, null)).toBeNull();
    expect(describeMedianDelta(30, undefined)).toBeNull();
  });
});

describe("FeeScheduleTable", () => {
  const medians = new Map<string, number | null>([["overdraft", 32.5], ["nsf", 30]]);

  it("links verified rows to the national page for that fee", () => {
    render(<FeeScheduleTable fees={[fee({})]} disclosureUrl={null} medians={medians} />);
    const links = screen.getAllByRole("link", { name: "$2.50 above the national median" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute("href", "/fees/overdraft");
  });

  it("never compares a fee that is still under review", () => {
    render(
      <FeeScheduleTable fees={[fee({ id: "2", feeCategory: "nsf", status: "provisional" })]} disclosureUrl={null} medians={medians} />,
    );
    expect(screen.queryByRole("link", { name: /national median/ })).toBeNull();
  });

  it("highlights and anchors the focused fee", () => {
    const { container } = render(
      <FeeScheduleTable fees={[fee({})]} disclosureUrl={null} medians={medians} focusCategory="overdraft" />,
    );
    const row = container.querySelector("#fee-overdraft");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Paid item overdraft")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-fee-anchor="overdraft"]').length).toBe(2);
  });
});
