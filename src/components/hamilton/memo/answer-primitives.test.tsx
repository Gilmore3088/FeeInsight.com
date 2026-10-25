/**
 * H05-T03 style regression: every answer branch draws its lead, key figures, section headings,
 * exhibits and sourced findings through the shared primitives in memo.tsx, so the same fact is
 * set the same way on each branch. Fixtures are invented.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ANSWER_TYPE, AnswerLead, Exhibit, KeyFigures, dayDate, figureSize } from "./memo";
import { AnswerMemo } from "./answer-memo";
import { AnswerView, FactList, type AnswerSpec } from "./exhibit-view";
import { SegmentTable, dailyLimitText } from "./segment-table";
import { FactList as ScheduleFactList } from "@/components/hamilton/analyze/schedule-answer";
import { StorylineView } from "@/components/hamilton/storyline/StorylineView";
import { StoryExhibitView } from "@/components/hamilton/storyline/story-exhibits";
import { sampleStoryline } from "@/components/hamilton/storyline/test-fixture";

const src = { label: "Bank Fee Index, published fee schedules", table: "published_fee_catalog", asOf: "2026-09-30" };
const answer: AnswerSpec = {
  feeCategory: "overdraft",
  headline: "Example Bank's overdraft fee is $32; the median is $30.",
  claims: [{ text: "The median across 412 banks is $30.", source: src, sampleSize: 412 }],
  drivers: [{ text: "A daily cap of 3 items limits the cost.", source: src }],
  exhibit: {
    kind: "fee_position",
    title: "Example Bank sits $2 above the median",
    unit: "dollars",
    own: 32,
    ownLabel: "Example Bank",
    band: { label: "Banks, $1B to $10B", p25: 27, median: 30, p75: 34, n: 412 },
    markers: [],
    sources: [src],
  },
  question: null,
  evidenceLevel: "market",
};

/** The class list of the first element carrying `marker`. */
function classesOf(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<", at);
  const tag = html.slice(open, html.indexOf(">", open));
  return /class="([^"]*)"/.exec(tag)?.[1] ?? "";
}

