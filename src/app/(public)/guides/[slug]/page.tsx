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
import { blockText, guideCategories, resolveTokensToText } from "@/lib/guides";
import {
  loadGuide,
  loadRelatedGuides,
} from "@/lib/guides/source";
import {
  getDailyCapScopeCached,
  getDataFreshnessCached,
  getFeeCategoryGuideDetailCached,
  getOverdraftComplaintThemesCached,
} from "@/lib/data-store/public-cached-reads";
import { getPublicSnapshot } from "@/lib/public-stats";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName, getSpotlightCategories } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import {
  GuideSectionRenderer,
  type GuideBreakdowns,
  type GuideExtras,
} from "@/components/public/guide-blocks";
import type { GuideBlock, GuideSection } from "@/lib/guides";
import { SavedInstitutionsPanel } from "@/components/public/saved-institutions-panel";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, medianHasUnstatedAudience } from "@/components/unstated-audience";

/** Sections with the price chart placed under "what it costs" when the guide does not place it. */
function withDistribution(sections: GuideSection[], category: string): GuideSection[] {
  const placed = sections.some((s) => s.blocks.some((b) => b.type === "distribution"));
  if (placed) return sections;
  return sections.map((s) =>
    s.id === "what-it-costs"
      ? { ...s, blocks: [...s.blocks, { type: "distribution", category } satisfies GuideBlock] }
      : s,
  );
}
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { PAGE_HEADER } from "@/components/public/page-header";

/**
 * Categories whose single median misleads as a headline (James's guides review, Oct 16 2026):
 * most foreign transaction fees are a percentage, which the flat figure leaves out, and published
 * daily limits cover different fees, so their median describes no one account.
 */
