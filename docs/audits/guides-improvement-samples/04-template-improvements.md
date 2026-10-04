# Sample 04 — Template fixes, before / after

Ten concrete changes to `src/app/(public)/guides/[slug]/page.tsx` and
`src/app/(public)/guides/page.tsx`. Proposals — not applied.

Ordered by value. Fixes 1–5 are the ones worth doing first; they need no schema work
beyond the optional fields in sample 01.

---

## 1 — Stop discarding the title (U-5)

`split(":")[0]` appears in four places. It exists only because one field carries two jobs.

```diff
- <h1 …>{guide.title.split(":")[0]}</h1>
+ <h1 …>{guide.title}</h1>
```

with `title: "Overdraft Fees: What They Cost and How to Stop Paying Them"` becoming
`title: "Overdraft Fees"` + `seoTitle: "Understanding Overdraft Fees: What Banks Charge and How to Avoid Them"`.
Also remove the split at `page.tsx:101`, `[slug]/page.tsx:87` and `:347`.

---

## 2 — Add the missing "check my own bank" block (U-1)

The highest-impact single addition. A consumer arrives asking about *their* bank and the
page currently never mentions that the site can answer that. Place it directly under the
benchmark cards, above the distribution chart.

```tsx
<section className="mt-8 rounded-xl border border-[#C44B2E]/15 bg-gradient-to-r from-[#FFFDF9] to-[#FAF7F2] px-6 py-5">
  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#C44B2E]/60">
        Check your own bank
      </p>
      <h2
        className="mt-2 text-[17px] font-medium text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Does your bank charge more than {formatAmount(primarySummary.median_amount)}?
      </h2>
      <p className="mt-1 text-[13px] text-[#7A7062]">
        Look up any of the {stats.total_institutions.toLocaleString()} banks and credit
        unions in the index and see this fee side by side with the national median.
      </p>
    </div>
    <Link
      href={`/institutions?fee=${primaryCategory}`}
      className="shrink-0 rounded-full bg-[#C44B2E] px-5 py-2.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#A83D25]"
    >
      Find your institution
    </Link>
  </div>
</section>
```

Pair it with the reverse link — once guides are queryable by category (sample 02,
`getGuidesForCategory`), `/fees/[category]` and `/institution/[id]` should each surface
"Read the guide to this fee." Guides become a hub instead of a leaf.

---

## 3 — Complete the metadata (U-4, U-9)

```diff
  export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const guide = getGuide(slug);
    if (!guide) return { title: "Guide Not Found" };

    return {
-     title: guide.title,
+     title: guide.seoTitle,
      description: guide.description,
-     keywords: guide.feeCategories.map((c) => `${getDisplayName(c)} guide`),
+     alternates: { canonical: `${SITE_URL}/guides/${slug}` },
+     openGraph: {
+       type: "article",
+       title: guide.seoTitle,
+       description: guide.description,
+       url: `${SITE_URL}/guides/${slug}`,
+       publishedTime: guide.publishedAt,
+       modifiedTime: guide.reviewedAt,
+       images: [{ url: `${SITE_URL}/api/og/guide/${slug}`, width: 1200, height: 630 }],
+     },
+     twitter: {
+       card: "summary_large_image",
+       title: guide.title,
+       description: guide.description,
+     },
    };
  }
```

`keywords` has been ignored by Google since 2009. An OG image route that renders the guide
title over the primary category's median is a small, high-leverage addition — these pages
are the most shareable on the site and currently render as a bare link.

And flatten the JSON-LD: emit `Article` and `FAQPage` as two separate top-level blocks
rather than nesting `FAQPage` under `mainEntity`, and add the fields Google weighs for
financial content:

```diff
  "@type": "Article",
  headline: guide.title,
  description: guide.description,
  url: `${SITE_URL}/guides/${slug}`,
+ datePublished: guide.publishedAt,
+ dateModified: guide.reviewedAt,
+ author: { "@type": "Organization", name: guide.author },
+ publisher: { "@type": "Organization", name: "Fee Insight" },
- mainEntity: { "@type": "FAQPage", mainEntity: [...] },
```