describe("shared answer primitives", () => {
  it("sets the governing thought the same way on the memo, storyline and research answers", () => {
    const memo = renderToStaticMarkup(<AnswerMemo answer={answer} />);
    const story = renderToStaticMarkup(<StorylineView story={sampleStoryline()} />);
    const research = renderToStaticMarkup(<AnswerView answer={answer} />);
    const lead = renderToStaticMarkup(<AnswerLead>x</AnswerLead>);
    for (const html of [memo, story, lead]) expect(html).toContain(`class="mt-1 ${ANSWER_TYPE.lead}"`);
    expect(research).toContain(`class="${ANSWER_TYPE.lead}"`);
    expect(memo).toContain(">Summary<");
    expect(story).toContain(">Summary<");
  });

  it("draws key figures as one tile strip, long figures one size down", () => {
    const html = renderToStaticMarkup(
      <KeyFigures figures={[{ value: "$32", label: "Your fee", title: "Your fee" }, { value: "$27 to $34", label: "Middle half", title: "Middle half" }]} />,
    );
    expect(classesOf(html, ">$32<")).toContain("text-2xl");
    expect(classesOf(html, ">$27 to $34<")).toContain("text-xl");
    expect(figureSize("$1.9 million")).toBe("text-xl");
    const memo = renderToStaticMarkup(<AnswerMemo answer={answer} />);
    const story = renderToStaticMarkup(<StorylineView story={sampleStoryline()} />);
    const strip = "grid gap-px overflow-hidden rounded-lg border border-warm-300 bg-warm-300";
    expect(classesOf(memo, "<dl")).toContain(strip);
    expect(classesOf(story, "<dl")).toContain(strip);
  });

  it("uses one section heading on the memo and the storyline", () => {
    const memo = renderToStaticMarkup(<AnswerMemo answer={answer} />);
    const story = renderToStaticMarkup(<StorylineView story={sampleStoryline()} />);
    expect(classesOf(memo, ">What the data says<")).toBe(`mb-3 ${ANSWER_TYPE.section}`);
    expect(classesOf(story, ">Where things stand<")).toBe(`mb-3 ${ANSWER_TYPE.section}`);
  });

  it("frames every exhibit, the segment table and the plain Exhibit included, in the report look", () => {
    const seg = renderToStaticMarkup(
      <SegmentTable
        data={{
          segment: { label: "banks" },
          institutionsInSegment: 3,
          members: [{ institutionId: 1, institutionName: "Alpha Bank", amount: 30, stateCode: "NY", documentUrls: ["https://example.com/a.pdf"], totalAssets: null, dailyCap: null }],
          band: null,
          zeroCount: 0,
          withDailyCap: 0,
          problem: null,
          source: { label: "Bank Fee Index", asOf: "2026-09-30" },
        }}
        own={32}
        ownLabel="Example Bank"
      />,
    );
    const plain = renderToStaticMarkup(<Exhibit number={3} title="A title" source="Somewhere">body</Exhibit>);
    for (const html of [seg, plain]) {
      expect(html).toContain('class="rd-exhibit"');
      expect(html).toContain('class="rd-label"');
    }
    expect(plain).toContain("<h2>A title</h2>");
    // The source date reads like every other answer's, never as an ISO date.
    expect(seg).toContain("Bank Fee Index, Sep 2026");
    expect(seg).not.toContain("2026-09-30");
    // Missing figures say so in words; a phone keeps the source link without a hidden column.
    expect(seg).toContain("Assets not available · Daily limit not published");
    expect(seg).toMatch(/sm:hidden[^>]*>[\s\S]*https:\/\/example\.com\/a\.pdf/);
    expect(dailyLimitText({ dailyCap: null, dailyFeeLimit: null })).toBe("Not published");
  });

  it("has one sourced-findings list, inline or boxed, at the answer body size", () => {
    const facts = [{ text: "The median is $30.", source: src, sampleSize: 12 }];
    const inline = renderToStaticMarkup(<FactList facts={facts} />);
    const boxed = renderToStaticMarkup(<ScheduleFactList facts={facts} />);
    expect(inline).toContain(ANSWER_TYPE.body);
    expect(boxed).toContain(ANSWER_TYPE.body);
    expect(boxed).toContain("divide-y");
    for (const html of [inline, boxed]) expect(html).toContain("Bank Fee Index, published fee schedules · Sep 2026 · n=12");
    expect(renderToStaticMarkup(<FactList facts={[]} />)).toBe("");
  });

  it("formats day dates one way and keeps figures in the sans face", () => {
    expect(dayDate("2025-03-01")).toBe("Mar 1, 2025");
    expect(dayDate("2025 Q2")).toBe("2025 Q2");
    const story = renderToStaticMarkup(<StorylineView story={sampleStoryline()} />);
    expect(story).toContain("Mar 1, 2025");
    expect(story).not.toMatch(/font-mono|class="(?:[^"]*\s)?tabular-nums[\s"]/);
  });

  it("stacks a wide structure matrix into cards on a phone and keeps a range figure whole", () => {
    const story = sampleStoryline();
    const matrix = story.exhibits.find((e) => e.exhibit.kind === "structure_matrix")!;
    const html = renderToStaticMarkup(<StoryExhibitView item={matrix} number={3} />);
    expect(html).toContain('class="flex flex-col gap-2 sm:hidden"');
    expect(html).toContain("hidden overflow-x-auto rounded-md border border-warm-200 bg-white sm:block");
    expect(html).not.toContain("min-w-[36rem]");
    const money = story.exhibits.find((e) => e.exhibit.kind === "money_at_stake")!;
    const moneyHtml = renderToStaticMarkup(<StoryExhibitView item={money} number={4} />);
    expect(moneyHtml).toMatch(/<span class="whitespace-nowrap">[−+]?\$/);
  });
});
