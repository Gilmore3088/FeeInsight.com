export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import {
  CONSUMER_GUIDES,
  PROFESSIONAL_GUIDES,
  guideCategories,
  type Guide,
} from "@/lib/guides";
import { getStats, getDataFreshness } from "@/lib/data-store";
import { getCachedFeeCategorySummaries } from "@/lib/data-store/fee-cache";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_URL } from "@/lib/constants";

const TITLE = "Consumer Guides — Understanding Bank Fees";
const DESCRIPTION =
  "Plain-language guides to bank and credit union fees, backed by live benchmark data. Overdraft, NSF, ATM, wire transfer and monthly maintenance fees explained. Free, and always will be.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/guides` },
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/guides`,
    siteName: "Fee Insight",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAMILY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  "Overdraft & NSF": { bg: "bg-[#C44B2E]/8", text: "text-[#C44B2E]", dot: "bg-[#C44B2E]" },
  "ATM & Card": { bg: "bg-amber-500/8", text: "text-amber-800", dot: "bg-amber-500" },
  "Wire Transfers": { bg: "bg-violet-500/8", text: "text-violet-800", dot: "bg-violet-500" },
  "Account Fees": { bg: "bg-emerald-500/8", text: "text-emerald-800", dot: "bg-emerald-500" },
  International: { bg: "bg-sky-500/8", text: "text-sky-800", dot: "bg-sky-500" },
  "Check Services": { bg: "bg-rose-400/8", text: "text-rose-700", dot: "bg-rose-400" },
  "Digital Banking": { bg: "bg-indigo-500/8", text: "text-indigo-800", dot: "bg-indigo-500" },
  "Account Lifecycle": { bg: "bg-orange-500/8", text: "text-orange-800", dot: "bg-orange-500" },
  "Branch Services": { bg: "bg-teal-500/8", text: "text-teal-800", dot: "bg-teal-500" },
  "Benchmarking Method": { bg: "bg-slate-500/8", text: "text-slate-700", dot: "bg-slate-500" },
};

const Arrow = () => (
  <svg
    className="h-3 w-3 transition-transform duration-500 group-hover:translate-x-1"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

function GuideCard({
  guide,
  summaryFor,
  featured,
}: {
  guide: Guide;
  summaryFor: Map<string, FeeCategorySummary>;
  featured: boolean;
}) {
  // Editorial order — the guide's own primary category leads, never a global sort.
  const relevantFees = guideCategories(guide)
    .map((c) => summaryFor.get(c))
    .filter((s): s is FeeCategorySummary => Boolean(s));
  const primary = summaryFor.get(guide.primaryCategory);
  const colors = FAMILY_COLORS[guide.family] ?? FAMILY_COLORS["Account Fees"];

  return (
    <Link
      href={`/guides/${guide.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-[#E8DFD1]/80 bg-white/70 no-underline backdrop-blur-sm transition-all duration-500 hover:-translate-y-0.5 hover:border-[#C44B2E]/20 hover:shadow-lg hover:shadow-[#C44B2E]/5"
    >
      <div
        className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#C44B2E]/0 to-transparent transition-all duration-700 group-hover:via-[#C44B2E]/40"
        aria-hidden="true"
      />

      <div className={featured ? "p-6" : "px-5 py-4"}>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${colors.bg} ${colors.text}`}
        >
          <span className={`h-1 w-1 rounded-full ${colors.dot}`} aria-hidden="true" />
          {guide.family}
        </span>

        <h3
          className={`mt-3 tracking-[-0.01em] text-[#1A1815] transition-colors duration-300 group-hover:text-[#C44B2E] ${
            featured
              ? "text-[18px] font-semibold leading-snug"
              : "text-[14px] font-semibold leading-snug"
          }`}
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          {guide.title}
        </h3>

        {featured && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-[#7A7062]">
            {guide.description}
          </p>
        )}

        {primary && featured && (
          <div className="mt-4 rounded-lg border border-[#E8DFD1]/50 bg-[#FAF7F2] p-3.5">
            <div className="flex items-baseline gap-2">
              <span
                className="text-[28px] font-light tracking-tight tabular-nums text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                {formatAmount(primary.median_amount)}
              </span>
              <span className="text-[11px] text-[#8A8073]">
                median {getDisplayName(primary.fee_category).toLowerCase()}
              </span>
            </div>

            {relevantFees.length > 1 && (
              <div className="mt-2.5 space-y-1.5">
                {relevantFees.slice(1, 4).map((fee) => (
                  <div
                    key={fee.fee_category}
                    className="flex items-center justify-between"
                  >
                    <span className="text-[11px] text-[#8A8073]">
                      {getDisplayName(fee.fee_category)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-px min-w-[20px] flex-1 bg-[#E8DFD1]/60"
                        aria-hidden="true"
                      />
                      <span className="text-[12px] font-medium tabular-nums text-[#5A5347]">
                        {formatAmount(fee.median_amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {primary && !featured && (
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className="text-[20px] font-light tracking-tight tabular-nums text-[#1A1815]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              {formatAmount(primary.median_amount)}
            </span>
            <span className="text-[10px] text-[#8A8073]">
              median {getDisplayName(primary.fee_category).toLowerCase()}
            </span>
          </div>
        )}

        <div
          className={`flex items-center gap-1.5 text-[12px] font-medium text-[#C44B2E]/60 transition-colors duration-300 group-hover:text-[#C44B2E] ${
            featured ? "mt-4" : "mt-3"
          }`}
        >
          <span>Read guide</span>
          <Arrow />
        </div>
      </div>
    </Link>
  );
}

export default async function GuidesIndexPage() {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    // Signed out. Every consumer guide below is public regardless.
  }
  const isPro = canAccessPremium(user);

  const [allSummaries, stats, freshness] = await Promise.all([
    getCachedFeeCategorySummaries(),
    getStats(),
    getDataFreshness(),
  ]);

  const summaryFor = new Map(allSummaries.map((s) => [s.fee_category, s]));
  const totalObservations = allSummaries.reduce((a, s) => a + s.total_observations, 0);
  const updateDate = freshness.last_crawl_at
    ? new Date(freshness.last_crawl_at).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : null;

  const featured = CONSUMER_GUIDES.filter((g) => g.featured);
  const more = CONSUMER_GUIDES.filter((g) => !g.featured);

  return (
    <div className="mx-auto max-w-7xl px-6 py-16">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Guides", href: "/guides" },
        ]}
      />

      {/* ── Hero ── */}
      <div className="max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-px w-8 bg-[#C44B2E]/40" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#C44B2E]/60">
            Consumer Guides
          </span>
        </div>

        <h1
          className="text-[2rem] leading-[1.1] tracking-[-0.025em] text-[#1A1815] sm:text-[2.5rem]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Understand what your bank <em style={{ fontWeight: 300 }}>charges</em>
        </h1>

        <p className="mt-4 text-[15px] leading-relaxed text-[#7A7062]">
          Plain-language guides backed by live benchmark data from{" "}
          <span className="font-medium tabular-nums text-[#5A5347]">
            {stats.total_institutions.toLocaleString()}
          </span>{" "}
          institutions. Free to read, and always will be.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#8A8073]">
          <span className="tabular-nums">
            {totalObservations.toLocaleString()} fee observations
          </span>
          {updateDate && (
            <>
              <span className="h-3 w-px bg-[#D4C9BA]" aria-hidden="true" />
              <span>Fee data updated {updateDate}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Featured consumer guides ── */}
      <section aria-labelledby="featured-heading" className="mt-12">
        <h2 id="featured-heading" className="sr-only">
          Featured consumer guides
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((guide) => (
            <GuideCard
              key={guide.slug}
              guide={guide}
              summaryFor={summaryFor}
              featured
            />
          ))}
        </div>
      </section>

      {/* ── More consumer guides ── */}
      {more.length > 0 && (
        <section aria-labelledby="more-heading" className="mt-14">
          <div className="mb-6 flex items-center gap-3">
            <h2
              id="more-heading"
              className="text-[15px] font-medium text-[#1A1815]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              More Fee Guides
            </h2>
            <span className="h-px flex-1 bg-[#E8DFD1]" aria-hidden="true" />
            <span className="text-[11px] tabular-nums text-[#8A8073]">
              {more.length} guides
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {more.map((guide) => (
              <GuideCard
                key={guide.slug}
                guide={guide}
                summaryFor={summaryFor}
                featured={false}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Professional guides ── */}
      {PROFESSIONAL_GUIDES.length > 0 && (
        <section aria-labelledby="professional-heading" className="mt-16">
          <div className="mb-6 flex items-center gap-3">
            <h2
              id="professional-heading"
              className="text-[15px] font-medium text-[#1A1815]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              For Bankers &amp; Consultants
            </h2>
            <span className="h-px flex-1 bg-[#E8DFD1]" aria-hidden="true" />
            <span className="text-[11px] text-[#8A8073]">
              {isPro ? "Included in your plan" : "Professional plan"}
            </span>
          </div>

          <p className="mb-5 max-w-2xl text-[13px] leading-relaxed text-[#7A7062]">
            Benchmarking method for people who set fees rather than pay them. Separate
            guides for a separate reader — the consumer guides above stay free for
            everyone, including you.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PROFESSIONAL_GUIDES.map((guide) => (
              <Link
                key={guide.slug}
                href={`/guides/${guide.slug}`}
                className="group rounded-xl border border-[#E8DFD1]/80 bg-[#FAF7F2]/60 px-5 py-4 no-underline transition-all duration-300 hover:border-[#C44B2E]/20 hover:bg-white hover:shadow-md hover:shadow-[#C44B2E]/5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8A8073]">
                    {guide.family}
                  </span>
                  {!isPro && (
                    <svg
                      className="h-2.5 w-2.5 text-[#8A8073]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      role="img"
                      aria-label="Professional plan required"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                  )}
                </div>
                <h3
                  className="mt-2 text-[15px] font-semibold leading-snug text-[#1A1815] transition-colors group-hover:text-[#C44B2E]"
                  style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                >
                  {guide.title}
                </h3>
                <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-[#7A7062]">
                  {guide.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Explore ── */}
      <section
        aria-labelledby="explore-heading"
        className="mt-16 rounded-xl border border-[#E8DFD1] bg-white/50 px-7 py-6 backdrop-blur-sm"
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="h-px w-6 bg-[#C44B2E]/30" aria-hidden="true" />
          <h2
            id="explore-heading"
            className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#8A8073]"
          >
            Explore More
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Find Your Bank", href: "/institutions", desc: "Search any institution" },
            { label: "Fee Index", href: "/fees", desc: "Every category we track" },
            {
              label: "National Benchmarks",
              href: "/research/national-fee-index",
              desc: "Medians & percentiles",
            },
            { label: "State Reports", href: "/research", desc: "Geographic analysis" },
            {
              label: "Revenue Analysis",
              href: "/research/fee-revenue-analysis",
              desc: "Fee-to-income data",
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-lg border border-[#E8DFD1]/60 bg-[#FAF7F2]/50 px-4 py-3 no-underline transition-all duration-300 hover:border-[#C44B2E]/20 hover:bg-white"
            >
              <span className="text-[13px] font-medium text-[#1A1815] transition-colors group-hover:text-[#C44B2E]">
                {item.label}
              </span>
              <span className="mt-0.5 block text-[11px] text-[#8A8073]">{item.desc}</span>
            </Link>
          ))}
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: TITLE,
            description: DESCRIPTION,
            url: `${SITE_URL}/guides`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
