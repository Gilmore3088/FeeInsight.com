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

describe("StorylineView with Hamilton's memo", () => {
  const memo = {
    summary: "Your $32 sits above the peer median of $29.50.",
    board: "Board paragraph about money at stake.",
    market: "Market paragraph about positioning.",
    questions: ["What share of overdraft items fall on customers with recurring payroll?"],
    model: "test",
    generatedAt: "2026-10-06T00:00:00Z",
    figureCheck: { checked: 4, unmatched: [] },
  };

  it("puts the summary under the answer, each view's paragraph in its view and the questions under Before deciding", () => {
    const html = renderToStaticMarkup(<StorylineView story={sampleStoryline()} memo={{ state: "written", memo }} />);
    expect(html).toContain("above the peer median");
    expect(html).toContain("4 figures checked");
    expect(html).toContain("Board paragraph about money at stake.");
    expect(html).toContain("Before deciding");
    expect(html).toContain("recurring payroll");
  });

  it("shows a writing state, and one quiet line when no memo is written", () => {
    expect(renderToStaticMarkup(<StorylineView story={sampleStoryline()} memo={{ state: "writing" }} />)).toContain("Hamilton is writing this up");
    const none = renderToStaticMarkup(<StorylineView story={sampleStoryline()} memo={{ state: "none", reason: "Hamilton's daily writing budget is used up." }} />);
    expect(none).toContain("daily writing budget is used up");
    expect(none).not.toContain("Before deciding");
  });
});

describe("StorylineView sources", () => {
  const html = renderToStaticMarkup(<StorylineView story={sampleStoryline()} />);

  it("cites sources as numbered notes listed once at the foot, not a chip on every line", () => {
    expect(html).toContain("Sources");
    expect(html).toContain('id="story-source-1"');
    expect(html).toContain('href="#story-source-1"');
    expect(html).not.toContain("rounded border border-warm-200 bg-white px-1.5");
  });
});
