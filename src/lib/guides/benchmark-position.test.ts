import { describe, expect, it } from "vitest";
import { GUIDES } from "./index";
import { HIGHEST_PRICED_QUARTER, LOWEST_PRICED_QUARTER, benchmarkPositionMeaning } from "./benchmark-position";

describe("guide benchmark tables state position only (#1181)", () => {
  it("never claims a share of institutions in a threshold row", () => {
    for (const guide of GUIDES) {
      for (const section of guide.sections) {
        for (const block of section.blocks) {
          if (block.type !== "benchmark") continue;
          for (const row of block.rows) {
            expect(row.meaning, `${guide.slug}: ${row.meaning}`).not.toMatch(/\d+%/);
          }
        }
      }
    }
  });

  it("reads a stored guide's old share claims as the position wording", () => {
    expect(benchmarkPositionMeaning("Better than 75% of institutions")).toBe(LOWEST_PRICED_QUARTER);
    expect(benchmarkPositionMeaning("You pay more than 75% of the country")).toBe(HIGHEST_PRICED_QUARTER);
    expect(benchmarkPositionMeaning("You pay more than 75% of the country, with no daily limit")).toBe(
      `${HIGHEST_PRICED_QUARTER}, with no daily limit`,
    );
  });

  it("leaves every other meaning as written", () => {
    expect(benchmarkPositionMeaning("Right at the national median")).toBe("Right at the national median");
    expect(benchmarkPositionMeaning("The current market standard")).toBe("The current market standard");
  });
});
