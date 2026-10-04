/**
 * Consumer guide content model.
 *
 * Two rules govern this model and are enforced by `guides.test.ts`:
 *
 * 1. A guide's `accessTier` gates the whole guide, never a section of it.
 *    Half-gated consumer education reads as bait.
 * 2. Every consumer fee guide is `public`, permanently. The paying tier is served
 *    by different guides written for a different reader, not by locking part of a
 *    consumer guide.
 *
 * Dollar figures never appear as literals in guide prose. They are `{{category.stat}}`
 * tokens resolved at render from the same fee summaries the benchmark cards use, so the
 * prose cannot contradict the figure beside it. See `./tokens.ts`.
 */

/** Bank/CU employees and consultants are the same paying reader; they are not split. */
export type GuideAudience = "consumer" | "professional";

export type GuideAccessTier =
  /** Free, ungated, indexed. Every consumer fee guide, permanently. */
  | "public"
  /** Free account. Additive personalisation only — never gates prose. */
  | "registered"
  /** Paying tier: bank/CU employees and consultants, one tier. */
  | "pro";

export type GuideStatus = "draft" | "in_review" | "regulatory_review" | "published";

/** Statistics a prose token may cite. */
export type GuideStat =
  | "median"
  | "p25"
  | "p75"
  | "min"
  | "max"
  | "institutions"
  | "zero_count";

export type GuideBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "callout"; tone: "tip" | "warning" | "regulatory"; text: string }
  | {
      /** A benchmarking table row set — thresholds are tokens, never literals. */
      type: "benchmark";
      category: string;
      rows: { condition: string; meaning: string }[];
    }
  | {
      /** Renders a live breakdown instead of asserting a comparison in prose. */
      type: "comparison";
      category: string;
      dimension: "charter" | "asset_tier" | "state";
      /** Below this many observations the block renders nothing rather than a broken frame. */
      minObservations?: number;
      caption?: string;
    };

export interface GuideSection {
  /** Stable slug anchor. Never positional — section order may change. */
  id: string;
  heading: string;
  blocks: GuideBlock[];
}

export interface Guide {
  slug: string;
  /** Rendered as the H1. Short. Never split on a colon. */
  title: string;
  /** Rendered in <title> and og:title. May be long and keyword-bearing. */
  seoTitle: string;
  description: string;

  /** The one category this guide is about. Drives the chart, the CTA and the sidebar order. */
  primaryCategory: string;
  /** Supporting categories, in editorial order — never re-sorted by global counts. */
  relatedCategories: string[];

  audience: GuideAudience;
  accessTier: GuideAccessTier;
  family: string;
  featured: boolean;

  sections: GuideSection[];

  author: string;
  /** When the ADVICE was last reviewed. Distinct from the fee-crawl date. */
  reviewedAt: string;
  publishedAt: string;
  methodologyHref?: string;
  /** Ranked related guides. Empty means "derive from shared family". */
  relatedSlugs?: string[];

  /**
   * True when the guide makes regulatory claims (Reg E, Reg DD, CFPB). These cannot be
   * published without a recorded approval from a named approver on the Hamilton admin
   * surface, and a re-draft clears that approval rather than inheriting it.
   */
  carriesRegulatoryContent?: boolean;
}

/** Every category a guide cites, primary first, in editorial order. */
export function guideCategories(guide: Guide): string[] {
  return [guide.primaryCategory, ...guide.relatedCategories];
}

/** Section anchors that every consumer guide must carry, per the consumer-guide skill. */
export const REQUIRED_CONSUMER_SECTIONS = [
  "what-regulators-say",
  "compare-your-bank",
] as const;
