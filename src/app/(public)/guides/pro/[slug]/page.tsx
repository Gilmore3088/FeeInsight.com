/**
 * Professional guides — the paying tier.
 *
 * Deliberately dynamic and deliberately a separate route. Gating on the session is what
 * makes a route dynamic, so keeping professional guides here is what lets the consumer
 * guides at `/guides/[slug]` be statically prerendered for everyone.
 *
 * The tier gates the whole guide, never a section of it. A reader without a subscription
 * sees the title, the description and an upgrade prompt — never a truncated body.
 */
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { guideCategories } from "@/lib/guides";
import { loadGuide, loadRelatedGuides } from "@/lib/guides/source";
import { getFeeCategoryDetail } from "@/lib/data-store";
import { getCachedFeeCategorySummaries } from "@/lib/data-store/fee-cache";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { UpgradeGate } from "@/components/upgrade-gate";
import {
  GuideSectionRenderer,
  type GuideBreakdowns,
} from "@/components/public/guide-blocks";
import { SITE_URL } from "@/lib/constants";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = await loadGuide(slug);
  if (!guide || guide.audience !== "professional") return { title: "Guide Not Found" };

  const url = `${SITE_URL}/guides/pro/${slug}`;
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
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function ProGuidePage({ params }: PageProps) {
  const { slug } = await params;
  const guide = await loadGuide(slug);
  if (!guide || guide.audience !== "professional") notFound();

  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    // Signed out. The gate below handles it.
  }
  const isPro = canAccessPremium(user);

  const categories = guideCategories(guide);
  const [allSummaries, related] = await Promise.all([
    getCachedFeeCategorySummaries(),
    loadRelatedGuides(guide),
  ]);
  const summaryFor = new Map(allSummaries.map((s) => [s.fee_category, s]));
  const relevantFees = categories
    .map((c) => summaryFor.get(c))
    .filter((s): s is FeeCategorySummary => Boolean(s));

  // Only fetch the breakdowns a paying reader will actually see.
  const breakdowns: GuideBreakdowns = new Map();
  if (isPro) {
    const comparisonCategories = [
      ...new Set(
        guide.sections.flatMap((s) =>
          s.blocks
            .filter((b) => b.type === "comparison")
            .map((b) => (b as { category: string }).category),
        ),
      ),
    ];
    const details = await Promise.all(
      comparisonCategories.map((c) => getFeeCategoryDetail(c)),
    );
    comparisonCategories.forEach((category, i) => {
      breakdowns.set(category, {
        charter: details[i].by_charter_type,
        asset_tier: details[i].by_asset_tier,
        state: details[i].by_state,
      });
    });
  }

  const reviewDate = formatDate(guide.reviewedAt);

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Guides", href: "/guides" },
          { name: guide.title, href: `/guides/pro/${slug}` },
        ]}
      />

      <nav
        aria-label="Breadcrumb"
        className="mb-8 flex items-center gap-2 text-[12px] text-[#8A8073]"
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

      <div className="max-w-3xl">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-px w-8 bg-[#1A1815]/30" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#1A1815]/60">
            Professional Guide
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
              <span>Reviewed {reviewDate}</span>
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

      {!isPro ? (
        <div className="mt-10 max-w-2xl">
          <UpgradeGate message={`"${guide.title}" is part of the professional guide set`} />
          <p className="mt-6 text-[14px] leading-relaxed text-[#7A7062]">
            Every consumer fee guide on this site is free and ungated, including for
            subscribers.{" "}
            <Link href="/guides" className="font-medium text-[#C44B2E]">
              Browse the consumer guides
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          {relevantFees.length > 0 && (
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {relevantFees.slice(0, 3).map((fee) => (
                <Link
                  key={fee.fee_category}
                  href={`/fees/${fee.fee_category}`}
                  className="group rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-5 py-4 no-underline transition-all hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5"
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#8A8073] transition-colors group-hover:text-[#C44B2E]/70">
                    {getDisplayName(fee.fee_category)}
                  </p>
                  <p
                    className="mt-2 text-[26px] font-light tracking-tight tabular-nums text-[#1A1815]"
                    style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                  >
                    {formatAmount(fee.median_amount)}
                    <span className="ml-2 font-sans text-[11px] font-normal text-[#8A8073]">
                      median
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] tabular-nums text-[#8A8073]">
                    {fee.institution_count.toLocaleString()} institutions
                  </p>
                </Link>
              ))}
            </div>
          )}

          <div className="mt-12 max-w-3xl space-y-10">
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

          <div className="mt-12 flex flex-wrap gap-3">
            <Link
              href="/pro/peers"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1A1815] px-5 py-2.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#33302B]"
            >
              Open the peer tools
            </Link>
            <Link
              href="/research"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DFD1] bg-white/80 px-5 py-2.5 text-[13px] font-medium text-[#5A5347] no-underline transition-all hover:border-[#C44B2E]/30 hover:text-[#C44B2E]"
            >
              State &amp; district reports
            </Link>
          </div>
        </>
      )}

      {related.length > 0 && (
        <section aria-labelledby="related-heading" className="mt-14">
          <div className="mb-5 flex items-center gap-3">
            <h2
              id="related-heading"
              className="text-[16px] font-medium text-[#1A1815]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              More Professional Guides
            </h2>
            <span className="h-px flex-1 bg-[#E8DFD1]" aria-hidden="true" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {related.map((g) => (
              <Link
                key={g.slug}
                href={`/guides/pro/${g.slug}`}
                className="group rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-5 py-4 no-underline transition-all hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5"
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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: guide.seoTitle,
            description: guide.description,
            url: `${SITE_URL}/guides/pro/${slug}`,
            datePublished: guide.publishedAt,
            dateModified: guide.reviewedAt,
            author: { "@type": "Organization", name: guide.author },
            publisher: { "@type": "Organization", name: "Fee Insight" },
            isAccessibleForFree: false,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
