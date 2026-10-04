import { describe, it, expect } from "vitest";
import {
  validateDraftedGuide,
  GUIDE_DRAFT_MIN_WORDS,
  GUIDE_DRAFT_MAX_WORDS,
} from "./draft";
import type { Guide, GuideSection } from "@/lib/guides/types";
import type { FeeCategorySummary } from "@/lib/data-store/fees";

function summary(fee_category: string): FeeCategorySummary {
  return {
    fee_category,
    institution_count: 100,
    total_observations: 120,
    min_amount: 5,
    max_amount: 50,
    avg_amount: 30,
    median_amount: 32,
    p25_amount: 28,
    p75_amount: 36,
    bank_count: 60,
    cu_count: 40,
    zero_count: 7,
  };
}

const SUMMARIES = [summary("overdraft"), summary("od_daily_cap")];

/** Long enough filler to clear the word floor without carrying meaning. */
function filler(words: number): string {
  return Array.from({ length: words }, (_, i) => `word${i % 40}`).join(" ");
}

function guide(overrides: Partial<Guide> = {}, sections?: GuideSection[]): Guide {
  return {
    slug: "overdraft-fees",
    title: "Overdraft Fees",
    seoTitle: "Overdraft Fees Explained",
    description: "A guide.",
    primaryCategory: "overdraft",
    relatedCategories: ["od_daily_cap"],
    audience: "consumer",
    accessTier: "public",
    family: "Overdraft & NSF",
    featured: false,
    author: "Fee Insight Research",
    reviewedAt: "2026-08-15",
    publishedAt: "2026-08-15",
    carriesRegulatoryContent: true,
    sections: sections ?? [
      {
        id: "what-it-is",
        heading: "What is it?",
        blocks: [{ type: "paragraph", text: filler(850) }],
      },
      {
        id: "what-regulators-say",
        heading: "What regulators say",
        blocks: [{ type: "paragraph", text: "Regulation E requires an opt-in." }],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your bank",
        blocks: [{ type: "paragraph", text: "The median is {{overdraft.median}}." }],
      },
    ],
    ...overrides,
  };
}

describe("guide draft validation", () => {
  it("accepts a well-formed consumer guide", () => {
    expect(validateDraftedGuide(guide(), SUMMARIES)).toEqual([]);
  });

  it("rejects a category outside the taxonomy", () => {
    const issues = validateDraftedGuide(
      guide({ relatedCategories: ["not_a_real_fee"] }),
      SUMMARIES,
    );
    expect(issues.some((i) => i.code === "unknown_category")).toBe(true);
  });

  it("rejects a token citing a fee the guide does not declare", () => {
    const issues = validateDraftedGuide(
      guide({}, [
        {
          id: "what-it-is",
          heading: "What is it?",
          blocks: [{ type: "paragraph", text: `${filler(850)} {{nsf.median}}` }],
        },
        {
          id: "what-regulators-say",
          heading: "Regulators",
          blocks: [{ type: "paragraph", text: "Regulation E applies." }],
        },
        {
          id: "compare-your-bank",
          heading: "Compare",
          blocks: [{ type: "paragraph", text: "Check yours." }],
        },
      ]),
      SUMMARIES,
    );
    expect(issues.some((i) => i.code === "undeclared_category")).toBe(true);
  });

  it("rejects a token with no data behind it", () => {
    const issues = validateDraftedGuide(guide(), [summary("od_daily_cap")]);
    expect(issues.some((i) => i.code === "unresolved_token")).toBe(true);
  });

  it("rejects an unknown statistic", () => {
    const issues = validateDraftedGuide(
      guide({}, [
        {
          id: "what-it-is",
          heading: "What is it?",
          blocks: [{ type: "paragraph", text: `${filler(850)} {{overdraft.mean}}` }],
        },
        {
          id: "what-regulators-say",
          heading: "Regulators",
          blocks: [{ type: "paragraph", text: "Regulation E applies." }],
        },
        {
          id: "compare-your-bank",
          heading: "Compare",
          blocks: [{ type: "paragraph", text: "Check yours." }],
        },
      ]),
      SUMMARIES,
    );
    expect(issues.some((i) => i.code === "invalid_stat")).toBe(true);
  });

  // The defect the whole model exists to prevent.
  it("rejects a hardcoded dollar figure in prose", () => {
    const issues = validateDraftedGuide(
      guide({}, [
        {
          id: "what-it-is",
          heading: "What is it?",
          blocks: [
            { type: "paragraph", text: `${filler(850)} Most banks charge $35.00.` },
          ],
        },
        {
          id: "what-regulators-say",
          heading: "Regulators",
          blocks: [{ type: "paragraph", text: "Regulation E applies." }],
        },
        {
          id: "compare-your-bank",
          heading: "Compare",
          blocks: [{ type: "paragraph", text: "Check yours." }],
        },
      ]),
      SUMMARIES,
    );
    expect(issues.some((i) => i.code === "hardcoded_amount")).toBe(true);
  });

  it("rejects a consumer guide missing a mandated section", () => {
    const issues = validateDraftedGuide(
      guide({}, [
        {
          id: "what-it-is",
          heading: "What is it?",
          blocks: [{ type: "paragraph", text: filler(850) }],
        },
      ]),
      SUMMARIES,
    );
    const missing = issues.filter((i) => i.code === "missing_section");
    expect(missing).toHaveLength(2);
    expect(missing.map((i) => i.detail).join(" ")).toContain("what-regulators-say");
    expect(missing.map((i) => i.detail).join(" ")).toContain("compare-your-bank");
  });

  it("rejects a guide outside the word band", () => {
    const short = validateDraftedGuide(
      guide({}, [
        {
          id: "what-it-is",
          heading: "What is it?",
          blocks: [{ type: "paragraph", text: "Too short." }],
        },
        {
          id: "what-regulators-say",
          heading: "Regulators",
          blocks: [{ type: "paragraph", text: "Regulation E applies." }],
        },
        {
          id: "compare-your-bank",
          heading: "Compare",
          blocks: [{ type: "paragraph", text: "Check yours." }],
        },
      ]),
      SUMMARIES,
    );
    expect(short.some((i) => i.code === "word_count")).toBe(true);

    const long = validateDraftedGuide(
      guide({}, [
        {
          id: "what-it-is",
          heading: "What is it?",
          blocks: [{ type: "paragraph", text: filler(GUIDE_DRAFT_MAX_WORDS + 200) }],
        },
        {
          id: "what-regulators-say",
          heading: "Regulators",
          blocks: [{ type: "paragraph", text: "Regulation E applies." }],
        },
        {
          id: "compare-your-bank",
          heading: "Compare",
          blocks: [{ type: "paragraph", text: "Check yours." }],
        },
      ]),
      SUMMARIES,
    );
    expect(long.some((i) => i.code === "word_count")).toBe(true);
  });

  it("does not require consumer sections on a professional guide", () => {
    const issues = validateDraftedGuide(
      guide({ audience: "professional", accessTier: "pro" }, [
        {
          id: "method",
          heading: "Method",
          blocks: [{ type: "paragraph", text: filler(GUIDE_DRAFT_MIN_WORDS + 20) }],
        },
      ]),
      SUMMARIES,
    );
    expect(issues.some((i) => i.code === "missing_section")).toBe(false);
  });
});
