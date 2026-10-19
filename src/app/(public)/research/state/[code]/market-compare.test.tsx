import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stateMarketMap } from "@/lib/geo/state-market-map";
import { MarketCompare } from "./market-compare";
import type { MarketFee, MarketPanel } from "./market-compare-view";

function fee(key: string, label: string, city: number | null, state: number): MarketFee {
  return {
    key,
    label,
    low: null,
    high: null,
    takeaway: `${label} takeaway`,
    rungs: [
      { level: "city", place: "City", population: "", median: city, institutions: 6 },
      { level: "state", place: "Connecticut", population: "", median: state, institutions: 30 },
    ],
  };
}

function panel(city: string, name: string, od: number | null, atm: number | null): MarketPanel {
  return {
    city,
    name,
    href: `/fees/city/ct/${name.toLowerCase()}`,
    institutions: 20,
    withFees: 12,
    branches: 40,
    fees: [fee("overdraft", "Overdraft", od, 32), fee("atm_non_network", "Non-Network ATM", atm, 1)],
  };
}

const panels = [panel("STAMFORD", "Stamford", 30, 2.5), panel("HARTFORD", "Hartford", 34, 2.25)];
const map = stateMarketMap("CT", [
  { key: "STAMFORD", lat: 41.05, lon: -73.54 },
  { key: "HARTFORD", lat: 41.76, lon: -72.68 },
]);

function renderCompare(initialMarket = "", initialFee = "") {
  return render(
    <MarketCompare
      panels={panels}
      map={map}
      stateName="Connecticut"
      directoryHref="/fees/city/ct"
      title="Local fee benchmarks"
      headingId="h"
      initialMarket={initialMarket}
      initialFee={initialFee}
    />,
  );
}

describe("MarketCompare", () => {
  it("opens on the market and fee a no-script link asked for", () => {
    renderCompare("hartford", "atm_non_network");
    expect(screen.getByRole("heading", { level: 3, name: "Hartford" })).toBeTruthy();
    expect(screen.getByText("Non-Network ATM takeaway")).toBeTruthy();
  });

  it("gives every market row and fee a ?market=&fee= link that also works without scripts", () => {
    renderCompare();
    const rows = screen.getByRole("list", { name: /median in Connecticut's largest markets/ });
    expect(within(rows).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "?market=stamford&fee=atm_non_network#local",
      "?market=hartford&fee=atm_non_network#local",
    ]);
    expect(screen.getByRole("link", { name: "Overdraft" }).getAttribute("href")).toBe("?market=stamford&fee=overdraft#local");
    const fees = screen.getByLabelText("Fee") as HTMLSelectElement;
    expect(fees.name).toBe("fee");
  });

  it("picks a market from its row in place, with scripts", () => {
    renderCompare();
    const rows = screen.getByRole("list", { name: /median in Connecticut's largest markets/ });
    fireEvent.click(within(rows).getByRole("link", { name: /Hartford/ }));
    expect(screen.getByRole("heading", { level: 3, name: "Hartford" })).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get("market")).toBe("hartford");
  });

  it("keeps the duplicate map markers out of the tab order", () => {
    const { container } = renderCompare();
    const markers = container.querySelectorAll("svg a");
    expect(markers).toHaveLength(2);
    markers.forEach((a) => {
      expect(a.getAttribute("tabindex")).toBe("-1");
      expect(a.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
