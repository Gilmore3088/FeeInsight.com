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

/** Where a statement of law or fact comes from: shown as a link after the text (#1172). */
export type GuideSource = {
  label: string;
  url: string;
};

export type GuideBlock =
  | { type: "paragraph"; text: string; source?: GuideSource }
  | { type: "list"; ordered?: boolean; items: string[] }
  | {
      type: "callout";
      tone: "tip" | "warning" | "regulatory";
      text: string;
      source?: GuideSource;
      /** A rule explained by its purpose first ("Your choice about debit card overdraft fees"). */
      title?: string;
      /** The rule's name, shown after the purpose ("Regulation E"). */
      rule?: string;
    }
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
    }
  | {
      /** The reader's starting questions, each linking to the section that answers it. */
      type: "paths";
      paths: { question: string; answer: string; href: string }[];
    }
  | {
      /** One hypothetical payment, and what each way of handling it means for the reader. */
      type: "outcomes";
      setup: string;
      outcomes: GuideOutcome[];
    }
  | {
      /** Costs computed from live medians, so no single feature is declared most important. */
      type: "scenarios";
      intro?: string;
      scenarios: CostScenario[];
    }
  | {
      /** The live distribution of one category, placed where the guide discusses prices. */
      type: "distribution";
      category: string;
      caption?: string;
    }
  | {
      /** What a daily limit in the Index covers, counted live from the schedules' own wording. */
      type: "cap_scope";
      category: string;
    }
  | {
      /** Policy features in plain language; a feature the Index does not track says so. */
      type: "policy_table";
      rows: PolicyFeature[];
      /** When set, the reader can compare institutions' published lines on these features. */
      compare?: { intro: string };
    }
  | {
      /** Complaint themes as context, never a ranking. */
      type: "complaints";
      text: string;
      source: GuideSource;
    }
  | {
      /** Regulatory changes in practical terms, each with its current status. */
      type: "updates";
      items: RegulatoryUpdate[];
    };

export type GuideOutcome = {
  /** Drives the outcome's mark, not its wording. */
  kind: "paid" | "returned" | "transfer" | "deposit_returned";
  title: string;
  /** What happens to the payment. */
  payment: string;
  /** What it may cost, with a token where a fee applies. */
  cost: string;
  /** What is left to deal with afterwards. */
  after: string;
}

export type CostScenario = {
  title: string;
  /** Each charge is a category's live median, times how many times it applies. */
  charges: { category: string; count: number }[];
  /** A category whose median is applied as a daily limit on the total, when one is published. */
  capCategory?: string;
  note?: string;
}

export type PolicyFeature = {
  feature: string;
  question: string;
  /** The Index category that answers it, or none when the Index does not track it yet. */
  category?: string;
}

export type RegulatoryStatus = "proposed" | "effective" | "blocked" | "withdrawn" | "repealed";

export type RegulatoryUpdate = {
  title: string;
  status: RegulatoryStatus;
  /** When the status took hold, as a reader would say it ("May 9, 2025"). */
  date: string;
  changed: string;
  who: string;
  action: string;
  source: GuideSource;
}

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
