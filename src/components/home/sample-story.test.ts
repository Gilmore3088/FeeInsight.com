import { describe, expect, it } from "vitest";
import { buildSampleStory, pickStoryLine, positionWords, type SampleLine } from "./sample-story";

const line = (key: string, label: string): SampleLine => ({
  key,
  label,
  amount: 10,
  sourceLine: `${label} $10.00`,
  readOn: "2026-10-08",
  market: null,
  position: "in_market",
});

describe("pickStoryLine", () => {
  const lines = [line("monthly_maintenance", "Monthly maintenance"), line("overdraft", "Overdraft (per item)")];

  it("should_follow_the_line_the_first_finding_names", () => {
    expect(pickStoryLine(lines, "Your overdraft (per item) fee ($10) is below the local range").key).toBe("overdraft");
  });

  it("should_fall_back_to_overdraft_when_no_line_is_named", () => {
    expect(pickStoryLine(lines, "5 of your 7 comparable fee lines sit inside the middle half").key).toBe("overdraft");
  });

  it("should_fall_back_to_the_first_line_without_overdraft", () => {
    expect(pickStoryLine([lines[0]], "").key).toBe("monthly_maintenance");
  });
});

describe("buildSampleStory", () => {
  it("should_return_null_without_a_sample_report", () => {
    expect(buildSampleStory(null)).toBeNull();
  });
});

describe("positionWords", () => {
  it("should_pair_every_position_with_a_word_and_glyph", () => {
    expect(positionWords("above_market")).toBe("Above ▲");
    expect(positionWords(null)).toBe("");
  });
});
