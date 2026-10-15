// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NationalExplorer, type FeeFamilyGroup } from "./national-explorer";
import type { DistrictMedian, NationalFinding } from "./findings";

afterEach(cleanup);

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

function renderExplorer() {
  return render(
    <NationalExplorer
      header={<h1>Header</h1>}
      footer={null}
      findings={findings}
      groups={groups}
      isPro={false}
      overdraftDistricts={districts}
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
});
