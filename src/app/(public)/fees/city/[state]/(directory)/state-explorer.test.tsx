import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stateMarketMap } from "@/lib/geo/state-market-map";
import { StateExplorer, type ExplorerCity } from "./state-explorer";

const cities: ExplorerCity[] = [
  { key: "tampa", name: "Tampa", href: "/fees/city/fl/tampa", institutions: 78, withFees: 58 },
  { key: "orlando", name: "Orlando", href: "/fees/city/fl/orlando", institutions: 50, withFees: 41 },
  { key: "fort lauderdale", name: "Fort Lauderdale", href: "/fees/city/fl/fort%20lauderdale", institutions: 40, withFees: 34 },
  { key: "nowhere", name: "Nowhere", href: "/fees/city/fl/nowhere", institutions: 2, withFees: 1 },
];
const map = stateMarketMap("FL", [
  { key: "tampa", lat: 27.98, lon: -82.5 },
  { key: "orlando", lat: 28.51, lon: -81.38 },
  { key: "fort lauderdale", lat: 26.14, lon: -80.14 },
  // A bad coordinate far outside Florida is dropped, not drawn.
  { key: "nowhere", lat: 47.6, lon: -122.3 },
]);

function renderExplorer(initialCity = "tampa") {
  return render(
    <StateExplorer map={map} cities={cities} initialCity={initialCity} initialQuery="" initialAll={false} stateName="Florida" stateCode="FL" />,
  );
}

const panelText = () => screen.getByRole("heading", { level: 2, name: /^(Tampa|Orlando|Fort Lauderdale|Nowhere)$/ }).parentElement!;

describe("StateExplorer", () => {
  it("draws a marker per located city, each a no-script link to ?city=", () => {
    const { container } = renderExplorer();
    expect(map?.points.map((p) => p.key)).toEqual(["tampa", "orlando", "fort lauderdale"]);
    const links = [...container.querySelectorAll("svg a")];
    expect(links.map((a) => a.getAttribute("href"))).toContain("?city=orlando#explorer");
    expect(links.map((a) => a.getAttribute("href"))).toContain("?city=fort+lauderdale#explorer");
    // The city menu does the same job, so the ~400 dots stay out of the tab order and the accessibility tree.
    links.forEach((a) => expect(a.getAttribute("aria-hidden")).toBe("true"));
  });

  it("selecting a marker shows the city, its coverage and its comparison link", () => {
    const { container } = renderExplorer();
    fireEvent.click(container.querySelector('svg a[aria-label="Orlando: 41 of 50 institutions have published fees"]')!);
    const panel = panelText();
    expect(panel.textContent).toContain("41 of 50 institutions have published fees");
    expect(within(panel).getByRole("link", { name: /Compare Orlando fees/ }).getAttribute("href")).toBe("/fees/city/fl/orlando");
    expect(new URL(window.location.href).searchParams.get("city")).toBe("orlando");
  });

  it("opens on the city a ?city= link asked for, and says when a city is not on the map", () => {
    renderExplorer("nowhere");
    expect(panelText().textContent).toContain("Not on the map");
  });

  it("selects the one city a search matches and filters the list below", () => {
    renderExplorer();
    fireEvent.change(screen.getByLabelText("Find your city"), { target: { value: "orl" } });
    expect(within(panelText()).getByRole("link", { name: /Compare Orlando fees/ })).toBeTruthy();
    const list = screen.getByRole("region", { name: "Every Florida city" });
    expect(within(list).getAllByRole("link").map((a) => a.textContent)).toEqual(["Orlando41 of 50 with fees"]);
  });

  it("carries the search and the full list through no-script links and forms", () => {
    const { container } = render(
      <StateExplorer map={map} cities={cities} initialCity="tampa" initialQuery="or" initialAll stateName="Florida" stateCode="FL" />,
    );
    expect(container.querySelector('svg a[aria-label^="Orlando"]')!.getAttribute("href")).toBe("?q=or&all=1&city=orlando#explorer");
    const menuForm = (screen.getByLabelText("City on the map") as HTMLSelectElement).form!;
    expect(Object.fromEntries(new FormData(menuForm))).toEqual({ q: "or", all: "1", city: "tampa" });
    const searchForm = (screen.getByLabelText("Find your city") as HTMLInputElement).form!;
    expect(Object.fromEntries(new FormData(searchForm))).toEqual({ city: "tampa", all: "1", q: "or" });
  });

  it("selects from the city menu, which also works as a plain GET form", () => {
    renderExplorer();
    const menu = screen.getByLabelText("City on the map") as HTMLSelectElement;
    expect(menu.name).toBe("city");
    fireEvent.change(menu, { target: { value: "fort lauderdale" } });
    expect(within(panelText()).getByRole("link", { name: /Compare Fort Lauderdale fees/ }).getAttribute("href")).toBe("/fees/city/fl/fort%20lauderdale");
  });
});
