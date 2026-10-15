import { describe, expect, it } from "vitest";
import { readingMinutes, splitLeadChart } from "./article-view";

describe("article lead chart", () => {
  it("lifts the first chart block out of the body", () => {
    const content = "Intro.\n\n```bars Overdraft by size\nSmall | 30 | $30\nLarge | 35 | $35\n```\n\nMore.\n\n```bars Second\nA | 1 | $1\n```";
    const { lead, body } = splitLeadChart(content);
    expect(lead).toBe("```bars Overdraft by size\nSmall | 30 | $30\nLarge | 35 | $35\n```");
    expect(body).toBe("Intro.\n\nMore.\n\n```bars Second\nA | 1 | $1\n```");
  });

  it("leaves an article with no chart as it is", () => {
    expect(splitLeadChart("Just text.\n\nMore text.")).toEqual({ lead: null, body: "Just text.\n\nMore text." });
  });

  it("ignores a chart block that never closes", () => {
    expect(splitLeadChart("```bars Open\nA | 1 | $1").lead).toBeNull();
  });
});

describe("article reading time", () => {
  it("rounds to whole minutes and never shows zero", () => {
    expect(readingMinutes("one two three")).toBe(1);
    expect(readingMinutes(Array(690).fill("word").join(" "))).toBe(3);
  });
});
