// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CountyPriceMap, type CountyDetail } from "./county-price-map";

const svg = `<svg><path data-fips="31055" d="M0 0h10v10z"><title>Douglas: $33</title></path><path data-fips="31137" d="M20 0h10v10z"></path></svg>`;
const details: Record<string, CountyDetail> = {
  "31055": {
    name: "Douglas",
    fee: 33.2,
    institutions: 40,
    deposits: 30e9,
    covered: 15e9,
    top: [
      { id: 4, name: "Wells Fargo Bank", fee: 35, deposits: 2.9e9 },
      { id: 68, name: "First National Bank of Omaha", fee: null, deposits: 14e9 },
    ],
  },
  "31137": { name: "Phelps", fee: null, institutions: 3, deposits: 3e8, covered: 0, top: [] },
};

afterEach(cleanup);

describe("CountyPriceMap", () => {
  it("opens a county on click with its institutions and their own fees", () => {
    const { container } = render(<CountyPriceMap wide={svg} narrow={null} details={details} price={30} feeNoun="overdraft fee" />);
    fireEvent.click(container.querySelector('path[data-fips="31055"]')!);
    expect(screen.getByText("Douglas")).toBeTruthy();
    expect(screen.getByText(/\$3.20 above \$30/)).toBeTruthy();
    expect(screen.getByText(/hold 50% of those deposits/)).toBeTruthy();
    expect(screen.getByText("Wells Fargo Bank").closest("a")?.getAttribute("href")).toBe("/institution/4");
    expect(screen.getByText("not on file")).toBeTruthy();
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByText("Wells Fargo Bank")).toBeNull();
  });

  it("shows a hover readout and drops the static titles", () => {
    const { container } = render(<CountyPriceMap wide={svg} narrow={null} details={details} price={30} feeNoun="overdraft fee" />);
    expect(container.querySelector("title")).toBeNull();
    fireEvent.mouseMove(container.querySelector('path[data-fips="31137"]')!);
    expect(screen.getByText("Phelps")).toBeTruthy();
    expect(screen.getByText("No published overdraft fee yet")).toBeTruthy();
  });
});
