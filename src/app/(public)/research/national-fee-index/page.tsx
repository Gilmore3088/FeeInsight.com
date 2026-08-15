export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { getNationalIndexCached, getCpiContext } from "@/lib/data-store";
import {
  getDisplayName,
  FEE_FAMILIES,
  FAMILY_COLORS,
  TAXONOMY_COUNT,
  FEATURED_COUNT,
  getSpotlightCategories,
} from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DataFreshness } from "@/components/data-freshness";
import { LeadCapture } from "@/components/public/lead-capture";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";

export const metadata: Metadata = {
  title: "National Fee Index - US Bank & Credit Union Fee Benchmarks",
  description:
    "The definitive national benchmark of bank and credit union fees. Median fees, percentiles, and institution counts across our full catalog of categories, from thousands of published fee schedules.",
  keywords: [
    "national fee index",
    "bank fee benchmarks",
    "average bank fees",
    "overdraft fee average",
    "NSF fee average",
    "credit union fees",
    "bank fee comparison",
  ],
};

export default async function NationalFeeIndexPage() {
  const user = await getCurrentUser();
  const isPro = canAccessPremium(user);
  const allIndex = await getNationalIndexCached();
  const cpi = await getCpiContext();

  // Pro: full index. Free: spotlight preview only (6 categories)
  const spotlightCats = new Set(getSpotlightCategories());
  const index = isPro
    ? allIndex
    : allIndex.filter((e) => spotlightCats.has(e.fee_category));
  const gatedCount = allIndex.length - index.length;

  // Group by family
  const byFamily = new Map<string, typeof index>();
  for (const entry of index) {
    const family = entry.fee_family ?? "Other";
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family)!.push(entry);
  }

  const familyOrder = Object.keys(FEE_FAMILIES);

  // Summary stats (from full index for context)
  const totalObservations = allIndex.reduce(
    (sum, e) => sum + e.observation_count,
    0
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: "National Fee Index", href: "/research/national-fee-index" },
        ]}
      />

      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-[#C44B2E]/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
          National Fee Index
        </span>
        {!isPro && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#E8DFD1]/50 text-[#6B6255] uppercase tracking-wider ml-1">
            Preview
          </span>
        )}
      </div>
      <h1
        className="mt-1 text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] font-bold text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        US Bank & Credit Union Fee Benchmarks
      </h1>
      <p className="mt-2 max-w-2xl text-[14px] text-[#6B6255]">
        {isPro ? (
          <>
            National benchmarking data across {TAXONOMY_COUNT} fee categories,
            computed from published fee schedules of FDIC-insured banks and
            NCUA-insured credit unions.
          </>
        ) : (
          <>
            Preview of {index.length} spotlight fee categories from our full
            index of {TAXONOMY_COUNT} categories.{" "}
            <Link
              href="/subscribe"
              className="text-[#C44B2E] hover:underline font-medium"
            >
              Subscribe
            </Link>{" "}
            for the complete dataset with percentiles, peer segmentation, and
            exports.
          </>
        )}
      </p>
      <div className="mt-1">
        <DataFreshness />
      </div>

      <LeadCapture
        placement="national_index"
        className="mt-5"
        eyebrow="Monthly index update"
        headline="Get the national fee index in your inbox"
        body="New national medians, the fee changes that moved them, and one chart — about once a month."
        buttonLabel="Subscribe"
        secondaryLink={{ href: "/reports/sample-competitive-fee-position", label: "See the sample report" }}
      />

      {/* CPI context strip */}
      {cpi.bankFees && cpi.allItems && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-5 py-3 text-[13px]">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
            CPI Context
          </span>
          <span className="text-[#5A5347]">
            Bank service fees{" "}
            <span
              className={`font-semibold tabular-nums ${cpi.bankFees.yoyPct > 0 ? "text-red-600" : "text-emerald-600"}`}
            >
              {cpi.bankFees.yoyPct > 0 ? "+" : ""}
              {cpi.bankFees.yoyPct}%
            </span>{" "}
            YoY
          </span>
          <span className="text-[#6B6255]">vs.</span>
          <span className="text-[#5A5347]">
            Overall CPI{" "}
            <span className="font-semibold tabular-nums text-[#5A5347]">
              {cpi.allItems.yoyPct > 0 ? "+" : ""}
              {cpi.allItems.yoyPct}%
            </span>{" "}
            YoY
          </span>
          <span className="text-[11px] text-[#6B6255]">
            BLS as of {new Date(cpi.bankFees.date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
          </span>
        </div>
      )}

      {/* Summary cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255]">
            {isPro ? "Fee Categories" : "Preview"}
          </p>
          <p
            className="mt-1 text-lg font-bold tabular-nums text-[#1A1815]"
            style={{
              fontFamily: "var(--font-newsreader), Georgia, serif",
              fontWeight: 300,
            }}
          >
            {isPro
              ? allIndex.length
              : `${index.length} / ${allIndex.length}`}
          </p>
        </div>
        <div className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255]">
            Observations
          </p>
          <p
            className="mt-1 text-lg font-bold tabular-nums text-[#1A1815]"
            style={{
              fontFamily: "var(--font-newsreader), Georgia, serif",
              fontWeight: 300,
            }}
          >
            {totalObservations.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255]">
            Full Index
          </p>
          <p
            className="mt-1 text-lg font-bold tabular-nums text-[#1A1815]"
            style={{
              fontFamily: "var(--font-newsreader), Georgia, serif",
              fontWeight: 300,
            }}
          >
            {TAXONOMY_COUNT} categories
          </p>
        </div>
        <div className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255]">
            Featured Fees
          </p>
          <p
            className="mt-1 text-lg font-bold tabular-nums text-[#1A1815]"
            style={{
              fontFamily: "var(--font-newsreader), Georgia, serif",
              fontWeight: 300,
            }}
          >
            {FEATURED_COUNT}
          </p>
        </div>
      </div>

      {/* Upgrade banner for free users */}
      {!isPro && (
        <div className="mt-8 rounded-xl border-2 border-[#C44B2E]/30 bg-white/70 backdrop-blur-sm p-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#C44B2E]/40 to-transparent" />
          <div className="md:flex md:items-center md:justify-between">
            <div>
              <h2
                className="text-[16px] font-medium text-[#1A1815]"
                style={{
                  fontFamily: "var(--font-newsreader), Georgia, serif",
                }}
              >
                You&apos;re viewing a preview
              </h2>
              <p className="text-[13px] text-[#6B6255] mt-1">
                Showing {index.length} spotlight categories with median only.
                The full index includes {gatedCount} more categories with
                P25/P75 percentiles, bank vs. credit union breakdowns, and range
                data.
              </p>
            </div>
            <Link
              href="/subscribe"
              className="mt-4 md:mt-0 inline-flex items-center gap-2 rounded-full bg-[#C44B2E] px-6 py-2.5 text-[13px] font-semibold text-white shadow-sm shadow-[#C44B2E]/15 hover:shadow-md hover:shadow-[#C44B2E]/25 transition-all flex-shrink-0 no-underline"
            >
              Unlock Full Index
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      )}

      {/* Index tables */}
      <div className="mt-8 space-y-8">
        {familyOrder.map((familyName) => {
          const entries = byFamily.get(familyName);
          if (!entries || entries.length === 0) return null;
          const colors = FAMILY_COLORS[familyName];

          return (
            <section key={familyName}>
              <h2
                className={`flex items-center gap-2 text-sm font-bold ${colors?.text ?? "text-[#5A5347]"}`}
              >
                <span
                  className={`inline-block h-3 w-1 rounded-full ${colors?.border?.replace("border-l-", "bg-") ?? "bg-[#A09788]"}`}
                />
                {familyName}
              </h2>
              <div className="mt-3 overflow-hidden rounded-xl border border-[#E8DFD1]/80">
                <div className="overflow-x-auto">
                  <table className={`w-full text-left text-sm ${isPro ? "min-w-[760px]" : "min-w-[420px]"}`}>
                    <thead>
                      <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
                        <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                          Fee Category
                        </th>
                        <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                          Median
                        </th>
                        {isPro && (
                          <>
                            <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] sm:table-cell">
                              P25
                            </th>
                            <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] sm:table-cell">
                              P75
                            </th>
                            <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                              Range
                            </th>
                            <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                              Banks
                            </th>
                            <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                              CUs
                            </th>
                            <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] md:table-cell">
                              Institutions
                            </th>
                          </>
                        )}
                        {!isPro && (
                          <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                            Institutions
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8DFD1]/60">
                      {entries.map((entry) => (
                        <tr
                          key={entry.fee_category}
                          className="hover:bg-[#FAF7F2]/60 transition-colors"
                        >
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/fees/${entry.fee_category}`}
                              className="font-medium text-[#1A1815] hover:text-[#C44B2E] transition-colors"
                            >
                              {getDisplayName(entry.fee_category)}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-[#1A1815]">
                            {formatAmount(entry.median_amount)}
                          </td>
                          {isPro && (
                            <>
                              <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] sm:table-cell">
                                {formatAmount(entry.p25_amount)}
                              </td>
                              <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] sm:table-cell">
                                {formatAmount(entry.p75_amount)}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                                {formatAmount(entry.min_amount)} &ndash;{" "}
                                {formatAmount(entry.max_amount)}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                                {entry.bank_count.toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                                {entry.cu_count.toLocaleString()}
                              </td>
                              <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] md:table-cell">
                                {entry.institution_count.toLocaleString()}
                              </td>
                            </>
                          )}
                          {!isPro && (
                            <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                              {entry.institution_count.toLocaleString()}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Bottom upgrade gate */}
      {!isPro && gatedCount > 0 && (
        <div className="mt-10">
          <UpgradeGate
            count={gatedCount}
            message="Unlock the complete National Fee Index"
          />
        </div>
      )}

      {/* Methodology */}
      <section className="mt-10 rounded-xl border border-[#E8DFD1] bg-[#FAF7F2]/50 px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B6255]">
          Methodology
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[#6B6255]">
          The National Fee Index is computed from published fee schedules of
          FDIC-insured banks and NCUA-insured credit unions. Fees are categorized
          into {TAXONOMY_COUNT} standard categories across 9 families. All
          statistics are based on verified, published fee schedules. National
          medians are computed across all reporting institutions for each fee
          category.
        </p>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: "National Fee Index - US Bank & Credit Union Fee Benchmarks",
            description: `National benchmarking data across ${TAXONOMY_COUNT} bank and credit union fee categories.`,
            url: `${SITE_URL}/research/national-fee-index`,
            creator: {
              "@type": "Organization",
              name: SITE_NAME,
            },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
