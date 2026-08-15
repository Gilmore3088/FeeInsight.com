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
  loadConsumerGuideSlugs,
} from "@/lib/guides/source";
import {
  getFeeCategoryDetail,
  getCheapestAndMostExpensive,
  getDataFreshness,
  getStats,
} from "@/lib/data-store";
import { getCachedFeeCategorySummaries } from "@/lib/data-store/fee-cache";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName, getSpotlightCategories } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DistributionChart } from "@/components/public/distribution-chart";
import {
  GuideSectionRenderer,
  type GuideBreakdowns,
} from "@/components/public/guide-blocks";
import { SavedInstitutionsPanel } from "@/components/public/saved-institutions-panel";
import { SITE_URL } from "@/lib/constants";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return (await loadConsumerGuideSlugs()).map((slug) => ({ slug }));
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

const Arrow = () => (
  <svg
    className="h-3 w-3"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

export default async function GuidePage({ params }: PageProps) {
  const { slug } = await params;
  const guide = await loadGuide(slug);

  // Professional guides live at /guides/pro/[slug], which gates on the session. Serving
  // one here would mean rendering paid content into a page cached for everyone.
  if (!guide || guide.audience !== "consumer") notFound();

  const categories = guideCategories(guide);

  const [allSummaries, freshness, stats, primaryDetail, extremes, related] =
    await Promise.all([
      getCachedFeeCategorySummaries(),
      getDataFreshness(),
      getStats(),
      getFeeCategoryDetail(guide.primaryCategory),
      getCheapestAndMostExpensive(guide.primaryCategory, 5),
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
    extraCategories.map((c) => getFeeCategoryDetail(c)),
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

  const primaryAmounts = primaryDetail.fees
    .map((f) => f.amount)
    .filter((a): a is number => a !== null && a > 0);

  const { cheapest, mostExpensive } = extremes;
  const zeroFeeCount = primarySummary?.zero_count ?? 0;

  const spotlight = new Set(getSpotlightCategories());
  const primaryName = getDisplayName(guide.primaryCategory);
  const crawlDate = formatDate(freshness.last_crawl_at);
  const reviewDate = formatDate(guide.reviewedAt);
  const plain = (text: string) => resolveTokensToText(text, allSummaries);

  return (
    <div className="mx-auto max-w-7xl px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Guides", href: "/guides" },
          { name: guide.title, href: `/guides/${slug}` },
        ]}
      />

      <nav
        aria-label="Breadcrumb"
        className="sticky top-14 z-30 -mx-6 mb-8 flex items-center gap-2 bg-[#FAF7F2]/95 px-6 py-2 text-[12px] text-[#A09788] backdrop-blur-sm sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none"
      >
        <Link href="/" className="transition-colors hover:text-[#1A1815]">
          Home
        </Link>
        <span className="text-[#D4C9BA]" aria-hidden="true">
          /
        </span>
        <Link href="/guides" className="transition-colors hover:text-[#1A1815]">
          Guides
        </Link>
        <span className="text-[#D4C9BA]" aria-hidden="true">
          /
        </span>
        <span className="truncate text-[#5A5347]">{guide.title}</span>
      </nav>

      {/* ── HERO ── */}
      <div className="max-w-3xl">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-px w-8 bg-[#C44B2E]/40" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#C44B2E]/60">
            Consumer Guide
          </span>
        </div>

        <h1
          className="text-[1.75rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815] sm:text-[2.25rem]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          {guide.title}
        </h1>

        <p className="mt-4 text-[15px] leading-relaxed text-[#7A7062]">
          {guide.description}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#8A8073]">
          <span>{guide.author}</span>
          {reviewDate && (
            <>
              <span className="h-3 w-px bg-[#D4C9BA]" aria-hidden="true" />
              <span>Guide reviewed {reviewDate}</span>
            </>
          )}
          {crawlDate && (
            <>
              <span className="h-3 w-px bg-[#D4C9BA]" aria-hidden="true" />
              <span>Fee data updated {crawlDate}</span>
            </>
          )}
          {guide.methodologyHref && (
            <>
              <span className="h-3 w-px bg-[#D4C9BA]" aria-hidden="true" />
              <Link
                href={guide.methodologyHref}
                className="text-[#C44B2E]/70 transition-colors hover:text-[#C44B2E]"
              >
                Methodology
              </Link>
            </>
          )}
        </div>
      </div>

      <>
          {/* ── YOUR SAVED INSTITUTIONS — client island, so this page stays static ── */}
          <SavedInstitutionsPanel
            category={guide.primaryCategory}
            categoryLabel={primaryName}
            median={primarySummary?.median_amount ?? null}
          />

          {/* ── CHECK YOUR OWN BANK ── */}
          <section
            aria-labelledby="check-your-bank-heading"
            className="mt-8 rounded-xl border border-[#C44B2E]/15 bg-gradient-to-r from-[#FFFDF9] to-[#FAF7F2] px-6 py-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#C44B2E]/60">
                  Check your own bank
                </p>
                <h2
                  id="check-your-bank-heading"
                  className="mt-2 text-[17px] font-medium text-[#1A1815]"
                  style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                >
                  {primarySummary?.median_amount != null
                    ? `Does your bank charge more than ${formatAmount(primarySummary.median_amount)}?`
                    : `How does your bank compare on ${primaryName.toLowerCase()}?`}
                </h2>
                <p className="mt-1 text-[13px] text-[#7A7062]">
                  Search the {stats.total_institutions.toLocaleString()} banks and credit
                  unions in the index and see your institution&rsquo;s published{" "}
                  {primaryName.toLowerCase()} against the national median.
                </p>
              </div>
              <Link
                href={`/institutions?fee=${guide.primaryCategory}`}
                className="shrink-0 rounded-full bg-[#C44B2E] px-5 py-2.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#A83D25]"
              >
                Find your institution
              </Link>
            </div>
          </section>

          {/* ── ACTION LINKS ── */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href="/fees"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DFD1] bg-white/80 px-4 py-2 text-[12px] font-medium text-[#5A5347] no-underline transition-all hover:border-[#C44B2E]/30 hover:text-[#C44B2E]"
            >
              View the full fee index
              <Arrow />
            </Link>
            <Link
              href={`/fees/${guide.primaryCategory}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#C44B2E] px-4 py-2 text-[12px] font-medium text-white no-underline shadow-sm shadow-[#C44B2E]/15 transition-all hover:shadow-md hover:shadow-[#C44B2E]/25"
            >
              {primaryName} analysis
              <Arrow />
            </Link>
          </div>

          {/* ── MAIN + SIDEBAR ── */}
          <div className="mt-12 grid grid-cols-1 gap-10 xl:grid-cols-[1fr_300px]">
            <div>
              {primaryAmounts.length >= 5 && primarySummary && (
                <section aria-labelledby="distribution-heading" className="mb-12">
                  <h2
                    id="distribution-heading"
                    className="text-[18px] font-medium tracking-[-0.01em] text-[#1A1815]"
                    style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                  >
                    {primaryName} Fee Distribution
                  </h2>
                  <p className="mt-1.5 text-[13px] text-[#7A7062]">
                    How {primaryAmounts.length.toLocaleString()} institutions price this
                    fee. National median:{" "}
                    <span className="font-medium text-[#1A1815]">
                      {formatAmount(primarySummary.median_amount)}
                    </span>
                  </p>
                  <div className="mt-4 rounded-xl border border-[#E8DFD1]/80 bg-white/70 p-5 backdrop-blur-sm">
                    <DistributionChart
                      amounts={primaryAmounts}
                      median={primarySummary.median_amount}
                      bucketCount={16}
                    />
                  </div>
                </section>
              )}

              <div className="space-y-10">
                {guide.sections.map((section, i) => (
                  <GuideSectionRenderer
                    key={section.id}
                    section={section}
                    summaries={allSummaries}
                    breakdowns={breakdowns}
                    isLast={i === guide.sections.length - 1}
                  />
                ))}
              </div>

              {/* ── Attribution ── */}
              <footer className="mt-12 rounded-xl border border-[#E8DFD1]/70 bg-[#FAF7F2]/60 px-5 py-4 text-[12.5px] leading-relaxed text-[#7A7062]">
                <p>
                  Fee data from the Fee Insight National Fee Index, covering{" "}
                  <span className="tabular-nums">
                    {(primarySummary?.institution_count ?? stats.total_institutions).toLocaleString()}
                  </span>{" "}
                  institutions&rsquo; published fee schedules for {primaryName.toLowerCase()}.
                  Medians reflect the most recent collection period. Individual institutions
                  change fees without much notice — always check your own
                  institution&rsquo;s current schedule.
                </p>
                <p className="mt-2 text-[#8A8073]">
                  {guide.author}
                  {reviewDate && <> &middot; Last reviewed {reviewDate}</>}
                  {guide.methodologyHref && (
                    <>
                      {" "}
                      &middot;{" "}
                      <Link
                        href={guide.methodologyHref}
                        className="text-[#C44B2E]/70 hover:text-[#C44B2E]"
                      >
                        Methodology
                      </Link>
                    </>
                  )}
                </p>
              </footer>

              {/* ── Explore the Data ── */}
              <section aria-labelledby="explore-heading" className="mt-14">
                <div className="mb-5 flex items-center gap-3">
                  <h2
                    id="explore-heading"
                    className="text-[16px] font-medium text-[#1A1815]"
                    style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                  >
                    Explore the Data
                  </h2>
                  <span className="h-px flex-1 bg-[#E8DFD1]" aria-hidden="true" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {relevantFees.map((fee) => {
                    const open = spotlight.has(fee.fee_category);
                    return (
                      <Link
                        key={`deep-${fee.fee_category}`}
                        href={`/fees/${fee.fee_category}`}
                        className="group flex items-start gap-3.5 rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-5 py-4 no-underline transition-all duration-300 hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5"
                      >
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#C44B2E]/8 text-[#C44B2E]">
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                            />
                          </svg>
                        </div>
                        <div>
                          <span className="text-[13px] font-medium text-[#1A1815] transition-colors group-hover:text-[#C44B2E]">
                            {getDisplayName(fee.fee_category)}
                          </span>
                          <span className="block text-[11px] text-[#8A8073]">
                            {open
                              ? "Distribution, breakdowns by charter, state and tier"
                              : "Distribution and national median — free"}
                          </span>
                          {/* Stated about the destination, not the reader, so this page
                              renders the same HTML for everyone and can be cached. */}
                          {!open && (
                            <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[#8A8073]">
                              <svg
                                className="h-2.5 w-2.5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                aria-hidden="true"
                                focusable="false"
                              >
                                <rect x="3" y="11" width="18" height="11" rx="2" />
                                <path d="M7 11V7a5 5 0 0110 0v4" />
                              </svg>
                              Breakdowns require a subscription
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>

              {/* ── Related guides ── */}
              {related.length > 0 && (
                <section aria-labelledby="related-heading" className="mt-14">
                  <div className="mb-5 flex items-center gap-3">
                    <h2
                      id="related-heading"
                      className="text-[16px] font-medium text-[#1A1815]"
                      style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                    >
                      Related Guides
                    </h2>
                    <span className="h-px flex-1 bg-[#E8DFD1]" aria-hidden="true" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {related.map((g) => (
                      <Link
                        key={g.slug}
                        href={`/guides/${g.slug}`}
                        className="group rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-5 py-4 no-underline transition-all duration-300 hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5"
                      >
                        <span
                          className="text-[14px] font-medium text-[#1A1815] transition-colors group-hover:text-[#C44B2E]"
                          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                        >
                          {g.title}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[12px] text-[#7A7062]">
                          {g.description}
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* ── SIDEBAR ── */}
            <aside className="space-y-5 xl:sticky xl:top-20 xl:self-start">
              {relevantFees.length > 0 && (
                <div className="relative overflow-hidden rounded-xl border border-[#E8DFD1] bg-white/80 px-5 py-5 backdrop-blur-sm">
                  <div
                    className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#C44B2E]/30 to-transparent"
                    aria-hidden="true"
                  />
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#C44B2E]/60">
                    Live National Benchmarks
                  </p>
                  <div className="mt-4 space-y-4">
                    {relevantFees.map((fee) => (
                      <div
                        key={fee.fee_category}
                        className="border-b border-[#E8DFD1]/60 pb-3.5 last:border-0 last:pb-0"
                      >
                        <Link
                          href={`/fees/${fee.fee_category}`}
                          className="text-[13px] font-medium text-[#1A1815] transition-colors hover:text-[#C44B2E]"
                          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                        >
                          {getDisplayName(fee.fee_category)}
                        </Link>
                        <div className="mt-1.5 flex items-baseline gap-2">
                          <span
                            className="text-[22px] font-light tracking-tight tabular-nums text-[#1A1815]"
                            style={{
                              fontFamily: "var(--font-newsreader), Georgia, serif",
                            }}
                          >
                            {formatAmount(fee.median_amount)}
                          </span>
                          <span className="text-[10px] text-[#8A8073]">median</span>
                        </div>
                        <div className="mt-1 text-[11px] tabular-nums text-[#8A8073]">
                          P25: {formatAmount(fee.p25_amount)} &middot; P75:{" "}
                          {formatAmount(fee.p75_amount)}
                        </div>
                        <Link
                          href={`/fees/${fee.fee_category}`}
                          className="mt-2 inline-block rounded-full border border-[#E8DFD1]/60 bg-[#FAF7F2] px-2.5 py-0.5 text-[10px] font-medium text-[#7A7062] no-underline transition-colors hover:border-[#C44B2E]/30 hover:text-[#C44B2E]"
                        >
                          Full analysis
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cheapest.length > 0 && (
                <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/20 px-5 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-700">
                    Lowest {primaryName} Fees
                  </p>
                  {zeroFeeCount > 0 && (
                    <p className="mt-1.5 text-[12px] text-emerald-800">
                      <span className="font-bold tabular-nums">{zeroFeeCount}</span>{" "}
                      institution{zeroFeeCount !== 1 ? "s" : ""} charge nothing
                    </p>
                  )}
                  <div className="mt-3 space-y-1.5">
                    {cheapest.map((f, i) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between text-[12px]"
                      >
                        <span className="mr-2 truncate text-[#5A5347]">
                          <span className="mr-1 tabular-nums text-[#8A8073]">{i + 1}.</span>
                          {f.institution_name}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-emerald-800">
                          {formatAmount(f.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mostExpensive.length > 0 && (
                <div className="rounded-xl border border-red-200/60 bg-red-50/20 px-5 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-red-700">
                    Highest {primaryName} Fees
                  </p>
                  <div className="mt-3 space-y-1.5">
                    {mostExpensive.map((f, i) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between text-[12px]"
                      >
                        <span className="mr-2 truncate text-[#5A5347]">
                          <span className="mr-1 tabular-nums text-[#8A8073]">{i + 1}.</span>
                          {f.institution_name}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-red-700">
                          {formatAmount(f.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <nav
                aria-label="Guide contents"
                className="rounded-xl border border-[#E8DFD1] bg-white/80 px-5 py-4"
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#8A8073]">
                  In This Guide
                </p>
                <ul className="mt-3 space-y-2">
                  {guide.sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="flex items-center gap-2 text-[13px] text-[#7A7062] transition-colors hover:text-[#C44B2E]"
                      >
                        <span
                          className="h-1 w-1 shrink-0 rounded-full bg-[#D4C9BA]"
                          aria-hidden="true"
                        />
                        {section.heading}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>

              {/* ── CTA: a consumer page offers the consumer something ── */}
              <div className="rounded-xl border border-[#E8DFD1] bg-white/80 px-5 py-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#C44B2E]/60">
                    Stay ahead of fee changes
                  </p>
                  <p
                    className="mt-2 text-[15px] font-medium text-[#1A1815]"
                    style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                  >
                    Get told when your bank raises this fee
                  </p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[#7A7062]">
                    Free account. Save your institution and we&rsquo;ll email you when its{" "}
                    {primaryName.toLowerCase()} changes.
                  </p>
                  <Link
                    href={`/register?intent=fee-alert&category=${guide.primaryCategory}`}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#1A1815] px-5 py-2 text-[12px] font-semibold text-white no-underline transition-all hover:bg-[#33302B]"
                  >
                    Create a free account
                    <Arrow />
                  </Link>
                  <p className="mt-3 text-[11px] text-[#8A8073]">
                    Benchmarking for your institution?{" "}
                    <Link href="/subscribe" className="text-[#C44B2E]/80 hover:text-[#C44B2E]">
                      See professional plans
                    </Link>
                  </p>
                </div>
            </aside>
          </div>
      </>

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
