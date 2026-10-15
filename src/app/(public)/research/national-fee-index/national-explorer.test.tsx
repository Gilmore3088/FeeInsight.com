// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FEE_PARAM, INSTITUTION_SEARCH_HREF, NationalExplorer, type FeeFamilyGroup } from "./national-explorer";
import type { DistrictMedian, NationalFinding } from "./findings";

afterEach(() => {
  cleanup();
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

function renderExplorer({ national = 30, cards = findings }: { national?: number | null; cards?: NationalFinding[] } = {}) {
  return render(
    <NationalExplorer
      header={<h1>Header</h1>}
      footer={null}
      findings={cards}
      groups={groups}
      isPro={false}
      overdraftDistricts={districts}
      overdraftNational={national}
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

  it("compares districts with the national median from the district read, not the table's", () => {
    // The table says $30; the same read as the district medians says $32.
    renderExplorer({ national: 32 });
    expect(panel().textContent).toContain("against the national $32");
    fireEvent.click(screen.getByRole("button", { name: /^Philadelphia/ }));
    expect(panel().textContent).toContain("Same as national");
  });

  it("hides the map when the district read has no national median", () => {
    renderExplorer({ national: null });
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
    expect(INSTITUTION_SEARCH_HREF).toBe("/institutions");
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
});
