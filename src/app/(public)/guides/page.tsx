/**
 * Regenerated in the background (ISR) at most hourly, like the guide pages themselves
 * (#1811). Publishing a guide from admin revalidates this path, and a takedown
 * invalidates the public read cache the medians come from.
 *
 * This page reads no session; the professional set is labelled by what it is rather than
 * by who is reading. It used to render per request so that a build during a database
 * blip could not bake an index with no medians for the whole interval. The homepage's
 * guard covers that now (#1572): the snapshot is never cached while a read failed, and a
 * render with a failed read is cached for one minute instead of an hour
 * (`shortenPageLife`), so the next render reads the database again.
 */
export const revalidate = 3600;

import type { Metadata } from "next";
import { ProLock } from "@/components/public/pro-lock";
import Link from "next/link";
import { guideCategories, type Guide } from "@/lib/guides";
import { loadConsumerGuides, loadProfessionalGuides } from "@/lib/guides/source";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_URL } from "@/lib/constants";
import { COVERAGE_LABELS, getPublicSnapshot } from "@/lib/public-stats";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, medianHasUnstatedAudience } from "@/components/unstated-audience";
import { PAGE_HEADER } from "@/components/public/page-header";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";

const TITLE = "Consumer Guides — Understanding Bank Fees";
const DESCRIPTION =
  "Plain-language guides to bank and credit union fees, backed by live benchmark data. Overdraft, NSF, ATM, wire transfer and monthly maintenance fees explained.";

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
  "Overdraft & NSF": { bg: "bg-brick/8", text: "text-brick", dot: "bg-brick" },
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

