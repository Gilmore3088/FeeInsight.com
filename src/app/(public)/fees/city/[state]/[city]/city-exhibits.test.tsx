import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CityStripChart } from "./city-exhibits";
import type { CityStrip } from "./city-view";

const strips: CityStrip[] = [
  {
    key: "overdraft",
    label: "Overdraft",
    banks: [
      { id: 2, name: "Valley CU", charter: "credit_union", amount: 25 },
      { id: 3, name: "Main Street Bank", charter: "bank", amount: 30 },
      { id: 1, name: "First Bank", charter: "bank", amount: 35 },
    ],
    cityMedian: 30,
    nation: { p25: 29, median: 32, p75: 35 },
  },
  { key: "monthly_maintenance", label: "Monthly fee", banks: [{ id: 1, name: "First Bank", charter: "bank", amount: 10 }], cityMedian: null, nation: null },
  { key: "nsf", label: "NSF", banks: [], cityMedian: null, nation: null },
];

describe("CityStripChart", () => {
  it("names the tapped institution and counts who charges less", () => {
    render(<CityStripChart strips={strips} cityName="Tallahassee" />);
    expect(screen.getByText("Valley CU · $25")).toBeTruthy();
    expect(screen.getByText("No Tallahassee institution publishing this fee charges less.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "First Bank: $35" }));
    expect(screen.getByText("2 of 3 Tallahassee institutions publishing this fee charge less.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See all of First Bank's fees" }).getAttribute("href")).toBe("/institution/1");
  });

  it("switches fees from the buttons and hides fees nobody publishes", () => {
    render(<CityStripChart strips={strips} cityName="Tallahassee" />);
    expect(screen.queryByRole("button", { name: "NSF" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Monthly fee" }));
    expect(screen.getByText("First Bank · $10")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Monthly fee" }).getAttribute("aria-pressed")).toBe("true");
  });
});