---

## 4 — Be honest about what's behind the paywall (U-3)

Today the "Deep Dive" tile promises "Distribution, breakdowns by charter, state, tier" to
every reader. For a signed-out consumer following that link on a non-spotlight category,
the breakdowns are all behind `UpgradeGate` (`fees/[category]/page.tsx:211`).

```tsx
const SPOTLIGHT = new Set(getSpotlightCategories());
const isOpen = SPOTLIGHT.has(fee.fee_category);

<span className="block text-[11px] text-[#A09788]">
  {isOpen
    ? "Distribution, breakdowns by charter, state and tier"
    : "Distribution and national median — free"}
</span>
{!isOpen && (
  <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[#A09788]">
    <LockIcon className="h-2.5 w-2.5" aria-hidden="true" />
    Breakdowns require a subscription
  </span>
)}
```

Consumer-education content that oversells and then gates is worse for trust than content
that labels the boundary up front.

---

## 5 — Replace the professional CTA with a consumer one (U-2)

The current terminal CTA on a page labelled "Consumer Guide" is a dark card headed **"For
Professionals"** offering API docs (`[slug]/page.tsx:493-521`). That card belongs on
`/research` and `/pro`, not here. On a consumer guide, offer the consumer something:

```tsx
<div className="rounded-xl border border-[#E8DFD1] bg-white/80 px-5 py-5">
  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#C44B2E]/60">
    Stay ahead of fee changes
  </p>
  <p className="mt-2 text-[15px] font-medium text-[#1A1815]"
     style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
    Get alerted when your bank raises this fee
  </p>
  <p className="mt-1.5 text-[12px] text-[#7A7062]">
    Free account. Save your institution and we&apos;ll email you when its
    {" "}{getDisplayName(primaryCategory).toLowerCase()} changes.
  </p>
  <Link href={`/register?intent=fee-alert&category=${primaryCategory}`} …>
    Create a free account
  </Link>
</div>
```

This is also the missing rung in the funnel. Today the ladder is *anonymous reader →
subscriber*, with nothing in between. A free registered tier — save an institution, get
alerts, 3 AI research queries (`getResearchQueryLimit` already grants exactly that) — is
the natural bridge, and the guides are where consumer traffic actually lands.

Keep a professional CTA, but demote it to a single quiet line, and only on guides whose
`audience` is `institution` or `consultant`.

---

## 6 — One primary category, used consistently (U-7)

```diff
- {relevantFees[0] && (
-   <Link href={`/fees/${relevantFees[0].fee_category}`} …>
-     {getDisplayName(relevantFees[0].fee_category)} analysis
+ {primarySummary && (
+   <Link href={`/fees/${primaryCategory}`} …>
+     {getDisplayName(primaryCategory)} analysis
```

`relevantFees` inherits the global sort of `getFeeCategorySummaries()` (by institution
count across the whole taxonomy, `fees.ts:134`), so the CTA can offer a different fee than
the chart above it analyses. Sort `relevantFees` into the guide's own editorial order
instead:

```ts
const order = [guide.primaryCategory, ...guide.relatedCategories];
const relevantFees = allSummaries
  .filter((s) => order.includes(s.fee_category))
  .sort((a, b) => order.indexOf(a.fee_category) - order.indexOf(b.fee_category));
```

---

## 7 — Fix the two small display bugs (U-6, U-8)

The sidebar's "Distribution" and "By state" chips (`[slug]/page.tsx:394-405`) both point at
`/fees/{category}`. Either differentiate them or ship one:

```diff
- <Link href={`/fees/${fee.fee_category}`} …>Distribution</Link>
- <Link href={`/fees/${fee.fee_category}`} …>By state</Link>
+ <Link href={`/fees/${fee.fee_category}`} …>Full analysis</Link>
```

And delete the orphaned label at `page.tsx:85-89` — it renders the word "median" with no
number, while the actual median renders 30 lines below with its own label.

---

