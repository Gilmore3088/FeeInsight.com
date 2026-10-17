import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DistrictsExhibit, type DistrictCard } from "./districts-exhibit";

const cards: DistrictCard[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: `District ${i + 1} name`,
  region: "the Southeast",
  statement: i === 0 ? "The overdraft median is $2 above the national median." : null,
  institutions: 100 + i,
  label: { x: 100, y: 100 },
}));

describe("DistrictsExhibit", () => {
  it("lists all 12 districts, each linking to its district page, with its opening line", () => {
    render(<DistrictsExhibit districts={cards} />);
    const list = screen.getByRole("list", { name: "Federal Reserve districts" });
    const links = list.querySelectorAll("a");
    expect(links).toHaveLength(12);
    expect(links[5].getAttribute("href")).toBe("/research/district/6");
    expect(screen.getByText("The overdraft median is $2 above the national median.")).toBeTruthy();
  });

  it("keeps rows past the fifth for the Show all control on phones", () => {
    render(<DistrictsExhibit districts={cards} />);
    const rows = screen.getByRole("list", { name: "Federal Reserve districts" }).querySelectorAll("li");
    expect(rows[5].className).toContain("hidden sm:block");
    fireEvent.click(screen.getByRole("button", { name: "Show all 12 districts" }));
    expect(rows[5].className).not.toContain("hidden");
  });
});
