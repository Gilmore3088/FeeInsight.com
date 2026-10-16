import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CityList } from "./city-list";

const cities = [
  { name: "Tallahassee", href: "/fees/city/fl/tallahassee", institutions: 20, withFees: 12 },
  { name: "Miami", href: "/fees/city/fl/miami", institutions: 70, withFees: 40 },
  { name: "Tampa", href: "/fees/city/fl/tampa", institutions: 45, withFees: 25 },
];

describe("CityList", () => {
  it("lists every city with labelled counts and filters as the reader types", () => {
    render(<CityList cities={cities} stateName="Florida" stateCode="FL" />);
    expect(screen.getByText("Cities with fee coverage: 3")).toBeTruthy();
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Miami40 of 70 with fees",
      "Tallahassee12 of 20 with fees",
      "Tampa25 of 45 with fees",
    ]);
    fireEvent.change(screen.getByLabelText("Find your city"), { target: { value: "ta" } });
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/fees/city/fl/tallahassee",
      "/fees/city/fl/tampa",
    ]);
    expect(screen.getByText("2 of 3 cities with fee coverage")).toBeTruthy();
  });

  it("answers a town it doesn't cover with ways on, not an empty list", () => {
    render(<CityList cities={cities} stateName="Florida" stateCode="FL" />);
    fireEvent.change(screen.getByLabelText("Find your city"), { target: { value: "Sarasota" } });
    expect(screen.getByText("We don't have a city comparison for Sarasota yet.")).toBeTruthy();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/institutions?q=Sarasota",
      "/research/state/FL",
      "/fees",
    ]);
  });

  it("lists the 30 largest markets until the reader asks for all", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `Town ${String(i).padStart(2, "0")}`,
      href: `/fees/city/fl/town-${i}`,
      institutions: i,
      withFees: 1,
    }));
    render(<CityList cities={many} stateName="Florida" stateCode="FL" />);
    expect(screen.getAllByRole("link")).toHaveLength(30);
    expect(screen.queryByText("Town 00")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 40 cities" }));
    expect(screen.getAllByRole("link")).toHaveLength(40);
  });
});
