import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorylineView } from "./StorylineView";
import { sampleStoryline } from "./test-fixture";

describe("StorylineView", () => {
  const html = renderToStaticMarkup(<StorylineView story={sampleStoryline()} />);

  it("leads with the governing thought and key figures", () => {
    expect(html).toContain("The answer");
    expect(html).toContain("one of 6 without a daily cap");
    expect(html).toContain("12 of 18");
  });

  it("numbers every exhibit under its action title", () => {
    for (let n = 1; n <= 5; n++) expect(html).toContain(`Exhibit ${n}`);
    expect(html).toContain("Caps, not prices, are where you differ most");
    expect(html).toContain("Not published");
    expect(html).toContain("No overdraft line on file");
    expect(html).toContain("Low and capped");
  });

  it("carries both readers' views and options without a pick", () => {
    expect(html).toContain("Board view");
    expect(html).toContain("Market view");
    expect(html).toContain("Options and what each would mean");
    expect(html).toContain("the choice is your team");
    expect(html).not.toMatch(/recommend/i);
  });
});
