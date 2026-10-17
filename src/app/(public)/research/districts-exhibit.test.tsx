import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DistrictsExhibit, type DistrictCard } from "./districts-exhibit";

const cards: DistrictCard[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: `District ${i + 1} name`,
  region: "the Southeast",
  statement: i === 0 ? "The overdraft median is $2 above the national median." : null,
  institutions: 100 + i,
  side: i % 3 === 0 ? "above" : i % 3 === 1 ? "below" : null,
  label: { x: 100, y: 100 },
}));

describe("DistrictsExhibit", () => {
  it("lists all 12 districts, each linking to its district page, with its opening line", () => {
    render(<DistrictsExhibit districts={cards} />);
    const list = screen.getByRole("list", { name: "Each district's opening finding" });
    const links = list.querySelectorAll("a");
    expect(links).toHaveLength(12);
    expect(links[5].getAttribute("href")).toBe("/research/district/6");
    expect(screen.getByText("The overdraft median is $2 above the national median.")).toBeTruthy();
  });

  it("keeps rows past the fifth for the Show all control on phones", () => {
    render(<DistrictsExhibit districts={cards} />);
    const rows = screen.getByRole("list", { name: "Each district's opening finding" }).querySelectorAll(":scope > li");
    expect(rows[5].className).toContain("hidden sm:block");
    const toggle = screen.getByRole("button", { name: "Show all 12 districts" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("district-cards");
    fireEvent.click(toggle);
    expect(rows[5].className).not.toContain("hidden");
    expect(screen.getByRole("button", { name: "Show fewer districts" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the map out of the accessibility tree and the tab order, with a visible legend", () => {
    const { container } = render(<DistrictsExhibit districts={cards} />);
    const svg = container.querySelector("figure svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect([...svg.querySelectorAll("a")].every((a) => a.getAttribute("tabindex") === "-1")).toBe(true);
    expect(screen.getByText("Too few overdraft fees to compare")).toBeTruthy();
  });
});
