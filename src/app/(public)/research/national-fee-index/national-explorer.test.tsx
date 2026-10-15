// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PRIMARY_CTA_NAV } from "@/components/nav-items";
import { FEE_PARAM, INSTITUTION_SEARCH_HREF, NationalExplorer, type FeeFamilyGroup } from "./national-explorer";
import type { DistrictMedian, NationalFinding } from "./findings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/research/national-fee-index");
});

const row = (fee_category: string, fee_family: string, median: number, p25: number, p75: number, max: number, n: number) => ({
  fee_category,
  fee_family,
  median_amount: median,
  p25_amount: p25,
  p75_amount: p75,
  min_amount: 0,
  max_amount: max,
  institution_count: n,
});

const groups: FeeFamilyGroup[] = [
  { family: "Overdraft & NSF", entries: [row("nsf", "Overdraft & NSF", 30, 25, 32, 53, 2666), row("overdraft", "Overdraft & NSF", 30, 25, 33, 50, 2497)] },
  { family: "Check Services", entries: [row("stop_payment", "Check Services", 27.5, 21.75, 30, 50, 3175)] },
  { family: "ATM & Card", entries: [row("atm_international", "ATM & Card", 2, 1, 3, 5, 900)] },
];

const districts: DistrictMedian[] = [
  { district: 3, name: "Philadelphia", median: 32, institutions: 97 },
  { district: 12, name: "San Francisco", median: 25, institutions: 269 },
];

const findings: NationalFinding[] = [
  {
    key: "most_published",
    text: "Stop Payment is the fee the most institutions publish (3,175), with a median of $27.50.",
    category: "stop_payment",
    label: "Stop Payment",
    institutions: 3175,
    leaders: [
      { category: "stop_payment", label: "Stop Payment", institutions: 3175 },
      { category: "nsf", label: "NSF / Returned Item", institutions: 2666 },
    ],
  },
];

function renderExplorer({ cards = findings, districtRows = districts }: { cards?: NationalFinding[]; districtRows?: DistrictMedian[] } = {}) {
  return render(
    <NationalExplorer
      header={<h1>Header</h1>}
      footer={null}
      findings={cards}
      groups={groups}
      isPro={false}
      overdraftDistricts={districtRows}
      cpiSourceUrl="https://data.bls.gov/"
    />,
  );
}

const panel = () => document.getElementById("fee-panel")!;

