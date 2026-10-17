import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArticleExhibit } from "./article-exhibits";

const rows = Array.from({ length: 9 }, (_, i) => [`State ${i + 1}`, String(20 + i), `$${25 + i}`]);

describe("ArticleExhibit", () => {
  it("shows five rows of a long table, then all of them", () => {
    render(<ArticleExhibit exhibit={{ kind: "table", label: "Institutions and median, by state", table: { head: ["State", "Institutions", "Median"], rows } }} />);
    expect(screen.getByText("Institutions and median, by state")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(1 + 5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 9 rows" }));
    expect(screen.getAllByRole("row")).toHaveLength(1 + 9);
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();
  });

  it("draws a chart's bars with the shown values and its figures table beneath", () => {
    render(
      <ArticleExhibit
        exhibit={{
          kind: "bars",
          label: "Median fee, by size",
          rows: [
            { label: "Small", value: 30, shown: "$30" },
            { label: "**Large**", value: 35, shown: "$35" },
          ],
          table: { head: ["Size", "Median"], rows: [["Small", "$30"]] },
        }}
      />,
    );
    const list = screen.getByRole("list", { name: "Median fee, by size" });
    expect(list.textContent).toContain("$30");
    expect(list.querySelector("strong")?.textContent).toBe("Large");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("folds a long chart at five bars and right-aligns a figure column with dashes", () => {
    const bars = Array.from({ length: 9 }, (_, i) => ({ label: `Group ${i + 1}`, value: i + 1, shown: `$${i + 1}` }));
    render(<ArticleExhibit exhibit={{ kind: "bars", label: "Long chart", rows: bars, table: { head: ["Group", "Median"], rows: [["A", "-"], ["B", "$30"]] } }} />);
    expect(within(screen.getByRole("list", { name: "Long chart" })).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 9 bars" }));
    expect(within(screen.getByRole("list", { name: "Long chart" })).getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByRole("columnheader", { name: "Median" }).className).toContain("text-right");
    expect(screen.getByRole("region", { name: "Long chart, figures" }).getAttribute("tabindex")).toBe("0");
  });

  it("escapes raw HTML in cells", () => {
    const { container } = render(
      <ArticleExhibit exhibit={{ kind: "table", label: "T", table: { head: ["A"], rows: [["<script>x</script>"]] } }} />,
    );
    expect(container.querySelector("script")).toBeNull();
  });
});