/** The category summaries whose medians a guide card prints: the primary, plus up to three more on a featured card. */
function cardMedians(guide: Guide, summaryFor: Map<string, FeeCategorySummary>, featured: boolean): FeeCategorySummary[] {
  const primary = summaryFor.get(guide.primaryCategory);
  if (!primary) return [];
  if (!featured) return [primary];
  const relevantFees = guideCategories(guide)
    .map((c) => summaryFor.get(c))
    .filter((s): s is FeeCategorySummary => Boolean(s));
  return [primary, ...(relevantFees.length > 1 ? relevantFees.slice(1, 4) : [])];
}

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
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border/80 bg-white/70 no-underline backdrop-blur-sm transition-all duration-500 hover:-translate-y-0.5 hover:border-brick/20 hover:shadow-lg hover:shadow-[#b23a32]/5"
    >
      <div
        className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-brick/0 to-transparent transition-all duration-700 group-hover:via-brick/40"
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
          className={`mt-3 tracking-[-0.01em] text-ink transition-colors duration-300 group-hover:text-brick ${
            featured
              ? "text-[18px] font-bold leading-snug"
              : "text-[14px] font-semibold leading-snug"
          }`}
          style={{ fontFamily: "var(--fi-font-sans)" }}
        >
          {guide.title}
        </h3>

        {featured && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
            {guide.description}
          </p>
        )}

        {primary && featured && (
          <div className="mt-4 rounded-lg border border-border/50 bg-paper p-3.5">
            <div className="flex items-baseline gap-2">
              <span
                className="text-[28px] font-semibold tracking-tight tabular-nums text-ink"
                style={{ fontFamily: "var(--fi-font-mono)" }}
              >
                {formatAmount(primary.median_amount)}
                <UnstatedAudienceMark show={medianHasUnstatedAudience(primary)} />
              </span>
              <span className="text-[11px] text-ink-muted">
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
                    <span className="text-[11px] text-ink-muted">
                      {getDisplayName(fee.fee_category)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-px min-w-[20px] flex-1 bg-border/60"
                        aria-hidden="true"
                      />
                      <span className="text-[12px] font-medium tabular-nums text-ink-soft">
                        {formatAmount(fee.median_amount)}
                        <UnstatedAudienceMark show={medianHasUnstatedAudience(fee)} />
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
              className="text-[20px] font-semibold tracking-tight tabular-nums text-ink"
              style={{ fontFamily: "var(--fi-font-mono)" }}
            >
              {formatAmount(primary.median_amount)}
              <UnstatedAudienceMark show={medianHasUnstatedAudience(primary)} />
            </span>
            <span className="text-[10px] text-ink-muted">
              median {getDisplayName(primary.fee_category).toLowerCase()}
            </span>
          </div>
        )}

        <div
          className={`flex items-center gap-1.5 text-[12px] font-medium text-brick/60 transition-colors duration-300 group-hover:text-brick ${
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
  // Counts and medians from the shared public snapshot, so they match the fee index.
  const [{ summary, categories: allSummaries }, consumerGuides, professionalGuides] =
    await Promise.all([
      getPublicSnapshot(),
      loadConsumerGuides(),
      loadProfessionalGuides(),
    ]);
  // A render with a failed snapshot read is cached for a minute, not an hour (see the note at the top).
  if (!summary.complete || allSummaries.length === 0) await shortenPageLife();

  const summaryFor = new Map(allSummaries.map((s) => [s.fee_category, s]));

  const featured = consumerGuides.filter((g) => g.featured);
  const more = consumerGuides.filter((g) => !g.featured);
  // The asterisk's footnote shows when any median a card prints rests on an unstated-audience row.
  const unstatedShown = [
    ...featured.flatMap((guide) => cardMedians(guide, summaryFor, true)),
    ...more.flatMap((guide) => cardMedians(guide, summaryFor, false)),
  ].some(medianHasUnstatedAudience);

  return (
    <div className="mx-auto max-w-page px-6 py-16">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Guides", href: "/guides" },
        ]}
      />

      {/* ── Hero ── */}
      <header className={`mx-auto max-w-2xl sm:mx-0 ${PAGE_HEADER}`}>
        <div className="mb-4 flex items-center justify-center gap-2 sm:justify-start">
          <span className="h-px w-8 bg-brick/40" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brick/60">
            Consumer Guides
          </span>
        </div>

        <h1
          className="font-extrabold text-[2rem] leading-[1.1] tracking-[-0.025em] text-ink sm:text-[2.5rem]"
          style={{ fontFamily: "var(--fi-font-sans)" }}
        >
          Understand what your bank <em style={{ fontWeight: 300 }}>charges</em>
        </h1>

        <p className="mx-auto mt-4 max-w-[34rem] text-[15px] leading-relaxed text-ink-muted sm:mx-0 sm:max-w-none">
          Plain-language guides backed by live benchmark data from{" "}
          <span className="font-medium tabular-nums text-ink-soft">
            {summary.institutionsLabel}
          </span>{" "}
          institutions with published fees (of {summary.monitoredLabel} monitored).
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-ink-muted sm:justify-start">
          <span className="tabular-nums">
            {summary.observationsLabel} {COVERAGE_LABELS.observations.toLowerCase()}
          </span>
          <span className="h-3 w-px bg-border" aria-hidden="true" />
          <span>{summary.freshnessLabel}</span>
        </div>
      </header>

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
              className="text-[15px] font-bold text-ink"
              style={{ fontFamily: "var(--fi-font-sans)" }}
            >
              More Fee Guides
            </h2>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span className="text-[11px] tabular-nums text-ink-muted">
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

      <UnstatedAudienceFootnote show={unstatedShown} className="mt-6" />

      {/* ── Professional guides ── */}
      {professionalGuides.length > 0 && (
        <section aria-labelledby="professional-heading" className="mt-16">
          <div className="mb-6 flex items-center gap-3">
            <h2
              id="professional-heading"
              className="text-[15px] font-bold text-ink"
              style={{ fontFamily: "var(--fi-font-sans)" }}
            >
              For Bankers &amp; Consultants
            </h2>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span className="text-[11px] text-ink-muted">Pro</span>
          </div>

          <p className="mb-5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Benchmarking method for people who set fees rather than pay them. Separate
            guides for a separate reader — the consumer guides above stay free for
            everyone, including you.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {professionalGuides.map((guide) => (
              <Link
                key={guide.slug}
                href={`/guides/pro/${guide.slug}`}
                className="group rounded-xl border border-border/80 bg-paper/60 px-5 py-4 no-underline transition-all duration-300 hover:border-brick/20 hover:bg-white hover:shadow-md hover:shadow-[#b23a32]/5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted">
                    {guide.family}
                  </span>
                  <svg
                    className="h-2.5 w-2.5 text-ink-muted"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    role="img"
                    aria-label="Pro plan required"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
                <h3
                  className="mt-2 text-[15px] font-bold leading-snug text-ink transition-colors group-hover:text-brick"
                  style={{ fontFamily: "var(--fi-font-sans)" }}
                >
                  {guide.title}
                </h3>
                <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-ink-muted">
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
        className="mt-16 rounded-xl border border-border bg-white/50 px-7 py-6 backdrop-blur-sm"
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="h-px w-6 bg-brick/30" aria-hidden="true" />
          <h2
            id="explore-heading"
            className="text-[10px] font-bold uppercase tracking-[0.15em] text-ink-muted"
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
              pro: true,
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-lg border border-border/60 bg-paper/50 px-4 py-3 no-underline transition-all duration-300 hover:border-brick/20 hover:bg-white"
            >
              <span className="text-[13px] font-medium text-ink transition-colors group-hover:text-brick">
                {item.label}
              </span>
              {"pro" in item && item.pro && <ProLock className="ml-1.5 align-middle" />}
              <span className="mt-0.5 block text-[11px] text-ink-muted">{item.desc}</span>
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
