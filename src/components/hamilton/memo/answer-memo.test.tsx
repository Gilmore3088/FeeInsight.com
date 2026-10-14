import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildFeeAnswer } from "@/lib/hamilton/workspace/answer";
import { overdraftResearch } from "@/lib/hamilton/workspace/test-fixtures";
import { AnswerMemo, keyFiguresFor, withFiguresBold } from "./answer-memo";

describe("AnswerMemo", () => {
  it("reads the key figures from the exhibit's data", () => {
    const answer = buildFeeAnswer(overdraftResearch());
    const figures = keyFiguresFor(answer.exhibit);
    expect(figures.length).toBeGreaterThan(1);
    expect(figures.some((f) => f.label.startsWith("Median"))).toBe(true);
  });

  it("lays out the answer, figures, a numbered exhibit and numbered takeaways", () => {
    const answer = buildFeeAnswer(overdraftResearch());
    const html = renderToStaticMarkup(<AnswerMemo answer={answer} />);
    expect(html).toContain("The answer");
    expect(html).toContain(answer.headline.replace(/'/g, "&#x27;"));
    expect(html).toContain("Exhibit 1");
    expect(html).toContain("What the data says");
    expect(html).toContain(">01<");
    expect(html).not.toMatch(/recommend/i);
  });

  it("sets dollar figures, percents and counts in bold", () => {
    const html = renderToStaticMarkup(<p>{withFiguresBold("12 of 40 peers charge $35, up 4.5%.")}</p>);
    expect(html).toContain("<strong");
    expect(html.match(/<strong/g)).toHaveLength(3);
  });

  it("gives competitor ranges and trends their own figures", () => {
    expect(
      keyFiguresFor({ kind: "competitor_range", title: "t", unit: "dollars", own: 30, ownLabel: "Example Bank", items: [{ name: "A", amount: 25, url: null }, { name: "B", amount: 35, url: null }], sources: [] }),
    ).toEqual([
      { value: "$30", label: "Example Bank" },
      { value: "$25 to $35", label: "Range across 2 named institutions" },
      { value: "1 of 2", label: "Charge less than Example Bank" },
    ]);
    expect(
      keyFiguresFor({ kind: "trend", title: "t", unit: "dollars", series: [{ label: "Income", points: [{ date: "2025-01-01", value: 100 }, { date: "2026-01-01", value: 110 }] }], sources: [] })[1].value,
    ).toBe("+10.0%");
  });
});

describe("withFiguresBold units", () => {
  it("keeps a size or amount with its unit in one bold run", () => {
    const html = renderToStaticMarkup(<p>{withFiguresBold("2 of 6 $10B+ institutions; income $209 thousand.")}</p>);
    expect(html).toContain("$10B+</strong>");
    expect(html).toContain("$209 thousand</strong>");
  });
});
