import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CityList } from "./city-list";

const cities = [
  { name: "Tallahassee", href: "/fees/city/fl/tallahassee", withFees: 12 },
  { name: "Miami", href: "/fees/city/fl/miami", withFees: 40 },
  { name: "Tampa", href: "/fees/city/fl/tampa", withFees: 25 },
];

describe("CityList", () => {
  it("lists every city by name and filters as the reader types", () => {
    render(<CityList cities={cities} stateName="Florida" />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Miami40", "Tallahassee12", "Tampa25"]);
    fireEvent.change(screen.getByLabelText("Find your city"), { target: { value: "ta" } });
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/fees/city/fl/tallahassee",
      "/fees/city/fl/tampa",
    ]);
    expect(screen.getByText("2 of 3 cities")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find your city"), { target: { value: "zzz" } });
    expect(screen.getByText("No city by that name has published fees yet.")).toBeTruthy();
  });
});
