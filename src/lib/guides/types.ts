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
      /**
       * Costs under one stated, illustrative account policy. The policy is labeled as no
       * institution's terms, so medians of different policies are never combined into one account.
       */
      type: "scenarios";
      intro?: string;
      policy: IllustrativePolicy;
      scenarios: CostScenario[];
    }
  | {
      /** A reader enters their own account's terms; the defaults are the illustrative policy's. */
      type: "calculator";
      kind: "overdraft" | "atm";
      intro?: string;
      /** Starting values, labeled as illustrative in the form. */
      defaults: Record<string, number>;
    }
  | {
      /** An illustrative breakdown of one transaction: each amount is labeled as illustrative. */
      type: "breakdown";
      title: string;
      items: { label: string; amount: number; sign?: "plus" | "minus" }[];
      totalLabel: string;
      note: string;
      /**
       * Render a live example in its place when one is available: two institutions' own
       * published fees, named and sourced. The authored items stay as the fallback.
       */
      live?: "atm_two_fee";
    }
  | {
      /** The few things a reader can do next, each with its own links, and minor tips after them. */
      type: "actions";
      actions: GuideAction[];
      tips?: { title: string; items: string[] };
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
      compare?: { intro: string; set?: "overdraft" | "atm" };
    }
  | {
      /** Complaint themes as context, never a ranking. */
      type: "complaints";
      text: string;
      source: GuideSource;
    }
  | {
      /**
       * A short animation the reader plays, beside the explanation it supports. Its amounts are
       * illustrative and labeled so; the scene lives in `src/components/public/fee-animation`.
       */
      type: "animation";
      scene: GuideAnimationScene;
      /** The two links on its end frame: a section of this guide, or a site path such as /check. */
      actions: { label: string; href: string }[];
    }
  | {
      /** Regulatory changes in practical terms, each with its current status. */
      type: "updates";
      items: RegulatoryUpdate[];
    };

/** The animation scenes a guide can place. */
export type GuideAnimationScene =
  | "atm_two_fee"
  | "overdraft"
  | "nsf"
  | "wire_transfer"
  | "monthly_maintenance"
  | "foreign_transaction"
  | "check_stop_payment"
  | "digital_speed"
  | "dormant_account"
  | "safe_deposit";

export type GuideAction = {
  title: string;
  text: string;
  /** External locators open in a new tab; an anchor or site path stays in the page. */
  links: { label: string; href: string }[];
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

/** An account policy used only to illustrate arithmetic; every guide labels it as no institution's terms. */
export type IllustrativePolicy = {
  /** Fee per overdraft or returned item. */
  perItem: number;
  /** Most fees charged in one day, or null for no limit. */
  maxPerDay: number | null;
  /** A one-time extra charge when the balance stays negative, or null. */
  extended: number | null;
  /** Fee for a transfer from a linked savings account, or null. */
  transfer: number | null;
}

export type CostScenario = {
  title: string;
  /** Items that would each draw a fee on the same day. */
  items: number;
  /** The balance stays negative long enough for the extended charge. */
  extended?: boolean;
  /** A linked savings transfer covers the shortfall instead. */
  transfer?: boolean;
  note?: string;
}

export type PolicyFeature = {
  feature: string;
  question: string;
  /** The Index category that answers it, or none when the Index does not track it yet. */
  category?: string;
  /**
   * Show how many institutions publish it instead of a median, when the published values do not
   * measure the same thing (daily limits cover different fees).
   */
  countOnly?: boolean;
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
   * Practical links that lead the sidebar (e.g. where to find a fee-free ATM). When set, the
   * national benchmarks move below the guide's contents.
   */
  helpLinks?: { title: string; links: { label: string; href: string; note?: string }[] };

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
