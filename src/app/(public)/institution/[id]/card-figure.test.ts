import { describe, expect, it } from "vitest";
import { formatCardFigure } from "./card-figure";

describe("formatCardFigure", () => {
  it("should_format_each_unit_as_its_final_text", () => {
    expect(formatCardFigure("dollars", 4_400_000_000)).toBe("$4.4B");
    expect(formatCardFigure("percent", 12.345)).toBe("12.3%");
    expect(formatCardFigure("count", 1183.4)).toBe("1,183");
  });

  it("should_keep_a_negative_value_negative_rather_than_hiding_it", () => {
    expect(formatCardFigure("percent", -2.5)).toBe("-2.5%");
  });
});
