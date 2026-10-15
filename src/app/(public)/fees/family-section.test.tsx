import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store";
import { FamilySection } from "./family-section";

const cat = {
  fee_category: "overdraft",
  median_amount: 30,
  p25_amount: 25,
  p75_amount: 33,
  min_amount: 0,
  max_amount: 50,
  institution_count: 2498,
  total_observations: 3031,
} as unknown as FeeCategorySummary;

describe("FamilySection on a phone", () => {
  it("fits a phone: no fixed minimum width below sm, so the table never scrolls sideways", () => {
    const { container } = render(<FamilySection familyName="Overdraft & NSF" cats={[cat]} />);
    const table = container.querySelector("table")!;
    const classes = table.className.split(/\s+/);
    expect(classes.some((c) => c.startsWith("min-w-"))).toBe(false);
    expect(classes).toContain("sm:min-w-[560px]");
  });

  it("shows the fee and its median, with the institution count under the name", () => {
    const { container } = render(<FamilySection familyName="Overdraft & NSF" cats={[cat]} />);
    const visibleOnPhone = [...container.querySelectorAll("th")]
      .filter((th) => !th.className.split(/\s+/).includes("hidden"))
      .map((th) => th.textContent);
    expect(visibleOnPhone).toEqual(["Fee", "Median"]);
    const firstCell = container.querySelector("td")!;
    expect(firstCell.textContent).toContain("2,498 institutions");
  });
});