## 8 — Render blocks instead of one paragraph (C-4)

`[slug]/page.tsx:243-245` renders `section.content` as a single `<p>`. Every guide's tips
section is a numbered list flattened into grey prose.

```tsx
{section.blocks.map((block, i) => {
  switch (block.type) {
    case "paragraph":
      return <p key={i} className="text-[15px] leading-[1.85] text-[#5A5347]"
                dangerouslySetInnerHTML={{ __html: resolveTokens(block.text, allSummaries).html }} />;
    case "list":
      const List = block.ordered ? "ol" : "ul";
      return (
        <List key={i} className="mt-3 space-y-2 text-[15px] leading-[1.7] text-[#5A5347]">
          {block.items.map((item, j) => (
            <li key={j} className="flex gap-2.5">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#C44B2E]/40" />
              <span dangerouslySetInnerHTML={{ __html: resolveTokens(item, allSummaries).html }} />
            </li>
          ))}
        </List>
      );
    case "callout":
      return (
        <aside key={i} className="mt-4 rounded-lg border-l-2 border-[#C44B2E]/40 bg-[#FAF7F2] px-4 py-3
                                  text-[14px] leading-relaxed text-[#5A5347]">
          {block.text}
        </aside>
      );
    case "stat":
      return <StatCallout key={i} {...block} summaries={allSummaries} />;
    case "comparison":
      return <CharterComparison key={i} category={block.category} dimension={block.dimension} />;
  }
})}
```

`resolveTokens` escapes before substituting and only ever emits `<strong>`/`<span>` —
the same posture as the existing `MarkdownContent` renderer in
`research/articles/[slug]/page.tsx:185`, which is worth reusing rather than duplicating.

---

## 9 — Accessibility (U-10)

```diff
- <section key={i} id={`section-${i}`} className="scroll-mt-20">
+ <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-20">
+   <h2 id={`${section.id}-heading`} …>{section.heading}</h2>

- <nav className="mt-3 space-y-2">
+ <nav className="mt-3 space-y-2" aria-label="Guide contents">

- <svg className="h-3 w-3" fill="none" …>
+ <svg className="h-3 w-3" fill="none" aria-hidden="true" focusable="false" …>
```

Stable anchors also make section deep-links durable and let the FAQ JSON-LD reference real
fragment IDs. Separately, `#A09788` at 10–11px (institution counts, ranges, "median"
labels) lands near 3.2:1 on the `#FAF7F2` ground — below AA. Darkening that one token to
roughly `#8A8073` clears the threshold without disturbing the palette.

---

## 10 — Rendering and query cost (P-7 → P-10)

Three independent changes, in increasing order of effort:

```diff
- const allSummaries = await getFeeCategorySummaries();
- const freshness = await getDataFreshness();
- const stats = await getStats();
- const primaryDetail = await getFeeCategoryDetail(primaryCategory);
+ const [allSummaries, freshness, stats, primaryDetail] = await Promise.all([
+   getFeeCategorySummaries(),
+   getDataFreshness(),
+   getStats(),
+   getFeeCategoryDetail(primaryCategory),
+ ]);
```

Then cache the summary read — `getFeeCategorySummaries()` currently scans every approved
row in `published_fee_catalog` and aggregates in JS on every page view, to render ten
cards. It changes only when Hamilton publishes, so wrap it in `unstable_cache` with a tag
that `runHamiltonPublish` revalidates.

Then drop `force-dynamic`. Once the prose lives in Postgres (sample 02) and the summaries
are cached, `export const revalidate = 3600` plus the existing `generateStaticParams`
(currently dead code at `[slug]/page.tsx:22`) is the right mode for a page whose content
changes on a publish cadence, not a request cadence.

Lower priority: `getFeeCategoryDetail` pulls every row for the category so the page can
take `slice(0,5)` and `slice(-5)` for two sidebar lists. If a guide's primary category
covers thousands of institutions, that is a large payload for ten rendered names — a
dedicated `getCheapestAndMostExpensive(category, n)` query would replace it.