const SIDEBAR_HIDDEN = new Set(["card_foreign_txn", "od_daily_cap"]);

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
  const blocks = guide.sections.flatMap((s) => s.blocks);
  const needsCapScope = blocks.some((b) => b.type === "cap_scope");
  const needsComplaints = blocks.some((b) => b.type === "complaints");

  // National medians and counts from the shared public snapshot (same as the fee index).
  const [{ summary, categories: allSummaries }, freshness, primaryDetail, related, capScope, complaints] =
    await Promise.all([
      getPublicSnapshot(),
      // The shared public cache, as the fee pages read it: a guide rebuilt after a takedown
      // reuses the reads the first page computed instead of running its own (Oct 9: about
      // 190 freshness reads an hour against about 8 refreshes).
      getDataFreshnessCached(),
      getFeeCategoryGuideDetailCached(guide.primaryCategory),
      loadRelatedGuides(guide),
      needsCapScope ? getDailyCapScopeCached().catch(() => null) : null,
      needsComplaints ? getOverdraftComplaintThemesCached().catch(() => null) : null,
    ]);

  // Editorial order — never the global sort by institution count.
  const summaryFor = new Map(allSummaries.map((s) => [s.fee_category, s]));
  const relevantFees = categories
    .filter((c) => !SIDEBAR_HIDDEN.has(c))
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
    extraCategories.map((c) => getFeeCategoryGuideDetailCached(c)),
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

  const extras: GuideExtras = {
    distribution: {
      category: guide.primaryCategory,
      values: primaryAmounts,
      median: primarySummary?.median_amount ?? null,
    },
    capScope,
    complaints,
  };
  const sections = withDistribution(guide.sections, guide.primaryCategory);
  // The overdraft guide compares institutions itself; other guides keep the lookup band.
  const comparesAccounts = blocks.some((b) => b.type === "policy_table" && b.compare);

  const spotlight = new Set(getSpotlightCategories());
  const primaryName = getDisplayName(guide.primaryCategory);
  // For prose: "overdraft", not "overdraft (od)".
  const primaryNamePlain = primaryName.replace(/\s*\([^)]*\)/g, "").toLowerCase();
  const crawlDate = formatDate(freshness.last_crawl_at);
  const reviewDate = formatDate(guide.reviewedAt);
  const plain = (text: string) => resolveTokensToText(text, allSummaries);

  // A guide with practical help links leads with them; national medians follow its contents.
  const benchmarksBox = relevantFees.length > 0 && (
                <div className="relative overflow-hidden rounded-xl border border-border bg-white/80 px-5 py-5 backdrop-blur-sm">
                  <div
                    className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-brick/30 to-transparent"
                    aria-hidden="true"
                  />
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brick/60">
                    Live National Benchmarks
                  </p>
                  <div className="mt-4 space-y-4">
                    {relevantFees.map((fee) => (
                      <div
                        key={fee.fee_category}
                        className="border-b border-border/60 pb-3.5 last:border-0 last:pb-0"
                      >
                        <Link
                          href={`/fees/${fee.fee_category}`}
                          className="text-[13px] font-semibold text-ink transition-colors hover:text-brick"
                          style={{ fontFamily: "var(--fi-font-sans)" }}
                        >
                          {getDisplayName(fee.fee_category)}
                        </Link>
                        <div className="mt-1.5 flex items-baseline gap-2">
                          <span
                            className="text-[22px] font-semibold tracking-tight tabular-nums text-ink"
                            style={{
                              fontFamily: "var(--fi-font-mono)",
                            }}
                          >
                            {formatAmount(fee.median_amount)}
                            <UnstatedAudienceMark show={medianHasUnstatedAudience(fee)} />
                          </span>
                          <span className="text-[10px] text-ink-muted">median</span>
                        </div>
                        <div className="mt-1 text-[11px] tabular-nums text-ink-muted">
                          P25: {formatAmount(fee.p25_amount)} &middot; P75:{" "}
                          {formatAmount(fee.p75_amount)}
                        </div>
                        <Link
                          href={`/fees/${fee.fee_category}`}
                          className="mt-2 inline-block rounded-full border border-border/60 bg-paper px-2.5 py-0.5 text-[10px] font-medium text-ink-muted no-underline transition-colors hover:border-brick/30 hover:text-brick"
                        >
                          Full analysis
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              );

  return (
    <div className="mx-auto max-w-page px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Guides", href: "/guides" },
          { name: guide.title, href: `/guides/${slug}` },
        ]}
      />

      <nav
        aria-label="Breadcrumb"
        className="sticky top-14 z-30 -mx-6 mb-8 flex items-center justify-center gap-2 bg-paper/95 px-6 py-2 text-[12px] text-ink-muted backdrop-blur-sm sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:py-0 sm:justify-start sm:backdrop-blur-none"
      >
        <Link href="/" className="transition-colors hover:text-ink">
          Home
        </Link>
        <span className="text-border" aria-hidden="true">
          /
        </span>
        <Link href="/guides" className="transition-colors hover:text-ink">
          Guides
        </Link>
        <span className="text-border" aria-hidden="true">
          /
        </span>
        <span className="truncate text-ink-soft">{guide.title}</span>
      </nav>

      {/* ── HERO ── */}
      <div className={`max-w-3xl ${PAGE_HEADER}`}>
        <div className="mb-4 flex items-center justify-center gap-2 sm:justify-start">
          <span className="h-px w-8 bg-brick/40" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brick/60">
            Consumer Guide
          </span>
        </div>

        <h1
          className="font-extrabold text-[1.75rem] leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.25rem]"
          style={{ fontFamily: "var(--fi-font-sans)" }}
        >
          {guide.title}
        </h1>

        <p className="mx-auto mt-4 max-w-[34rem] text-[15px] leading-relaxed text-ink-muted sm:mx-0 sm:max-w-none">
          {guide.description}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-ink-muted sm:justify-start">
          <span>{guide.author}</span>
          {reviewDate && (
            <>
              <span className="h-3 w-px bg-border" aria-hidden="true" />
              <span>Guide reviewed {reviewDate}</span>
            </>
          )}
          {crawlDate && (
            <>
              <span className="h-3 w-px bg-border" aria-hidden="true" />
              <span>Fee data updated {crawlDate}</span>
            </>
          )}
          {guide.methodologyHref && (
            <>
              <span className="h-3 w-px bg-border" aria-hidden="true" />
              <Link
                href={guide.methodologyHref}
                className="text-brick/70 transition-colors hover:text-brick"
              >
                Methodology
              </Link>
            </>
          )}
        </div>
      </div>

      <>
          {/* ── YOUR SAVED INSTITUTIONS — client island; placed after the CTA so its late arrival cannot shift the hero ── */}
          <SavedInstitutionsPanel
            category={guide.primaryCategory}
            categoryLabel={primaryNamePlain}
            median={primarySummary?.median_amount ?? null}
          />

          {/* ── MAIN + SIDEBAR ── */}
          <div className="mt-12 grid grid-cols-1 gap-10 xl:grid-cols-[1fr_300px]">
            <div>
              <div className="space-y-10">
                {sections.map((section, i) => (
                  <GuideSectionRenderer
                    key={section.id}
                    section={section}
                    summaries={allSummaries}
                    breakdowns={breakdowns}
                    isLast={i === sections.length - 1}
                    extras={extras}
                  />
                ))}
              </div>

              {!comparesAccounts && (
                <>
          {/* ── CHECK YOUR OWN BANK ── */}
          <section
            aria-labelledby="check-your-bank-heading"
            className="mt-12 rounded-xl border border-brick/15 bg-gradient-to-r from-surface-0 to-paper px-6 py-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brick/60">
                  Check your own bank
                </p>
                <h2
                  id="check-your-bank-heading"
                  className="mt-2 text-[17px] font-bold text-ink"
                  style={{ fontFamily: "var(--fi-font-sans)" }}
                >
                  {primarySummary?.median_amount != null
                    ? `Does your bank charge more than ${formatAmount(primarySummary.median_amount)}?`
                    : `How does your bank compare on ${primaryNamePlain}?`}
                </h2>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Find your bank or credit union and see its published{" "}
                  {primaryNamePlain} against the national median.
                </p>
              </div>
              <Link
                href={`/institutions?fee=${guide.primaryCategory}`}
                className="shrink-0 rounded-full bg-brick px-5 py-2.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-brick-ink"
              >
                Find your institution
              </Link>
            </div>
          </section>

                </>
              )}

              {/* ── Optional alerts, after the help (James, Oct 16) ── */}
              <div className="mt-12 rounded-xl border border-border bg-white/80 px-5 py-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brick/60">
                    Optional: follow this fee
                  </p>
                  <p
                    className="mt-2 text-[15px] font-semibold text-ink"
                    style={{ fontFamily: "var(--fi-font-sans)" }}
                  >
                    Get an email when your bank updates this fee
                  </p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
                    Free account. Save your institution and we&rsquo;ll email you when its published{" "}
                    {primaryNamePlain} is updated.
                  </p>
                  <Link
                    href={`/register?intent=fee-alert&category=${guide.primaryCategory}`}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2 text-[12px] font-semibold text-white no-underline transition-all hover:bg-[#33302B]"
                  >
                    Create a free account
                    <Arrow />
                  </Link>
                </div>
              {/* ── Attribution ── */}
              <footer className="mt-12 rounded-xl border border-border/70 bg-paper/60 px-5 py-4 text-[12.5px] leading-relaxed text-ink-muted">
                <p>
                  Fee data from the {PRODUCT_NAME}, covering{" "}
                  <span className="tabular-nums">
                    {primarySummary ? primarySummary.institution_count.toLocaleString() : summary.institutionsLabel}
                  </span>{" "}
                  institutions&rsquo; published fee schedules for {primaryNamePlain}.
                  Medians reflect the most recent collection period. Individual institutions
                  change fees without much notice — always check your own
                  institution&rsquo;s current schedule.
                </p>
                <p className="mt-2 text-ink-muted">
                  {guide.author}
                  {reviewDate && <> &middot; Last reviewed {reviewDate}</>}
                  {guide.methodologyHref && (
                    <>
                      {" "}
                      &middot;{" "}
                      <Link
                        href={guide.methodologyHref}
                        className="text-brick/70 hover:text-brick"
                      >
                        Methodology
                      </Link>
                    </>
                  )}
                </p>
                <UnstatedAudienceFootnote
                  show={medianHasUnstatedAudience(primarySummary) || relevantFees.some(medianHasUnstatedAudience)}
                  className="mt-2"
                />
                <p className="mt-2 text-[11.5px] text-ink-muted">
                  For bank and credit union teams:{" "}
                  <Link href="/subscribe" className="text-ink-muted underline underline-offset-2 hover:text-ink">
                    Hamilton
                  </Link>
                </p>
              </footer>

              {/* ── Explore the Data ── */}
              <section aria-labelledby="explore-heading" className="mt-14">
                <div className="mb-5 flex items-center gap-3">
                  <h2
                    id="explore-heading"
                    className="text-[16px] font-bold text-ink"
                    style={{ fontFamily: "var(--fi-font-sans)" }}
                  >
                    Explore the Data
                  </h2>
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {relevantFees.map((fee) => {
                    const open = spotlight.has(fee.fee_category);
                    return (
                      <Link
                        key={`deep-${fee.fee_category}`}
                        href={`/fees/${fee.fee_category}`}
                        className="group flex items-start gap-3.5 rounded-xl border border-border/80 bg-white/70 px-5 py-4 no-underline transition-all duration-300 hover:border-brick/20 hover:shadow-md hover:shadow-[#b23a32]/5"
                      >
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brick/8 text-brick">
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
                          <span className="text-[13px] font-medium text-ink transition-colors group-hover:text-brick">
                            {getDisplayName(fee.fee_category)}
                          </span>
                          <span className="block text-[11px] text-ink-muted">
                            {open
                              ? "Distribution, breakdowns by charter, state and tier"
                              : "Distribution and national median — free"}
                          </span>
                          {/* Stated about the destination, not the reader, so this page
                              renders the same HTML for everyone and can be cached. */}
                          {!open && (
                            <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-ink-muted">
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
                      className="text-[16px] font-bold text-ink"
                      style={{ fontFamily: "var(--fi-font-sans)" }}
                    >
                      Related Guides
                    </h2>
                    <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {related.map((g) => (
                      <Link
                        key={g.slug}
                        href={`/guides/${g.slug}`}
                        className="group rounded-xl border border-border/80 bg-white/70 px-5 py-4 no-underline transition-all duration-300 hover:border-brick/20 hover:shadow-md hover:shadow-[#b23a32]/5"
                      >
                        <span
                          className="text-[14px] font-semibold text-ink transition-colors group-hover:text-brick"
                          style={{ fontFamily: "var(--fi-font-sans)" }}
                        >
                          {g.title}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[12px] text-ink-muted">
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
              {guide.helpLinks && (
                <div className="rounded-xl border border-brick/25 bg-surface-0 px-5 py-5">
                  <p className="text-[15px] font-semibold text-ink">{guide.helpLinks.title}</p>
                  <ul className="mt-3 space-y-3">
                    {guide.helpLinks.links.map((l) => (
                      <li key={l.href + l.label}>
                        <a
                          href={l.href}
                          {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                          className="text-[14px] font-medium text-brick hover:underline"
                        >
                          {l.label}
                        </a>
                        {l.note && <p className="text-[12.5px] text-ink-muted">{l.note}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!guide.helpLinks && benchmarksBox}
              <nav
                aria-label="Guide contents"
                className="rounded-xl border border-border bg-white/80 px-5 py-4"
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-ink-muted">
                  In This Guide
                </p>
                <ul className="mt-3 space-y-2">
                  {guide.sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="flex items-center gap-2 text-[13px] text-ink-muted transition-colors hover:text-brick"
                      >
                        <span
                          className="h-1 w-1 shrink-0 rounded-full bg-border"
                          aria-hidden="true"
                        />
                        {section.heading}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              {guide.helpLinks && benchmarksBox}

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
                  text: plain(section.blocks.flatMap(blockText).join(" ")),
                  url: `${SITE_URL}/guides/${slug}#${section.id}`,
                },
              })),
            }).replace(/</g, "\\u003c"),
          }}
        />
    </div>
  );
}
