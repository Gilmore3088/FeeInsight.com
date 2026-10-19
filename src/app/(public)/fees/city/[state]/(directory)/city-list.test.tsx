import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CityList } from "./city-list";

const cities = [
  { name: "Tallahassee", href: "/fees/city/fl/tallahassee", institutions: 20, withFees: 12 },
  { name: "Miami", href: "/fees/city/fl/miami", institutions: 70, withFees: 40 },
  { name: "Tampa", href: "/fees/city/fl/tampa", institutions: 1, withFees: 1 },
];

describe("CityList", () => {
  it("lists every city A to Z with fee data counts that never read as a $0 fee", () => {
    render(<CityList cities={cities} stateName="Florida" />);
    expect(screen.getByRole("heading", { name: "Browse Florida cities" })).toBeTruthy();
    expect(screen.getByText(/Showing 3 cities/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /View all/ })).toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "MiamiFee data available for 40 of 70 institutions",
      "TallahasseeFee data available for 12 of 20 institutions",
      "TampaFee data available for 1 of 1 institution",
    ]);
    expect(screen.getByText(/fee schedule may apply across all its branches/)).toBeTruthy();
  });

  it("shows the 30 largest markets until the reader asks to view all", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `Town ${String(i).padStart(2, "0")}`,
      href: `/fees/city/fl/town-${i}`,
      institutions: i,
      withFees: 1,
    }));
    render(<CityList cities={many} stateName="Florida" />);
    expect(screen.getByText(/Showing 30 cities/)).toBeTruthy();
    // Every link is in the HTML; the smaller towns are hidden until asked for.
    expect(screen.getAllByRole("link")).toHaveLength(30);
    expect(screen.queryByRole("link", { name: /Town 00/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View all 40" }));
    expect(screen.getAllByRole("link")).toHaveLength(40);
    expect(screen.getByText(/Showing 40 cities/)).toBeTruthy();
  });
});
