# Sample 01 — `Guide` model v2

Proposal only. Nothing here is applied to `src/lib/guides.ts`.

## Problem the current model creates

```ts
// src/lib/guides.ts — today
export interface Guide {
  slug: string;
  title: string;              // carries two jobs; UI does title.split(":")[0]
  description: string;
  feeCategories: string[];    // no notion of which one is primary
  sections: GuideSection[];
}
export interface GuideSection {
  heading: string;
  content: string;            // plain string → no lists, bold, links, callouts
}
```

Four defects fall straight out of this shape:

1. `title` is both the H1 and the SEO title, so the template strips it (`split(":")[0]`)
   in four places and throws away the value proposition.
2. `feeCategories[0]` is treated as primary in one place (`[slug]/page.tsx:51`) and
   `relevantFees[0]` — a globally-sorted array — in another (`:180`). They disagree.
3. `content: string` cannot express any of the formatting the `consumer-guide` skill
   requires, so the tips section renders as one grey paragraph.
4. Dollar figures live in the prose as literals, drifting from the live median rendered
   30px away.

## Proposed model

```ts
export type GuideAccessTier =
  | "public"      // free, ungated, indexed — overdraft, nsf, atm, maintenance
  | "registered"  // free account required — alerts, saved comparisons
  | "pro";        // subscriber — peer-set, revenue-impact framing

export type GuideAudience = "consumer" | "institution" | "consultant";

/** Inline block types — the minimum needed to satisfy the consumer-guide skill. */
export type GuideBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "callout"; tone: "tip" | "warning" | "regulatory"; text: string }
  | { type: "stat"; category: string; stat: "median" | "p25" | "p75" | "min" | "max"; label: string }
  | { type: "comparison"; category: string; dimension: "charter" | "asset_tier" | "state" };

export interface GuideSection {
  /** Stable, human-meaningful anchor — replaces positional `#section-0`. */
  id: string;
  heading: string;
  blocks: GuideBlock[];
}

export interface Guide {
  slug: string;
  /** Rendered as the H1. Short. No colon surgery. */
  title: string;
  /** Rendered in <title> and og:title. May be long and keyword-bearing. */
  seoTitle: string;
  description: string;

  /** The one category this guide is about. Drives the chart, the CTA, the sidebar order. */
  primaryCategory: string;
  /** Supporting categories, in editorial order — no longer re-sorted by global counts. */
  relatedCategories: string[];

  accessTier: GuideAccessTier;
  audience: GuideAudience;
  family: string;              // replaces the FAMILY_LABELS lookup in page.tsx:29-40
  featured: boolean;           // replaces the PRIMARY_SLUGS set in page.tsx:21-27

  sections: GuideSection[];

  // E-E-A-T + freshness, none of which exists today
  author: string;
  reviewedAt: string;          // ISO — the advice review date, NOT the crawl date
  publishedAt: string;
  methodologyHref?: string;
  relatedSlugs?: string[];     // replaces "every other guide, unranked"
}
```

## Data binding — the fix for the drift risk (P-2)

Prose keeps `{{...}}` tokens; the renderer resolves them from the same
`getFeeCategorySummaries()` result already fetched for the cards. One source of truth.

```ts
// token grammar: {{ <fee_category> . <stat> }}
//   stat ∈ median | p25 | p75 | min | max | institutions | zero_count

export function resolveTokens(
  text: string,
  summaries: FeeCategorySummary[],
): { html: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const html = text.replace(/\{\{\s*([a-z0-9_]+)\.([a-z_]+)\s*\}\}/g, (raw, category, stat) => {
    const s = summaries.find((x) => x.fee_category === category);
    const value =
      stat === "median"       ? s?.median_amount :
      stat === "p25"          ? s?.p25_amount :
      stat === "p75"          ? s?.p75_amount :
      stat === "min"          ? s?.min_amount :
      stat === "max"          ? s?.max_amount :
      stat === "institutions" ? s?.institution_count :
      undefined;
    if (value === undefined || value === null) {
      unresolved.push(raw);          // surfaced in CI + admin, never rendered raw
      return "—";
    }
    return stat === "institutions"
      ? `<span class="tabular-nums">${value.toLocaleString()}</span>`
      : `<strong class="tabular-nums">${formatAmount(value)}</strong>`;
  });
  return { html, unresolved };
}
```

Before / after for the same sentence:

```diff
- "These fees typically range from $25 to $38 per occurrence, though some
-  institutions have eliminated them entirely."

+ "Most banks charge between {{overdraft.p25}} and {{overdraft.p75}}, with a
+  national median of {{overdraft.median}} across {{overdraft.institutions}}
+  institutions. {{overdraft.zero_count}} charge nothing at all."
```

The prose can no longer contradict the card next to it, because it *is* the card.

## Migration path (non-breaking, three steps)

1. Add `seoTitle`, `primaryCategory`, `accessTier`, `reviewedAt`, `author` as optional
   fields with derivations from the current data (`seoTitle ??= title`,
   `primaryCategory ??= feeCategories[0]`, `accessTier ??= "public"`). Ship. No UI change.
2. Switch the template to read the new fields; delete `split(":")[0]`, `PRIMARY_SLUGS`
   and `FAMILY_LABELS`. Ship.
3. Convert `content: string` → `blocks: GuideBlock[]` guide by guide; keep a
   `{type:"paragraph"}` fallback so partial conversion always renders. Make the fields
   required once all ten are converted.

Extend `src/lib/guides.test.ts` at each step — it already asserts category validity, so
add: every `primaryCategory` ∈ taxonomy, every token in every block resolves against the
taxonomy, every `section.id` is unique within its guide, every `relatedSlugs` entry exists.