describe("NationalExplorer", () => {
  it("opens on overdraft, with its range and the district map", () => {
    renderExplorer();
    expect(within(panel()).getByRole("heading", { level: 2 }).textContent).toBe("Overdraft (OD)");
    expect(within(panel()).getByText("$25 to $33")).toBeTruthy();
    expect(within(panel()).getByText("By Fed district")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Overdraft (OD)", pressed: true })).toBeTruthy();
  });

  it("selecting a row updates the panel and marks that row selected", () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "Stop Payment", pressed: false }));
    expect(within(panel()).getByRole("heading", { level: 2 }).textContent).toBe("Stop Payment");
    expect(within(panel()).getByText("$27.50")).toBeTruthy();
    expect(within(panel()).getByText("$21.75 to $30")).toBeTruthy();
    // The district map is overdraft's only.
    expect(within(panel()).queryByText("By Fed district")).toBeNull();
    expect(screen.getByRole("button", { name: "Stop Payment", pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Overdraft (OD)", pressed: false })).toBeTruthy();
  });

  it("selects a fee from a row click and from a bar in the most-published card", () => {
    const { container } = renderExplorer();
    const nsfRow = [...container.querySelectorAll("tbody tr")].find((tr) => tr.querySelector("button")?.textContent === "NSF / Returned Item")!;
    fireEvent.click(nsfRow);
    expect(within(panel()).getByRole("heading", { level: 2 }).textContent).toBe("NSF / Returned Item");
    expect(nsfRow.getAttribute("data-selected")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /^Show Stop Payment/ }));
    expect(within(panel()).getByRole("heading", { level: 2 }).textContent).toBe("Stop Payment");
  });

  it("a district selection names that district's median against the national one", () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /^San Francisco/ }));
    expect(panel().textContent).toContain("San Francisco: $25 median");
    expect(panel().textContent).toContain("Below national");
  });

  it("sends no bank or credit union counts to a free reader's table", () => {
    const { container } = renderExplorer();
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Fee", "Median", "Institutions"]);
  });

  it("shows one national overdraft median in the panel and compares districts with it", () => {
    // The panel's headline is the table's $30; the map line and each district's position use that same figure.
    renderExplorer();
    expect(panel().textContent).toContain("against the national $30");
    expect(panel().textContent).not.toMatch(/national \$(?!30\b)\d/);
    fireEvent.click(screen.getByRole("button", { name: /^Philadelphia/ }));
    expect(panel().textContent).toContain("Above national");
  });

  it("hides the map when no district has a median", () => {
    renderExplorer({ districtRows: districts.map((d) => ({ ...d, median: null })) });
    expect(within(panel()).queryByText("By Fed district")).toBeNull();
  });

  it("links a district readout to that district's page", () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /^San Francisco/ }));
    expect(within(panel()).getByRole("link", { name: "San Francisco" }).getAttribute("href")).toBe("/research/district/12");
  });

  it("shows the district medians as a visible list on a phone, not a screen-reader-only one", () => {
    renderExplorer();
    const list = within(panel()).getByRole("list", { name: "Overdraft median by Fed district" });
    expect(list.className).not.toMatch(/sr-only/);
    expect(list.className).toMatch(/\bgrid-cols-3\b/);
    expect(within(list).getAllByRole("button")).toHaveLength(districts.length);
    expect(list.textContent).toContain("Philadelphia");
    expect(list.textContent).toContain("$32");
  });

  it("ends the panel with a text link to the institution search, naming the selected fee", () => {
    renderExplorer();
    const link = within(panel()).getByRole("link", { name: "See where your fees stand" });
    expect(link.getAttribute("href")).toBe(INSTITUTION_SEARCH_HREF);
    expect(INSTITUTION_SEARCH_HREF).toBe(PRIMARY_CTA_NAV.href);
    expect(link.parentElement?.textContent).toBe("Where does your Overdraft (OD) fee sit? See where your fees stand");
    fireEvent.click(screen.getByRole("button", { name: "Stop Payment", pressed: false }));
    expect(panel().textContent).toContain("Where does your Stop Payment fee sit?");
  });

  it("writes the selected fee to the URL and opens on the fee a link names", () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "Stop Payment", pressed: false }));
    expect(new URLSearchParams(window.location.search).get(FEE_PARAM)).toBe("stop_payment");
    cleanup();

    window.history.replaceState(null, "", `/research/national-fee-index?${FEE_PARAM}=nsf`);
    renderExplorer();
    expect(within(panel()).getByRole("heading", { level: 2 }).textContent).toBe("NSF / Returned Item");
  });

  it("ignores a URL fee the reader's table does not hold", () => {
    window.history.replaceState(null, "", `/research/national-fee-index?${FEE_PARAM}=wire_domestic_outgoing`);
    renderExplorer();
    expect(within(panel()).getByRole("heading", { level: 2 }).textContent).toBe("Overdraft (OD)");
  });

  it("links a leader bar the table cannot select to its fee page instead of a dead bar", () => {
    renderExplorer({
      cards: [
        {
          ...findings[0],
          category: "wire_domestic_outgoing",
          label: "Wire Transfer (Domestic)",
          institutions: 4000,
          leaders: [
            { category: "wire_domestic_outgoing", label: "Wire Transfer (Domestic)", institutions: 4000 },
            { category: "stop_payment", label: "Stop Payment", institutions: 3175 },
          ],
        } as NationalFinding,
      ],
    });
    const link = screen.getByRole("link", { name: /^Wire Transfer \(Domestic\)/ });
    expect(link.getAttribute("href")).toBe("/fees/wire_domestic_outgoing");
    expect(screen.getByRole("button", { name: /^Show Stop Payment/ })).toBeTruthy();
  });

  it("gives the overdraft card's button a short name, not the whole range sentence", () => {
    renderExplorer({
      cards: [
        {
          key: "overdraft",
          text: "The median overdraft fee is $30.",
          median: 30,
          institutions: 2497,
          range: { min: 0, p25: 25, median: 30, p75: 33, max: 50 },
        },
      ],
    });
    const button = screen.getByRole("button", { name: "Show overdraft: $30 median, 2,497 institutions" });
    expect(button.getAttribute("aria-label")).not.toMatch(/middle half/i);
  });

  it("names what the CPI figure is compared against in its visible label", () => {
    renderExplorer({
      cards: [{ key: "cpi", text: "Prices for bank services rose 1.2%.", month: "September 2026", bankPct: 1.2, allPct: 3.7 } as NationalFinding],
    });
    expect(document.body.textContent).toContain("Bank services prices, year to September 2026, against +3.7% for all items.");
  });

  it("notes that percentage-stated fees are kept out of a dollar median, only where they can occur", () => {
    renderExplorer();
    expect(panel().querySelector("[data-rate-note]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "International ATM", pressed: false }));
    expect(panel().querySelector("[data-rate-note]")?.textContent).toContain("A fee stated as a percentage is counted separately");
  });

  it("on a phone, a row tap offers a way back to that row", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {} }));
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    renderExplorer();
    expect(within(panel()).queryByRole("button", { name: /Back to the table/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop Payment", pressed: false }));
    expect(scrolled.at(-1)?.id).toBe("fee-panel");
    fireEvent.click(within(panel()).getByRole("button", { name: /Back to the table/ }));
    expect(scrolled.at(-1)?.getAttribute("data-fee-row")).toBe("stop_payment");
    expect(within(panel()).queryByRole("button", { name: /Back to the table/ })).toBeNull();
  });

  it("offers no way back after a card or panel selection", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {} }));
    Element.prototype.scrollIntoView = () => {};
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /^Show Stop Payment/ }));
    expect(within(panel()).queryByRole("button", { name: /Back to the table/ })).toBeNull();
  });
});
