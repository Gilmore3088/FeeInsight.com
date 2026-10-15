/**
 * Consumer fee guides — statically rendered.
 *
 * This route reads no session and renders identical HTML for every reader, which is what
 * lets it be prerendered and served from cache. Two things make that possible:
 *
 *  - Professional guides live at `/guides/pro/[slug]`, which stays dynamic because it
 *    gates on the session. Nothing gated is ever rendered here.
 *  - A signed-in reader's saved institutions are fetched by a client island after
 *    hydration, so personalisation is additive to a page that is the same for everyone.
 *
 * Revalidation is event-driven: Hamilton publishing new fees drops the cached benchmark
 * summaries, and publishing a guide from admin revalidates this path. The interval below
 * is a backstop, not the mechanism.
 */
export const revalidate = 3600;
export const dynamicParams = true;

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { guideCategories, resolveTokensToText } from "@/lib/guides";
import {
  loadGuide,
  loadRelatedGuides,
} from "@/lib/guides/source";
import {
  getDataFreshnessCached,
  getFeeCategoryDetailCached,
} from "@/lib/data-store/public-cached-reads";
import { getPublicSnapshot } from "@/lib/public-stats";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DistributionChart } from "@/components/public/distribution-chart";
import {
  GuideSectionRenderer,
  type GuideBreakdowns,
} from "@/components/public/guide-blocks";
import { SavedInstitutionsPanel } from "@/components/public/saved-institutions-panel";
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { Button, SearchInput } from "@/brand/components";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Nothing is prerendered at build time: each guide renders on its first request and is then
 * served from cache. Every deploy, preview builds included, used to prerender all ten guides
 * against the production database with a cold data cache: about 70 sidebar reads in 15
 * minutes on Oct 9, ten per build.
 */
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = await loadGuide(slug);
  if (!guide || guide.audience !== "consumer") return { title: "Guide Not Found" };

  const url = `${SITE_URL}/guides/${slug}`;
  return {
    title: guide.seoTitle,
    description: guide.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: guide.seoTitle,
      description: guide.description,
      url,
      siteName: "Fee Insight",
      publishedTime: guide.publishedAt,
      modifiedTime: guide.reviewedAt,
    },
    twitter: {
      card: "summary_large_image",
      title: guide.title,
      description: guide.description,
    },
  };
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function GuidePage({ params }: PageProps) {
  const { slug } = await params;
  const guide = await loadGuide(slug);

  // Professional guides live at /guides/pro/[slug], which gates on the session. Serving
  // one here would mean rendering paid content into a page cached for everyone.
  if (!guide || guide.audience !== "consumer") notFound();

  const categories = guideCategories(guide);

  // National medians and counts from the shared public snapshot (same as the fee index).
  const [{ summary, categories: allSummaries }, freshness, primaryDetail, related] =
    await Promise.all([
      getPublicSnapshot(),
      // The shared public cache, as the fee pages read it: a guide rebuilt after a takedown
      // reuses the reads the first page computed instead of running its own (Oct 9: about
      // 190 freshness reads an hour against about 8 refreshes).
      getDataFreshnessCached(),
      getFeeCategoryDetailCached(guide.primaryCategory),
      loadRelatedGuides(guide),
    ]);

  // Editorial order — never the global sort by institution count.
  const summaryFor = new Map(allSummaries.map((s) => [s.fee_category, s]));
  const relevantFees = categories
    .map((c) => summaryFor.get(c))
    .filter((s): s is FeeCategorySummary => Boolean(s));
  const primarySummary = summaryFor.get(guide.primaryCategory);

  const comparisonCategories = new Set(
    guide.sections.flatMap((s) =>
      s.blocks
        .filter((b) => b.type === "comparison")
        .map((b) => (b as { category: string }).category),
    ),
  );
  const breakdowns: GuideBreakdowns = new Map();
  const extraCategories = [...comparisonCategories].filter(
    (c) => c !== guide.primaryCategory,
  );
  const extraDetails = await Promise.all(
    extraCategories.map((c) => getFeeCategoryDetailCached(c)),
  );
  if (comparisonCategories.has(guide.primaryCategory)) {
    breakdowns.set(guide.primaryCategory, {
      charter: primaryDetail.by_charter_type,
      asset_tier: primaryDetail.by_asset_tier,
      state: primaryDetail.by_state,
    });
  }
  extraCategories.forEach((category, i) => {
    breakdowns.set(category, {
      charter: extraDetails[i].by_charter_type,
      asset_tier: extraDetails[i].by_asset_tier,
      state: extraDetails[i].by_state,
    });
  });

  // One value per institution, the same population as the median printed beside it.
  const primaryAmounts = primaryDetail.institution_values ?? [];

  const zeroFeeCount = primarySummary?.zero_count ?? 0;

  const primaryName = getDisplayName(guide.primaryCategory);
  // For prose: "overdraft", not "overdraft (od)".
  const primaryNamePlain = primaryName.replace(/\s*\([^)]*\)/g, "").toLowerCase();
  const crawlDate = formatDate(freshness.last_crawl_at);
  const reviewDate = formatDate(guide.reviewedAt);
  const plain = (text: string) => resolveTokensToText(text, allSummaries);

  const median = primarySummary?.median_amount ?? null;
  const hasRange = primarySummary?.p25_amount != null && primarySummary?.p75_amount != null;
  const otherFees = relevantFees.filter((f) => f.fee_category !== guide.primaryCategory);

  const alertCard = (
    <div className="rounded-2xl border border-border bg-surface-0 px-5 py-5">
      <p className="text-[15px] font-semibold text-ink">Get an email when your bank&rsquo;s fee schedule is updated</p>
      <p className="mt-1 text-[13px] text-ink-muted">
        Free account. Save your institution and we&rsquo;ll email you when we update its published {primaryNamePlain}.
      </p>
      <Link
        href={`/register?intent=fee-alert&category=${guide.primaryCategory}`}
        className="mt-4 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
      >
        Get free fee alerts
      </Link>
    </div>
  );

  return (
    <div className="pb-20">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Guides", href: "/guides" },
          { name: guide.title, href: `/guides/${slug}` },
        ]}
      />

      {/* 1. The answer first: what this fee costs today, as one exhibit. */}
      <section className="border-b border-border bg-paper">
        <div
          className={`mx-auto grid max-w-page gap-8 px-4 pb-10 pt-6 sm:px-6 sm:pb-14 sm:pt-10 ${primarySummary && median != null ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-12" : ""}`}
        >
          <div>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Link href="/guides" className="hover:text-ink">
                Guides
              </Link>
              <span aria-hidden="true">/</span>
              <span className="truncate text-ink-soft">{guide.title}</span>
            </nav>
            <h1 className="mt-4 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[44px]">{guide.title}</h1>
            <p className="mt-3 max-w-[36rem] text-[16px] text-ink-soft">{guide.description}</p>
            <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
              <span>{guide.author}</span>
              {reviewDate && <span>Reviewed {reviewDate}</span>}
              {crawlDate && <span>Fee data updated {crawlDate}</span>}
              {guide.methodologyHref && (
                <Link href={guide.methodologyHref} className="underline decoration-border underline-offset-2 hover:text-ink">
                  Methodology
                </Link>
              )}
            </p>
          </div>

          {primarySummary && median != null && (
            <figure className="rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6">
              <figcaption>
                <p className="text-[13px] text-ink-muted">Typical {primaryName} fee, U.S. median</p>
                <p className="font-mono text-[40px] font-semibold leading-none tabular-nums text-ink">{formatAmount(median)}</p>
                <p className="mt-2 text-[13px] text-ink-muted">
                  {hasRange && (
                    <>
                      The middle half of institutions charge {formatAmount(primarySummary.p25_amount)} to {formatAmount(primarySummary.p75_amount)}.{" "}
                    </>
                  )}
                  Median of {primarySummary.institution_count.toLocaleString()} institutions
                  {zeroFeeCount > 0 && `; ${zeroFeeCount.toLocaleString()} charge nothing`}.
                </p>
              </figcaption>
              {primaryAmounts.length >= 5 && (
                <div className="mt-4">
                  <DistributionChart values={primaryAmounts} median={median} bucketCount={16} />
                </div>
              )}
              <p className="mt-2 text-[11px] text-ink-muted">
                Source: {PRODUCT_NAME}, institutions&rsquo; own published schedules.{crawlDate ? ` Data as of ${crawlDate}.` : ""}
              </p>
              <p className="mt-2 text-[12px]">
                <Link href={`/fees/${guide.primaryCategory}`} className="font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
                  See the full data for this fee
                </Link>
              </p>
            </figure>
          )}
        </div>
      </section>

      {/* 2. Check your own bank. */}
      <section aria-labelledby="check-your-bank-heading" className="mx-auto max-w-page px-4 pt-10 sm:px-6">
        <div className="rounded-2xl border border-border bg-surface-0 p-5 shadow-fi-1 sm:p-6">
          <h2 id="check-your-bank-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
            {median != null ? `Does your bank charge more than ${formatAmount(median)}?` : `How does your bank compare on ${primaryNamePlain}?`}
          </h2>
          <form action="/institutions" method="get" role="search" className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="fee" value={guide.primaryCategory} />
            <SearchInput name="q" label="Your bank or credit union" required minLength={2} autoComplete="off" className="w-full min-w-0 sm:flex-1" />
            <Button type="submit" variant="primary" className="min-h-11 justify-center whitespace-nowrap">
              Look up its fees
            </Button>
          </form>
          <SavedInstitutionsPanel category={guide.primaryCategory} categoryLabel={primaryNamePlain} median={median} />
        </div>
      </section>

      {/* 3. The guide, with its contents and the free alert beside it. */}
      <div className="mx-auto grid max-w-page grid-cols-1 gap-10 px-4 pt-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="max-w-3xl space-y-10">
          {guide.sections.map((section, i) => (
            <GuideSectionRenderer
              key={section.id}
              section={section}
              summaries={allSummaries}
              breakdowns={breakdowns}
              isLast={i === guide.sections.length - 1}
            />
          )).flatMap((el, i) => (i === 0 ? [el, <div key="alert-inline" className="lg:hidden">{alertCard}</div>] : [el]))}

          {otherFees.length > 0 && (
            <section aria-labelledby="related-fees-heading">
              <h2 id="related-fees-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
                Related fees, national median
              </h2>
              <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface-0">
                {otherFees.map((fee) => (
                  <li key={fee.fee_category}>
                    <Link href={`/fees/${fee.fee_category}`} className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5 text-[14px] text-ink hover:bg-paper">
                      <span>{getDisplayName(fee.fee_category)}</span>
                      <span className="font-mono tabular-nums">
                        {formatAmount(fee.median_amount)} <span className="text-[12px] text-ink-muted">median</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-[12px] leading-relaxed text-ink-muted">
            Fee data from the {PRODUCT_NAME}: {primarySummary ? primarySummary.institution_count.toLocaleString() : summary.institutionsLabel}{" "}
            institutions&rsquo; own published schedules for {primaryNamePlain}. Institutions change fees often, so check your own
            institution&rsquo;s current schedule.
          </p>
          <p className="text-[13px] text-ink-muted">
            Work at a bank or credit union?{" "}
            <Link href="/reports/sample-competitive-fee-position" className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
              See a sample competitor report
            </Link>
          </p>
        </div>

        <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block lg:self-start">
          <nav aria-label="Guide contents" className="hidden rounded-2xl border border-border bg-surface-0 px-5 py-4 lg:block">
            <p className="text-[13px] font-semibold text-ink">In this guide</p>
            <ul className="mt-2 space-y-1.5">
              {guide.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="text-[13px] text-ink-muted hover:text-ink">
                    {section.heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="hidden lg:block">{alertCard}</div>
        </aside>
      </div>

      {/* 5. Related guides. */}
      {related.length > 0 && (
        <section aria-labelledby="related-heading" className="mx-auto max-w-page px-4 pt-14 sm:px-6">
          <h2 id="related-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Related guides
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((g) => (
              <li key={g.slug}>
                <Link href={`/guides/${g.slug}`} className="block h-full rounded-2xl border border-border bg-surface-0 px-5 py-4 hover:border-ink/30">
                  <span className="text-[15px] font-semibold text-ink">{g.title}</span>
                  <span className="mt-1 line-clamp-2 block text-[13px] text-ink-muted">{g.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: guide.seoTitle,
            description: guide.description,
            url: `${SITE_URL}/guides/${slug}`,
            datePublished: guide.publishedAt,
            dateModified: guide.reviewedAt,
            author: { "@type": "Organization", name: guide.author },
            publisher: { "@type": "Organization", name: "Fee Insight" },
            isAccessibleForFree: guide.accessTier !== "pro",
          }).replace(/</g, "\\u003c"),
        }}
      />
      <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: guide.sections.map((section) => ({
                "@type": "Question",
                name: section.heading,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: plain(
                    section.blocks
                      .flatMap((b) =>
                        b.type === "paragraph"
                          ? [b.text]
                          : b.type === "list"
                            ? b.items
                            : b.type === "callout"
                              ? [b.text]
                              : [],
                      )
                      .join(" "),
                  ),
                  url: `${SITE_URL}/guides/${slug}#${section.id}`,
                },
              })),
            }).replace(/</g, "\\u003c"),
          }}
        />
    </div>
  );
}
