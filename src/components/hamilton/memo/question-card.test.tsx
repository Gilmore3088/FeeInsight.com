import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionCard } from "./memo";

describe("QuestionCard", () => {
  it("asks one question in place and keeps the page's other settings", () => {
    const html = renderToStaticMarkup(
      <QuestionCard
        prompt="About how many overdraft fees did you charge in the last 12 months, before waivers?"
        why="With it, each price shows a yearly figure."
        name="paid"
        inputKind="number"
        action="/pro/simulate"
        keep={{ fee: "overdraft", layer: "state", prices: undefined, instId: "42" }}
      />,
    );
    expect(html).toContain("Hamilton has one question");
    expect(html).toContain('name="paid"');
    expect(html).toContain('name="fee" value="overdraft"');
    expect(html).toContain('name="instId" value="42"');
    expect(html).not.toContain('name="prices"');
    expect(html).not.toContain("font-mono");
  });

  it("marks a percent answer", () => {
    const html = renderToStaticMarkup(
      <QuestionCard prompt="What share did you waive?" why="x" name="waiver" inputKind="percent" action="/pro/simulate" keep={{}} />,
    );
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain("%</span>");
  });
});
