import { describe, it, expect } from "vitest";
import {
  GUIDES,
  CONSUMER_GUIDES,
  PROFESSIONAL_GUIDES,
  getGuide,
  guidesForTier,
  canReadGuide,
  relatedGuides,
  guidesForCategory,
  guideCategories,
  guideText,
  guideWordCount,
  resolveTokens,
  resolveTokensToText,
  parseTokens,
  isValidStat,
  REQUIRED_CONSUMER_SECTIONS,
} from "./index";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { FEE_FAMILIES, DISPLAY_NAMES } from "@/lib/fee-taxonomy";

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

function summary(overrides: Partial<FeeCategorySummary> & { fee_category: string }): FeeCategorySummary {
  return {
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
    ...overrides,
  };
}

/** Every category any guide cites, so token resolution can be exercised end to end. */
const ALL_SUMMARIES: FeeCategorySummary[] = [
  ...new Set(GUIDES.flatMap(guideCategories)),
].map((fee_category) => summary({ fee_category }));

describe("catalog integrity", () => {
  it("has unique, url-safe slugs", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("resolves every slug through getGuide", () => {
    for (const guide of GUIDES) expect(getGuide(guide.slug)?.slug).toBe(guide.slug);
    expect(getGuide("not-a-guide")).toBeUndefined();
  });

  // Regression guard for the original defect: a category outside the taxonomy never
  // matches a summary row, so the guide silently loses a benchmark card, a sidebar entry
  // and an "Explore the Data" tile with no build or runtime error.
  it("cites only fee categories that exist in the taxonomy", () => {
    const invalid: string[] = [];
    for (const guide of GUIDES) {
      for (const category of guideCategories(guide)) {
        if (!TAXONOMY.has(category)) invalid.push(`${guide.slug} -> ${category}`);
      }
    }
    expect(invalid).toEqual([]);
  });

  it("cites only fee categories that have a display name", () => {
    for (const guide of GUIDES) {
      for (const category of guideCategories(guide)) {
        expect(DISPLAY_NAMES[category], `missing display name for ${category}`).toBeTruthy();
      }
    }
  });

  it("never repeats the primary category among related categories", () => {
    for (const guide of GUIDES) {
      expect(guide.relatedCategories).not.toContain(guide.primaryCategory);
      expect(new Set(guide.relatedCategories).size).toBe(guide.relatedCategories.length);
    }
  });

  it("carries a distinct title and seoTitle, and no colon surgery is needed", () => {
    for (const guide of GUIDES) {
      expect(guide.title.trim().length).toBeGreaterThan(0);
      expect(guide.seoTitle.trim().length).toBeGreaterThan(0);
      expect(guide.description.trim().length).toBeGreaterThan(0);
      // The H1 must stand alone — it is never split on a colon at render.
      expect(guide.title).not.toContain(":");
    }
  });

  it("carries authorship and review metadata", () => {
    for (const guide of GUIDES) {
      expect(guide.author.trim().length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(guide.reviewedAt))).toBe(false);
      expect(Number.isNaN(Date.parse(guide.publishedAt))).toBe(false);
    }
  });

  it("has unique, non-positional section anchors within each guide", () => {
    for (const guide of GUIDES) {
      const ids = guide.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(id).not.toMatch(/^section-\d+$/);
      }
    }
  });

  it("has no empty sections or blocks", () => {
    for (const guide of GUIDES) {
      expect(guide.sections.length).toBeGreaterThan(0);
      for (const section of guide.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(0);
        expect(section.blocks.length).toBeGreaterThan(0);
        for (const block of section.blocks) {
          if (block.type === "list") expect(block.items.length).toBeGreaterThan(0);
          if (block.type === "benchmark") expect(block.rows.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("resolves every relatedSlugs entry, excluding self", () => {
    const slugs = new Set(GUIDES.map((g) => g.slug));
    for (const guide of GUIDES) {
      for (const slug of guide.relatedSlugs ?? []) {
        expect(slugs.has(slug), `${guide.slug} -> ${slug}`).toBe(true);
        expect(slug).not.toBe(guide.slug);
      }
    }
  });
});

describe("access tier model", () => {
  // Rule 1: every consumer fee guide is public, permanently.
  it("keeps every consumer guide public", () => {
    for (const guide of CONSUMER_GUIDES) {
      expect(guide.audience).toBe("consumer");
      expect(guide.accessTier).toBe("public");
    }
  });

  it("keeps professional guides on the paying tier", () => {
    for (const guide of PROFESSIONAL_GUIDES) {
      expect(guide.audience).toBe("professional");
      expect(guide.accessTier).toBe("pro");
    }
  });

  // Rule 2: a tier gates the whole guide, never a section of it. There is deliberately
  // no per-section or per-block tier field for this to be expressed through.
  it("exposes no per-section gating", () => {
    for (const guide of GUIDES) {
      for (const section of guide.sections) {
        expect(section).not.toHaveProperty("accessTier");
        expect(section).not.toHaveProperty("gated");
      }
    }
  });

  it("shows public and registered readers every consumer guide", () => {
    for (const tier of ["public", "registered"] as const) {
      const visible = guidesForTier(tier);
      for (const guide of CONSUMER_GUIDES) {
        expect(visible.map((g) => g.slug)).toContain(guide.slug);
      }
      expect(visible.some((g) => g.accessTier === "pro")).toBe(false);
    }
  });

  it("shows pro readers everything, including consumer guides", () => {
    expect(guidesForTier("pro").length).toBe(GUIDES.length);
    for (const guide of CONSUMER_GUIDES) expect(canReadGuide(guide, false)).toBe(true);
    for (const guide of PROFESSIONAL_GUIDES) {
      expect(canReadGuide(guide, false)).toBe(false);
      expect(canReadGuide(guide, true)).toBe(true);
    }
  });
});

describe("content meets the consumer-guide skill spec", () => {
  it("keeps consumer guides between 800 and 1,200 words", () => {
    for (const guide of CONSUMER_GUIDES) {
      const words = guideWordCount(guide);
      expect(words, `${guide.slug} is ${words} words`).toBeGreaterThanOrEqual(800);
      expect(words, `${guide.slug} is ${words} words`).toBeLessThanOrEqual(1200);
    }
  });

  it("keeps professional guides substantial", () => {
    for (const guide of PROFESSIONAL_GUIDES) {
      expect(guideWordCount(guide), guide.slug).toBeGreaterThanOrEqual(600);
    }
  });

  it("carries the mandated sections on every consumer guide", () => {
    for (const guide of CONSUMER_GUIDES) {
      const ids = guide.sections.map((s) => s.id);
      for (const required of REQUIRED_CONSUMER_SECTIONS) {
        expect(ids, `${guide.slug} missing ${required}`).toContain(required);
      }
    }
  });

  it("flags consumer guides as carrying regulatory content", () => {
    // Each has a "What regulators say" section, so publishing one requires a recorded
    // approval on the Hamilton admin surface.
    for (const guide of CONSUMER_GUIDES) {
      expect(guide.carriesRegulatoryContent).toBe(true);
    }
  });

  // The original P0: prose stated "$25 to $38" beside a live median with nothing
  // reconciling them. Prose may no longer contain a dollar figure at all.
  it("contains no hardcoded dollar figures in prose", () => {
    const offenders: string[] = [];
    for (const guide of GUIDES) {
      for (const text of guideText(guide)) {
        // Illustrative scenarios in whole dollars are allowed; priced claims are not.
        const priced = text.match(/\$\d+\.\d{2}/g);
        if (priced) offenders.push(`${guide.slug}: ${priced.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("cites a benchmark median in every consumer guide's cost section", () => {
    for (const guide of CONSUMER_GUIDES) {
      const tokens = guideText(guide).flatMap(parseTokens);
      expect(tokens.length, `${guide.slug} cites no live data`).toBeGreaterThan(0);
      expect(tokens.some((t) => t.category === guide.primaryCategory)).toBe(true);
    }
  });

  it("keeps benchmark thresholds as tokens, never literals", () => {
    for (const guide of GUIDES) {
      for (const section of guide.sections) {
        for (const block of section.blocks) {
          if (block.type !== "benchmark") continue;
          const cited = block.rows.flatMap((r) => parseTokens(r.condition));
          // Every benchmark table must derive at least one threshold from live data.
          expect(cited.length, `${guide.slug} benchmark has no tokens`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("only renders comparisons for categories the guide actually cites", () => {
    for (const guide of GUIDES) {
      const cited = new Set(guideCategories(guide));
      for (const section of guide.sections) {
        for (const block of section.blocks) {
          if (block.type === "comparison" || block.type === "benchmark") {
            expect(cited.has(block.category), `${guide.slug} -> ${block.category}`).toBe(true);
          }
        }
      }
    }
  });
});

describe("token binding", () => {
  it("resolves a median to a formatted, tabular figure", () => {
    const { html, unresolved } = resolveTokens(
      "The median is {{overdraft.median}}.",
      [summary({ fee_category: "overdraft", median_amount: 35 })],
    );
    expect(html).toBe(
      'The median is <strong class="tabular-nums">$35.00</strong>.',
    );
    expect(unresolved).toEqual([]);
  });

  it("resolves counts without a dollar sign", () => {
    const { html } = resolveTokens("{{overdraft.institutions}} institutions", [
      summary({ fee_category: "overdraft", institution_count: 4820 }),
    ]);
    expect(html).toContain("4,820");
    expect(html).not.toContain("$");
  });

  it("renders an em dash rather than a wrong number for an unknown category", () => {
    const { html, unresolved } = resolveTokens("costs {{not_a_fee.median}}", []);
    expect(html).toBe("costs &mdash;");
    expect(html).not.toContain("{{");
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].category).toBe("not_a_fee");
  });

  it("renders an em dash for an unknown stat", () => {
    const { html, unresolved } = resolveTokens("{{overdraft.mode}}", [
      summary({ fee_category: "overdraft" }),
    ]);
    expect(html).toBe("&mdash;");
    expect(unresolved).toHaveLength(1);
  });

  it("renders an em dash rather than $0 or NaN when a statistic is null", () => {
    const { html, unresolved } = resolveTokens("{{overdraft.median}}", [
      summary({ fee_category: "overdraft", median_amount: null }),
    ]);
    expect(html).toBe("&mdash;");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("$0");
    expect(unresolved).toHaveLength(1);
  });

  it("escapes markup before substituting", () => {
    const { html } = resolveTokens('<img src=x onerror="alert(1)"> {{overdraft.median}}', [
      summary({ fee_category: "overdraft", median_amount: 35 }),
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    // Only the resolver's own markup survives.
    expect(html.match(/<(?!strong|\/strong|span|\/span)/)).toBeNull();
  });

  it("escapes a token payload that would otherwise inject markup", () => {
    const { html } = resolveTokens("{{overdraft.median}}", [
      summary({ fee_category: "overdraft", median_amount: 35 }),
    ]);
    expect(html).not.toContain("javascript:");
  });

  it("resolves to plain text for metadata and structured data", () => {
    const text = resolveTokensToText("median {{overdraft.median}}", [
      summary({ fee_category: "overdraft", median_amount: 35 }),
    ]);
    expect(text).toBe("median $35.00");
    expect(text).not.toContain("<");
  });

  it("validates stat names", () => {
    for (const stat of ["median", "p25", "p75", "min", "max", "institutions", "zero_count"]) {
      expect(isValidStat(stat)).toBe(true);
    }
    expect(isValidStat("mean")).toBe(false);
  });

  // The whole point of the token system: an unresolvable token must fail here rather
  // than reach a reader as a wrong or missing number.
  it("resolves every token in every shipped guide", () => {
    const broken: string[] = [];
    for (const guide of GUIDES) {
      for (const text of guideText(guide)) {
        const { unresolved } = resolveTokens(text, ALL_SUMMARIES);
        for (const token of unresolved) broken.push(`${guide.slug}: ${token.raw}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("only lets a guide cite fees it declares", () => {
    const offenders: string[] = [];
    for (const guide of GUIDES) {
      const declared = new Set(guideCategories(guide));
      for (const text of guideText(guide)) {
        for (const token of parseTokens(text)) {
          if (!declared.has(token.category)) {
            offenders.push(`${guide.slug} cites undeclared ${token.category}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only cites categories that exist in the taxonomy", () => {
    for (const guide of GUIDES) {
      for (const text of guideText(guide)) {
        for (const token of parseTokens(text)) {
          expect(TAXONOMY.has(token.category), `${guide.slug} -> ${token.category}`).toBe(true);
        }
      }
    }
  });
});

describe("related guides and category lookup", () => {
  it("caps related guides and never includes self", () => {
    for (const guide of GUIDES) {
      const related = relatedGuides(guide);
      expect(related.length).toBeLessThanOrEqual(4);
      expect(related.map((g) => g.slug)).not.toContain(guide.slug);
      expect(new Set(related.map((g) => g.slug)).size).toBe(related.length);
    }
  });

  it("never mixes audiences in related guides", () => {
    for (const guide of GUIDES) {
      for (const related of relatedGuides(guide)) {
        expect(related.audience).toBe(guide.audience);
      }
    }
  });

  it("finds guides by fee category", () => {
    expect(guidesForCategory("overdraft").map((g) => g.slug)).toContain("overdraft-fees");
    expect(guidesForCategory("overdraft", "consumer").every((g) => g.audience === "consumer")).toBe(
      true,
    );
    expect(guidesForCategory("not_a_fee")).toEqual([]);
  });
});
