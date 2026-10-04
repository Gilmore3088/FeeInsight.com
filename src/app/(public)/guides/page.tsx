export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { formatAbsoluteDate } from "@/lib/public-stats";
import { GUIDES } from "@/lib/guides";
import {
  getFeeCategorySummaries,
  getStats,
  getDataFreshness,
} from "@/lib/data-store";
import { getDisplayName, FAMILY_COLORS as TAXONOMY_FAMILY_COLORS, TAXONOMY_COUNT } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Consumer Guides - Understanding Bank Fees",
  description:
    "Plain-language guides to understanding bank and credit union fees. Overdraft fees, NSF fees, ATM fees, wire transfers, and monthly maintenance fees explained with live data.",
};

const PRIMARY_SLUGS = new Set([
  "overdraft-fees",
  "nsf-fees",
  "atm-fees",
  "wire-transfer-fees",
  "monthly-maintenance-fees",
]);

const FAMILY_LABELS: Record<string, string> = {
  "overdraft-fees": "Overdraft & NSF",
  "nsf-fees": "Overdraft & NSF",
  "atm-fees": "ATM & Card",
  "wire-transfer-fees": "Wire Transfers",
  "monthly-maintenance-fees": "Account Fees",
  "foreign-transaction-fees": "International",
  "check-fees": "Check Services",
  "digital-banking-fees": "Digital Banking",
  "account-closure-fees": "Account Lifecycle",
  "safe-deposit-fees": "Branch Services",
};

// Guide families map onto the taxonomy's warm palette (one system, no stock Tailwind hues).
const GUIDE_FAMILY_TO_TAXONOMY: Record<string, string> = {
  "Overdraft & NSF": "Overdraft & NSF",
  "ATM & Card": "ATM & Card",
  "Wire Transfers": "Wire Transfers",
  "Account Fees": "Account Maintenance",
  "International": "Cash & Deposit",
  "Check Services": "Check Services",
  "Digital Banking": "Digital & Electronic",
  "Account Lifecycle": "Account Services",
  "Branch Services": "Lending Fees",
};

const FAMILY_COLORS: Record<string, { bg: string; text: string; dot: string }> = Object.fromEntries(
  Object.entries(GUIDE_FAMILY_TO_TAXONOMY).map(([guideFamily, taxonomyFamily]) => {
    const palette = TAXONOMY_FAMILY_COLORS[taxonomyFamily] ?? TAXONOMY_FAMILY_COLORS["Account Maintenance"];
    return [guideFamily, { bg: palette.bg, text: palette.text, dot: palette.dot }];
  }),
);

