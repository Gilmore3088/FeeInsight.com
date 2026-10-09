import { describe, expect, it } from "vitest";
import { sortFamilyRows, type FamilyTableRow } from "./sortable-family-table";

function row(category: string, median: number | null, institutions: number): FamilyTableRow {
  return { category, label: category, median, p25: median, p75: median, min: median, max: median, institutions };
}

const ROWS = [row("wire", 25, 40), row("atm", null, 10), row("nsf", 32, 120), row("card", 5, 60)];

describe("sortFamilyRows", () => {
  it("sorts figures either way and keeps a missing figure last", () => {
    expect(sortFamilyRows(ROWS, "median", "descending").map((r) => r.category)).toEqual(["nsf", "wire", "card", "atm"]);
    expect(sortFamilyRows(ROWS, "median", "ascending").map((r) => r.category)).toEqual(["card", "wire", "nsf", "atm"]);
  });

  it("sorts names alphabetically and institution counts numerically", () => {
    expect(sortFamilyRows(ROWS, "label", "ascending").map((r) => r.category)).toEqual(["atm", "card", "nsf", "wire"]);
    expect(sortFamilyRows(ROWS, "institutions", "descending").map((r) => r.institutions)).toEqual([120, 60, 40, 10]);
  });

  it("returns a new array and leaves the server order alone", () => {
    const before = ROWS.map((r) => r.category);
    sortFamilyRows(ROWS, "median", "ascending");
    expect(ROWS.map((r) => r.category)).toEqual(before);
  });
});
