import { describe, expect, it } from "vitest";
import { unbackedNumbers } from "@/lib/agents/marketing/facts";
import {
  ENDS,
  FEE_TOPICS,
  allowedOdNumbers,
  nextTopic,
  articleSlug,
  draftOdArticle,
  summarizeOdByState,
  type OdRow,
} from "./od-by-state";

const CODES = ["TX", "CA", "NY", "FL", "OH", "PA", "IL", "GA", "NC", "MI", "WA"];

/** `count` institutions in a state, each charging `amount` (some with a lower tier too). */
function state(code: string, amount: number, count = 20, start = 0): OdRow[] {
  return Array.from({ length: count }, (_, i) => [
    { institution_id: start + i, state_code: code, amount },
    ...(i % 2 ? [{ institution_id: start + i, state_code: code, amount: 5 }] : []),
  ]).flat();
}

function rows(): OdRow[] {
  return [
    ...CODES.flatMap((code, i) => state(code, 20 + i, 20, i * 100)),
    ...state("VT", 10, 4, 5000),
    ...state("PR", 30, 20, 6000),
  ];
}

describe("summarizeOdByState", () => {
  it("lists states with enough institutions, lowest first, at each institution's highest tier", () => {
    const summary = summarizeOdByState(rows());
    expect(summary.states.map((s) => s.code)).toEqual(CODES);
    expect(summary.states[0]).toMatchObject({ code: "TX", name: "Texas", institutions: 20, median: 20 });
    expect(summary.thinStates).toBe(1);
    // Territories count toward the national median but are not listed as states.
    expect(summary.national?.institutions).toBe(CODES.length * 20 + 4 + 20);
  });
});

describe("draftOdArticle", () => {
  const asOf = new Date("2026-10-11T13:37:00Z");

  it("writes a neutral article whose numbers all come from the summary", () => {
    const summary = summarizeOdByState(rows());
    const article = draftOdArticle(summary, asOf)!;
    expect(article.slug).toBe("overdraft-fees-by-state-2026-10");
    expect(article.title).toBe("Overdraft fees by state, October 2026");
    expect(article.content).toContain("## States with the lowest median overdraft fee");
    expect(article.content).toContain("[Texas](https://");
    expect(article.content).toMatch(/lower than the national median/);
    expect(article.content).not.toMatch(/cheap|expensive|worst|best/i);
    const text = `${article.title}\n${article.subtitle}\n${article.content.replace(/\]\([^)]*\)/g, "]")}`;
    expect(unbackedNumbers(text, allowedOdNumbers(summary, asOf))).toEqual([]);
  });

  it("drafts nothing without enough states", () => {
    const summary = summarizeOdByState(CODES.slice(0, ENDS * 2 - 1).flatMap((code, i) => state(code, 25, 20, i * 100)));
    expect(draftOdArticle(summary, asOf)).toBeNull();
  });

  it("names one article per month", () => {
    expect(articleSlug(new Date("2026-11-01T00:00:00Z"))).toBe("overdraft-fees-by-state-2026-11");
  });

  it("writes another fee's article in that fee's words", () => {
    const summary = summarizeOdByState(rows(), "nsf");
    const article = draftOdArticle(summary, asOf, FEE_TOPICS[1])!;
    expect(article.slug).toBe("nsf-fees-by-state-2026-10");
    expect(article.title).toBe("NSF fees by state, October 2026");
    expect(article.content).toContain("## States with the highest median NSF fee");
    expect(article.content).toContain("publish an NSF fee;");
    expect(article.content).not.toMatch(/overdraft/i);
    const text = `${article.title}\n${article.subtitle}\n${article.content.replace(/\]\([^)]*\)/g, "]")}`;
    expect(unbackedNumbers(text, allowedOdNumbers(summary, asOf))).toEqual([]);
  });
});

describe("nextTopic", () => {
  const asOf = new Date("2026-10-11T13:37:00Z");

  it("starts with overdraft and moves to the next fee once that month's article exists", () => {
    expect(nextTopic(new Set(), asOf)?.category).toBe("overdraft");
    expect(nextTopic(new Set(["overdraft-fees-by-state-2026-10"]), asOf)?.category).toBe("nsf");
    // Last month's articles don't count against this month.
    expect(nextTopic(new Set(["overdraft-fees-by-state-2026-09"]), asOf)?.category).toBe("overdraft");
  });

  it("stops once every topic has this month's article", () => {
    expect(nextTopic(new Set(FEE_TOPICS.map((topic) => articleSlug(asOf, topic))), asOf)).toBeNull();
  });

  it("uses dashes in slugs for multi-word fees", () => {
    expect(articleSlug(asOf, FEE_TOPICS[3])).toBe("atm-non-network-fees-by-state-2026-10");
  });
});