function GuideCard({
  guide,
  allSummaries,
  featured,
}: {
  guide: (typeof GUIDES)[number];
  allSummaries: Awaited<ReturnType<typeof getFeeCategorySummaries>>;
  featured: boolean;
}) {
  const relevantFees = allSummaries.filter((s) =>
    guide.feeCategories.includes(s.fee_category)
  );
  const topFee = relevantFees[0];
  const family = FAMILY_LABELS[guide.slug] ?? "General";
  const colors = FAMILY_COLORS[family] ?? FAMILY_COLORS["Account Fees"];

  return (
    <Link
      href={`/guides/${guide.slug}`}
      className="group relative flex flex-col rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm overflow-hidden transition-all duration-500 hover:border-[#C44B2E]/20 hover:shadow-lg hover:shadow-[#C44B2E]/5 hover:-translate-y-0.5 no-underline"
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#C44B2E]/0 to-transparent group-hover:via-[#C44B2E]/40 transition-all duration-700" />

      <div className={`${featured ? "p-6" : "px-5 py-4"}`}>
        {/* Header: badge + data point */}
        <div className="flex items-start justify-between gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${colors.bg} ${colors.text}`}>
            <span className={`h-1 w-1 rounded-full ${colors.dot}`} />
            {family}
          </span>
          {topFee && featured && (
            <span className="text-[11px] font-medium text-[#6B6255] tabular-nums">
              median
            </span>
          )}
        </div>

        {/* Title */}
        <h2
          className={`mt-3 tracking-[-0.01em] text-[#1A1815] group-hover:text-[#C44B2E] transition-colors duration-300 ${
            featured
              ? "text-[18px] leading-snug font-semibold"
              : "text-[14px] leading-snug font-semibold"
          }`}
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          {guide.title.split(":")[0]}
        </h2>

        {featured && (
          <p className="mt-2 text-[13px] leading-relaxed text-[#6B6255] line-clamp-2">
            {guide.description}
          </p>
        )}

        {/* Fee data */}
        {topFee && featured && (
          <div className="mt-4 rounded-lg bg-[#FAF7F2] border border-[#E8DFD1]/50 p-3.5">
            <div className="flex items-baseline gap-2">
              <span
                className="text-[28px] font-light tracking-tight text-[#1A1815] tabular-nums"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                {formatAmount(topFee.median_amount)}
              </span>
              <span className="text-[11px] text-[#6B6255]">
                {getDisplayName(topFee.fee_category)}
              </span>
            </div>

            {relevantFees.length > 1 && (
              <div className="mt-2.5 space-y-1.5">
                {relevantFees.slice(1, 4).map((fee) => (
                  <div
                    key={fee.fee_category}
                    className="flex items-center justify-between"
                  >
                    <span className="text-[11px] text-[#6B6255]">
                      {getDisplayName(fee.fee_category)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="h-px flex-1 min-w-[20px] bg-[#E8DFD1]/60" />
                      <span className="text-[12px] tabular-nums font-medium text-[#5A5347]">
                        {formatAmount(fee.median_amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {topFee && !featured && (
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className="text-[20px] font-light tracking-tight text-[#1A1815] tabular-nums"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              {formatAmount(topFee.median_amount)}
            </span>
            <span className="text-[10px] text-[#6B6255]">median</span>
          </div>
        )}

        {/* Read prompt */}
        <div className={`flex items-center gap-1.5 text-[12px] font-medium text-[#A93D25]/60 group-hover:text-[#A93D25] transition-colors duration-300 ${featured ? "mt-4" : "mt-3"}`}>
          <span>Read guide</span>
          <svg
            className="h-3 w-3 transition-transform duration-500 group-hover:translate-x-1"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}

export default async function GuidesIndexPage() {
  const allSummaries = await getFeeCategorySummaries();
  const stats = await getStats();
  const freshness = await getDataFreshness();

  const totalObservations = allSummaries.reduce(
    (a, s) => a + s.total_observations,
    0
  );
  const updateDate = formatAbsoluteDate(freshness.last_crawl_at);

  const primaryGuides = GUIDES.filter((g) => PRIMARY_SLUGS.has(g.slug));
  const secondaryGuides = GUIDES.filter((g) => !PRIMARY_SLUGS.has(g.slug));

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
        <div className="flex items-center gap-2 mb-4">
          <span className="h-px w-8 bg-[#C44B2E]/40" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
            Consumer Guides
          </span>
        </div>

        <h1
          className="text-[2rem] sm:text-[2.5rem] leading-[1.1] tracking-[-0.025em] text-[#1A1815]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Understand what your bank{" "}
          <em style={{ fontWeight: 300 }}>charges</em>
        </h1>

        <p className="mt-4 text-[15px] leading-relaxed text-[#6B6255]">
          Plain-language guides backed by live benchmark data from{" "}
          <span className="font-medium text-[#5A5347] tabular-nums">
            {stats.total_institutions.toLocaleString()}
          </span>{" "}
          institutions.
        </p>

        <div className="mt-4 flex items-center gap-4 text-[12px] text-[#6B6255]">
          <span className="tabular-nums">
            {totalObservations.toLocaleString()} fee observations
          </span>
          {updateDate && (
            <>
              <span className="h-3 w-px bg-[#D4C9BA]" />
              <span>Updated {updateDate}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Primary guides: editorial card grid ── */}
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {primaryGuides.map((guide) => (
          <GuideCard
            key={guide.slug}
            guide={guide}
            allSummaries={allSummaries}
            featured
          />
        ))}
      </div>

      {/* ── More guides ── */}
      {secondaryGuides.length > 0 && (
        <div className="mt-14">
          <div className="flex items-center gap-3 mb-6">
            <h2
              className="text-[15px] font-medium text-[#1A1815]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              More Fee Guides
            </h2>
            <span className="h-px flex-1 bg-[#E8DFD1]" />
            <span className="text-[11px] text-[#6B6255] tabular-nums">
              {secondaryGuides.length} guides
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {secondaryGuides.map((guide) => (
              <GuideCard
                key={guide.slug}
                guide={guide}
                allSummaries={allSummaries}
                featured={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Explore ── */}
      <div className="mt-16 rounded-xl border border-[#E8DFD1] bg-white/50 backdrop-blur-sm px-7 py-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="h-px w-6 bg-[#C44B2E]/30" />
          <h2 className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255]">
            Explore More
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { label: "Fee Index", href: "/fees", desc: `All ${TAXONOMY_COUNT} categories` },
            { label: "National Benchmarks", href: "/research/national-fee-index", desc: "Medians & percentiles" },
            { label: "State Reports", href: "/research", desc: "Geographic analysis" },
            { label: "Fed Districts", href: "/research#districts", desc: "12 district reports" },
            { label: "Revenue Analysis", href: "/research/fee-revenue-analysis", desc: "Fee-to-income data" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-lg border border-[#E8DFD1]/60 bg-[#FAF7F2]/50 px-4 py-3 transition-all duration-300 hover:border-[#C44B2E]/20 hover:bg-white no-underline"
            >
              <span className="text-[13px] font-medium text-[#1A1815] group-hover:text-[#A93D25] transition-colors">
                {item.label}
              </span>
              <span className="block mt-0.5 text-[11px] text-[#6B6255]">
                {item.desc}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Pro teaser */}
      <div className="mt-8 rounded-xl border border-[#E8DFD1] bg-gradient-to-r from-[#FFFDF9] to-[#FAF7F2] px-7 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-[#1A1815]">
            Want to benchmark your institution?
          </p>
          <p className="mt-0.5 text-[12px] text-[#6B6255]">
            Pro members get evidence-labeled peer comparisons, FDIC financial data, and Hamilton analysis workflows.
          </p>
        </div>
        <Link
          href="/subscribe"
          className="shrink-0 rounded-full bg-[#C44B2E] px-5 py-2 text-[12px] font-semibold text-white no-underline hover:bg-[#A83D25] transition-colors"
        >
          View Plans
        </Link>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Consumer Guides - Understanding Bank Fees",
            description:
              "Plain-language guides to understanding bank and credit union fees.",
            url: `${SITE_URL}/guides`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
