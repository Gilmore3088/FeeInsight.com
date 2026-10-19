import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { stateMarketMap } from "@/lib/geo/state-market-map";
import { CitySearch, ExplorerMap, SelectedCity, StateExplorer, type ExplorerCity } from "./state-explorer";

const cities: ExplorerCity[] = [
  { key: "tampa", name: "Tampa", href: "/fees/city/fl/tampa", institutions: 78, withFees: 58 },
  { key: "st. petersburg", name: "St. Petersburg", href: "/fees/city/fl/st.%20petersburg", institutions: 50, withFees: 41 },
  { key: "port st. lucie", name: "Port St. Lucie", href: "/fees/city/fl/port%20st.%20lucie", institutions: 30, withFees: 20 },
  { key: "fort lauderdale", name: "Fort Lauderdale", href: "/fees/city/fl/fort%20lauderdale", institutions: 40, withFees: 34 },
  { key: "nowhere", name: "Nowhere", href: "/fees/city/fl/nowhere", institutions: 2, withFees: 1 },
];
const map = stateMarketMap("FL", [
  { key: "tampa", lat: 27.98, lon: -82.5 },
  { key: "st. petersburg", lat: 27.77, lon: -82.64 },
  { key: "port st. lucie", lat: 27.27, lon: -80.35 },
  { key: "fort lauderdale", lat: 26.14, lon: -80.14 },
  // A bad coordinate far outside Florida is dropped, not drawn.
  { key: "nowhere", lat: 47.6, lon: -122.3 },
]);

function renderExplorer() {
  return render(
    <StateExplorer map={map} cities={cities} stateName="Florida">
      <CitySearch />
      <SelectedCity />
      <ExplorerMap />
    </StateExplorer>,
  );
}

const panel = () => screen.getByRole("heading", { level: 2 }).parentElement!;
const search = () => screen.getByRole("combobox", { name: "Find a city" }) as HTMLInputElement;

describe("StateExplorer", () => {
  beforeEach(() => window.history.replaceState(null, "", "/fees/city/fl"));

  it("opens on the largest city with its branch count, fee data count and one comparison link", () => {
    renderExplorer();
    const p = panel();
    expect(within(p).getByRole("heading").textContent).toBe("Tampa");
    expect(p.textContent).toContain("78 banks and credit unions with local branches");
    expect(p.textContent).toContain("58 have published fee data in the index");
    expect(p.textContent).toContain("Coverage varies by institution and fee category.");
    expect(within(p).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Compare Tampa fees→", "/fees/city/fl/tampa"]]);
  });

  it("finds St. Petersburg from \"St Pete\" and moves the map to it", () => {
    const { container } = renderExplorer();
    fireEvent.change(search(), { target: { value: "St Pete" } });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["St. Petersburg50 institutions"]);
    fireEvent.click(options[0]);
    expect(within(panel()).getByRole("heading").textContent).toBe("St. Petersburg");
    expect(search().value).toBe("St. Petersburg");
    expect(container.querySelector('svg a[aria-current="true"]')!.getAttribute("href")).toBe("/fees/city/fl/st.%20petersburg");
    expect(new URL(window.location.href).searchParams.get("city")).toBe("st. petersburg");
  });

  it("chooses with the keyboard and folds Saint and St", () => {
    renderExplorer();
    fireEvent.change(search(), { target: { value: "port saint" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(within(panel()).getByRole("heading").textContent).toBe("Port St. Lucie");
  });

  it("fades markers the search does not match and says when nothing matches", () => {
    const { container } = renderExplorer();
    fireEvent.change(search(), { target: { value: "lauder" } });
    expect(container.querySelectorAll("svg circle.fill-surface-200").length).toBeGreaterThan(0);
    fireEvent.change(search(), { target: { value: "Sarasota" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/No Florida city matches/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Search institutions by name" }).getAttribute("href")).toBe("/institutions?q=Sarasota");
  });

  it("selecting a marker fills the search; without scripts a marker opens the city page", () => {
    const { container } = renderExplorer();
    const markers = [...container.querySelectorAll("svg a")];
    expect(markers.map((a) => a.getAttribute("href"))).toContain("/fees/city/fl/fort%20lauderdale");
    // The search does the same job, so the dots stay out of the tab order and the accessibility tree.
    markers.forEach((a) => expect(a.getAttribute("aria-hidden")).toBe("true"));
    fireEvent.click(markers.find((a) => a.getAttribute("href") === "/fees/city/fl/fort%20lauderdale")!);
    expect(search().value).toBe("Fort Lauderdale");
    expect(panel().textContent).toContain("34 have published fee data in the index");
  });

  it("opens on the city a shared ?city= link names, and says when a city has no marker", () => {
    window.history.replaceState(null, "", "/fees/city/fl?city=nowhere");
    renderExplorer();
    expect(within(panel()).getByRole("heading").textContent).toBe("Nowhere");
    expect(panel().textContent).toContain("no map coordinates");
  });
});
