import { describe, expect, it } from "vitest";
import { unbackedNumbers } from "@/lib/agents/marketing/facts";
import { renderArticleMarkdown } from "@/lib/article-markdown";
import {
  FEE_TOPICS,
  allowedOdNumbers,
  articleSlug,
  checkedText,
  draftOdArticle,
  headline,
  nextTopic,
  summarizeOdByState,
  summarizeRevenue,
  type OdRow,
  type RelatedRow,
} from "./od-by-state";

const CODES = ["TX", "CA", "NY", "FL", "OH", "PA", "IL", "GA", "NC", "MI", "WA"];
const BANK_TIERS = ["community_small", "community_mid", "community_large", "regional"];
const CU_TIERS = ["community_small", "community_mid", "community_large"];

/**
 * 20 institutions per state. Banks charge more as they grow and credit unions less; every
 * other institution also lists a lower overdraft tier, which must not count.
 */
function rows(): OdRow[] {
  const out: OdRow[] = [];
  let id = 0;
  CODES.forEach((code, s) => {
    for (let i = 0; i < 20; i += 1) {
      id += 1;
      const bank = i % 2 === 0;
      const tierIndex = Math.floor(i / 2) % (bank ? BANK_TIERS.length : CU_TIERS.length);
      const amount = bank ? 26 + tierIndex * 3 + (s % 3) : 32 - tierIndex * 3 + (s % 3);
      const base = { institution_id: id, state_code: code, charter_type: bank ? "bank" : "credit_union", asset_size_tier: (bank ? BANK_TIERS : CU_TIERS)[tierIndex] };
      out.push({ ...base, amount });
      if (i % 4 === 1) out.push({ ...base, amount: 5 });
    }
  });
  // A thin state and a territory: counted nationally, never listed.
  for (let i = 0; i < 4; i += 1) out.push({ institution_id: 5000 + i, state_code: "VT", amount: 10, charter_type: "bank", asset_size_tier: "community_small" });
  for (let i = 0; i < 20; i += 1) out.push({ institution_id: 6000 + i, state_code: "PR", amount: 30, charter_type: "bank", asset_size_tier: "community_small" });
  return out;
}

function related(): RelatedRow[] {
  return Array.from({ length: 30 }, (_, i) => ({ institution_id: i + 1, fee_category: "od_protection_transfer", amount: i < 3 ? 0 : 5 }));
}

const asOf = new Date("2026-10-11T13:37:00Z");

describe("summarizeOdByState", () => {
  it("lists states with enough institutions and counts each institution once, at its highest tier", () => {
    const summary = summarizeOdByState(rows());
    expect(summary.states).toHaveLength(CODES.length);
    expect(summary.thinStates).toBe(1);
    expect(summary.national?.institutions).toBe(CODES.length * 20 + 4 + 20);
    expect(summary.states.every((state) => state.low >= 20)).toBe(true);
  });

  it("finds banks rising and credit unions falling with size", () => {
    const summary = summarizeOdByState(rows());
    expect(summary.banks.direction).toBe("up");
    expect(summary.creditUnions.direction).toBe("down");
    expect(summary.banks.groups.map((group) => group.key)).toEqual(["small", "mid", "large", "regional"]);
  });

  it("prices the overdraft transfer against the overdraft fee", () => {
    const summary = summarizeOdByState(rows(), "overdraft", related());
    expect(summary.transfer).toMatchObject({ institutions: 30, median: 5, free: 3 });
  });
});

describe("draftOdArticle", () => {
  it("leads with the size finding, charts it, and backs every number", () => {
    const summary = summarizeOdByState(rows(), "overdraft", related());
    summary.revenue = summarizeRevenue([
      { report_date: "2026-06-30", asset_size_tier: "super_regional", overdraft_revenue: 900_000 },
      { report_date: "2026-06-30", asset_size_tier: "community_large", overdraft_revenue: 100_000 },
      { report_date: "2025-06-30", asset_size_tier: "community_large", overdraft_revenue: 950_000 },
    ]);
    const article = draftOdArticle(summary, asOf)!;
    expect(article.slug).toBe("overdraft-fees-by-state-2026-10");
    expect(article.title).toBe("Bigger banks charge more for an overdraft. Bigger credit unions charge less.");
    expect(article.content).toContain("## Banks: the larger the bank, the higher the fee");
    expect(article.content).toContain("```bars Median overdraft fee at banks, by size");
    expect(article.content).toContain("## The cheaper option most schedules also list");
    expect(article.content).toContain("In the second quarter of 2026, 2 of them reported $1.00 billion, against $950 million from 1 banks a year earlier.");
    expect(article.content).toContain("took 90% of it");
    expect(article.content).not.toMatch(/cheap\b|expensive|worst|best/i);
    expect(unbackedNumbers(checkedText(article), allowedOdNumbers(summary, asOf))).toEqual([]);
  });

  it("renders its chart as bars", () => {
    const article = draftOdArticle(summarizeOdByState(rows()), asOf)!;
    const html = renderArticleMarkdown(article.content, "https://feeinsight.com");
    expect(html).toContain("<figure");
    expect(html).not.toContain("```");
  });

  it("writes another fee's article in that fee's words", () => {
    const summary = summarizeOdByState(rows(), "nsf");
    const article = draftOdArticle(summary, asOf, FEE_TOPICS[1])!;
    expect(article.slug).toBe("nsf-fees-by-state-2026-10");
    expect(article.title).toBe("Bigger banks charge more for a returned (NSF) item. Bigger credit unions charge less.");
    expect(article.content).not.toMatch(/overdraft/i);
    expect(unbackedNumbers(checkedText(article), allowedOdNumbers(summary, asOf))).toEqual([]);
  });

  it("lists tracked bills with their own numbers", () => {
    const summary = summarizeOdByState(rows());
    summary.bills = [{ title: "Overdraft fee limits", jurisdiction: "CA", identifier: "AB 1520", stage: "Signed", url: "https://example.org/ab1520" }];
    const article = draftOdArticle(summary, asOf)!;
    expect(article.content).toContain("- [AB 1520: Overdraft fee limits](https://example.org/ab1520) (CA, Signed)");
    expect(unbackedNumbers(checkedText(article), allowedOdNumbers(summary, asOf))).toEqual([]);
  });

  it("drafts nothing without states to compare", () => {
    expect(draftOdArticle(summarizeOdByState(rows().filter((row) => row.state_code === "TX")), asOf)).toBeNull();
  });
});

describe("headline", () => {
  it("falls back to the state story when size makes no difference", () => {
    const summary = summarizeOdByState(rows().map((row) => ({ ...row, amount: 30 })));
    expect(headline(summary, FEE_TOPICS[0])).toBe("Overdraft fees: the institution matters more than the state");
  });
});

describe("nextTopic", () => {
  it("starts with overdraft and moves to the next fee once that month's article exists", () => {
    expect(nextTopic(new Set(), asOf)?.category).toBe("overdraft");
    expect(nextTopic(new Set(["overdraft-fees-by-state-2026-10"]), asOf)?.category).toBe("nsf");
    expect(nextTopic(new Set(["overdraft-fees-by-state-2026-09"]), asOf)?.category).toBe("overdraft");
  });

  it("stops once every topic has this month's article", () => {
    expect(nextTopic(new Set(FEE_TOPICS.map((topic) => articleSlug(asOf, topic))), asOf)).toBeNull();
  });

  it("uses dashes in slugs for multi-word fees", () => {
    expect(articleSlug(asOf, FEE_TOPICS[3])).toBe("atm-non-network-fees-by-state-2026-10");
  });
});
