import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DistrictsExhibit, gapWords, type DistrictCard, type MapFee } from "./districts-exhibit";

const cards: DistrictCard[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: `District ${i + 1} name`,
  region: "the Southeast",
  institutions: 100 + i,
  fees: {
    overdraft: { side: i % 3 === 0 ? "above" : i % 3 === 1 ? "below" : null, median: 35, us: 32 },
    nsf: { side: i < 2 ? "same" : null, median: i < 2 ? 30 : null, us: 30 },
  },
  label: { x: 100, y: 100 },
}));

const fees: MapFee[] = [
  { key: "overdraft", name: "Overdraft" },
  { key: "nsf", name: "NSF" },
];

const props = {
  districts: cards,
  mapFees: fees,
  initialFee: "overdraft",
  findings: { overdraft: "Overdraft finding line.", nsf: "NSF finding line." },
  fallback: "Fallback line.",
  minInstitutions: 10,
};

describe("DistrictsExhibit", () => {
  it("lists all 12 districts, each linking to its district page, every card on the selected fee", () => {
    render(<DistrictsExhibit {...props} />);
    const list = screen.getByRole("list", { name: "Overdraft median in each district, against the U.S." });
    const links = list.querySelectorAll("a");
    expect(links).toHaveLength(12);
    expect(links[5].getAttribute("href")).toBe("/research/district/6");
    expect(screen.getAllByText("$3 above U.S. (9%)").length).toBe(4);
    expect(screen.getAllByText("Overdraft: fewer than 10 institutions publish it").length).toBe(4);
  });

  it("states the actual gap, even within 1%", () => {
    expect(gapWords({ side: "same", median: 29.8, us: 30 })).toBe("within 1% of U.S.");
    expect(gapWords({ side: "below", median: 29, us: 30 })).toBe("$1 below U.S. (3%)");
    expect(gapWords({ side: null, median: null, us: 30 })).toBe("");
  });

  it("keeps rows past the fifth for the Show all control on phones", () => {
    render(<DistrictsExhibit {...props} />);
    const rows = screen.getByRole("list", { name: "Overdraft median in each district, against the U.S." }).querySelectorAll(":scope > li");
    expect(rows[5].className).toContain("hidden sm:block");
    const toggle = screen.getByRole("button", { name: "Show all 12 districts" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("district-cards");
    fireEvent.click(toggle);
    expect(rows[5].className).not.toContain("hidden");
    expect(screen.getByRole("button", { name: "Show fewer districts" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the map out of the accessibility tree and the tab order, with a visible legend", () => {
    const { container } = render(<DistrictsExhibit {...props} />);
    const svg = container.querySelector("figure svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect([...svg.querySelectorAll("a")].every((a) => a.getAttribute("tabindex") === "-1")).toBe(true);
    expect(screen.getByText("Fewer than 10 institutions publish it")).toBeTruthy();
  });

  it("re-shades for the selected fee and keeps the legend in step", () => {
    render(<DistrictsExhibit {...props} />);
    const select = screen.getByLabelText("Fee") as HTMLSelectElement;
    expect(screen.getByText("Overdraft median against the national median, by Federal Reserve district")).toBeTruthy();
    expect(screen.getByText("Overdraft finding line.")).toBeTruthy();
    fireEvent.change(select, { target: { value: "nsf" } });
    expect(screen.getByText("NSF median against the national median, by Federal Reserve district")).toBeTruthy();
    expect(screen.getByText("NSF finding line.")).toBeTruthy();
    // Two districts compare on NSF; the other ten are hatched.
    expect(screen.getByText("(10)")).toBeTruthy();
    // Every card now follows NSF: two compare, within 1%, with both figures shown.
    expect(screen.getAllByText("within 1% of U.S.")).toHaveLength(2);
    expect(screen.getByRole("list", { name: "NSF median in each district, against the U.S." })).toBeTruthy();
  });
});
