export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { getCpiContext } from "@/lib/data-store";
import { getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import {
  getDisplayName,
  FEE_FAMILIES,
  FAMILY_COLORS,
  TAXONOMY_COUNT,
  FEATURED_COUNT,
  getFeaturedCategories,
} from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DataFreshness } from "@/components/data-freshness";
import { LeadCapture } from "@/components/public/lead-capture";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";

import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";

export const metadata: Metadata = {
  title: "National Fee Index: Bank and Credit Union Fees",
  description:
    "Median bank and credit union fees by category, with percentiles and institution counts, from thousands of published fee schedules.",
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
  // Same snapshot as the fee index and research hub, so the medians match to the cent.
  const allIndex = await getPublicNationalIndex();
  const cpi = await getCpiContext();
  // The count of categories with published fees, the same figure the homepage, pricing and
  // institution pages show (not the taxonomy size, which includes categories with no data yet).
  const { categoriesLabel, refreshedOn } = await getPublicStatsSummary();
  const sampleLive = await sampleReportAvailable();

  // Pro: full index. Free: the 15 headline categories, the same set the free report shows.
  const headlineCats = new Set(getFeaturedCategories());
  const index = isPro
    ? allIndex
    : allIndex.filter((e) => headlineCats.has(e.fee_category));
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
    <div className="mx-auto max-w-page px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: "National Fee Index", href: "/research/national-fee-index" },
        ]}
      />

      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-brick/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brick/60">
          National Fee Index
        </span>
        {!isPro && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-border/50 text-ink-muted uppercase tracking-wider ml-1">
            Preview
          </span>
        )}
      </div>
      <h1
        className="mt-1 text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] font-extrabold text-ink"
        style={{ fontFamily: "var(--fi-font-sans)" }}
      >
        US Bank & Credit Union Fee Benchmarks
      </h1>
      <p className="mt-2 max-w-2xl text-[14px] text-ink-muted">
        {isPro ? (
          <>
            National benchmarking data across {categoriesLabel} fee categories,
            computed from published fee schedules of FDIC-insured banks and
            NCUA-insured credit unions.
          </>
        ) : (
          <>
            Preview of {index.length} headline fee categories from our full
            index of {categoriesLabel} categories.{" "}
            <Link
              href="/subscribe"
              className="text-brick hover:underline font-medium"
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
        eyebrow="National index updates"
        headline="Get the national fee index in your inbox"
        body="New national medians and one table worth bringing to a pricing meeting. No more than once a month."
        buttonLabel="Subscribe"
        secondaryLink={sampleLive ? { href: "/reports/sample-competitive-fee-position", label: "See the sample report" } : undefined}
      />

      {/* CPI context strip */}
      {cpi.bankFees && cpi.allItems && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-5 py-3 text-[13px]">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
            CPI Context
          </span>
          <span className="text-ink-soft">
            Bank service fees{" "}
            <span
              className={`font-semibold tabular-nums ${cpi.bankFees.yoyPct > 0 ? "text-red-600" : "text-emerald-600"}`}
            >
              {cpi.bankFees.yoyPct > 0 ? "+" : ""}
              {cpi.bankFees.yoyPct}%
            </span>{" "}
            YoY
          </span>
          <span className="text-ink-muted">vs.</span>
          <span className="text-ink-soft">
            Overall CPI{" "}
            <span className="font-semibold tabular-nums text-ink-soft">
              {cpi.allItems.yoyPct > 0 ? "+" : ""}
              {cpi.allItems.yoyPct}%
            </span>{" "}
            YoY
          </span>
          <span className="text-[11px] text-ink-muted">
            BLS as of {new Date(cpi.bankFees.date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
          </span>
        </div>
      )}

      {/* Summary cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            {isPro ? "Fee Categories" : "Preview"}
          </p>
          <p
            className="mt-1 text-lg font-semibold tabular-nums text-ink"
            style={{
              fontFamily: "var(--fi-font-mono)",
              fontWeight: 300,
            }}
          >
            {isPro
              ? allIndex.length
              : `${index.length} / ${allIndex.length}`}
          </p>
        </div>
        <div className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            Observations
          </p>
          <p
            className="mt-1 text-lg font-semibold tabular-nums text-ink"
            style={{
              fontFamily: "var(--fi-font-mono)",
              fontWeight: 300,
            }}
          >
            {totalObservations.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            Full Index
          </p>
          <p
            className="mt-1 text-lg font-semibold tabular-nums text-ink"
            style={{
              fontFamily: "var(--fi-font-mono)",
              fontWeight: 300,
            }}
          >
            {categoriesLabel} categories
          </p>
        </div>
        <div className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            Featured Fees
          </p>
          <p
            className="mt-1 text-lg font-semibold tabular-nums text-ink"
            style={{
              fontFamily: "var(--fi-font-mono)",
              fontWeight: 300,
            }}
          >
            {FEATURED_COUNT}
          </p>
        </div>
      </div>

      {/* Upgrade banner for free users */}
      {!isPro && (
        <div className="mt-8 rounded-xl border-2 border-brick/30 bg-white/70 backdrop-blur-sm p-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-brick/40 to-transparent" />
          <div className="md:flex md:items-center md:justify-between">
            <div>
              <h2
                className="text-[16px] font-bold text-ink"
                style={{
                  fontFamily: "var(--fi-font-sans)",
                }}
              >
                You&apos;re viewing a preview
              </h2>
              <p className="text-[13px] text-ink-muted mt-1">
                Showing {index.length} headline categories with median only.
                The full index includes {gatedCount} more categories with
                P25/P75 percentiles, bank vs. credit union breakdowns, and range
                data.
              </p>
            </div>
            <Link
              href="/subscribe"
              className="mt-4 md:mt-0 inline-flex items-center gap-2 rounded-full bg-brick px-6 py-2.5 text-[13px] font-semibold text-white shadow-sm shadow-[#b23a32]/15 hover:shadow-md hover:shadow-[#b23a32]/25 transition-all flex-shrink-0 no-underline"
            >
              Unlock Full Index
              <svg aria-hidden="true"
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
                className={`flex items-center gap-2 text-sm font-bold ${colors?.text ?? "text-ink-soft"}`}
              >
                <span
                  className={`inline-block h-3 w-1 rounded-full ${colors?.border?.replace("border-l-", "bg-") ?? "bg-control-border"}`}
                />
                {familyName}
              </h2>
              <div className="mt-3 overflow-hidden rounded-xl border border-border/80">
                <div className="overflow-x-auto">
                  <table className={`w-full text-left text-sm ${isPro ? "min-w-[760px]" : "min-w-[420px]"}`}>
                    <thead>
                      <tr className="border-b border-border/60 bg-paper/60">
                        <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                          Fee Category
                        </th>
                        <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                          Median
                        </th>
                        {isPro && (
                          <>
                            <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted sm:table-cell">
                              P25
                            </th>
                            <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted sm:table-cell">
                              P75
                            </th>
                            <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                              Range
                            </th>
                            <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                              Banks
                            </th>
                            <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                              CUs
                            </th>
                            <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted md:table-cell">
                              Institutions
                            </th>
                          </>
                        )}
                        {!isPro && (
                          <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                            Institutions
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {entries.map((entry) => (
                        <tr
                          key={entry.fee_category}
                          className="hover:bg-paper/60 transition-colors"
                        >
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/fees/${entry.fee_category}`}
                              className="font-medium text-ink hover:text-brick transition-colors"
                            >
                              {getDisplayName(entry.fee_category)}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                            {formatAmount(entry.median_amount)}
                          </td>
                          {isPro && (
                            <>
                              <td className="hidden px-4 py-2.5 text-right tabular-nums text-ink-muted sm:table-cell">
                                {formatAmount(entry.p25_amount)}
                              </td>
                              <td className="hidden px-4 py-2.5 text-right tabular-nums text-ink-muted sm:table-cell">
                                {formatAmount(entry.p75_amount)}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                                {formatAmount(entry.min_amount)} &ndash;{" "}
                                {formatAmount(entry.max_amount)}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                                {entry.bank_count.toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                                {entry.cu_count.toLocaleString()}
                              </td>
                              <td className="hidden px-4 py-2.5 text-right tabular-nums text-ink-muted md:table-cell">
                                {entry.institution_count.toLocaleString()}
                              </td>
                            </>
                          )}
                          {!isPro && (
                            <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
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
      <section className="mt-10 rounded-xl border border-border bg-paper/50 px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Methodology
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          The National Fee Index is computed from published fee schedules of
          FDIC-insured banks and NCUA-insured credit unions. Fees are categorized
          into {TAXONOMY_COUNT} standard categories across {Object.keys(FEE_FAMILIES).length} families. All
          statistics are based on published fee schedules. National
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
            description: `National benchmarking data across ${categoriesLabel} bank and credit union fee categories.`,
            url: `${SITE_URL}/research/national-fee-index`,
            creator: {
              "@type": "Organization",
              name: SITE_NAME,
            },
            publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
            // #1166 T11: the terms page states how the data may be used; there is no open license.
            license: `${SITE_URL}/terms`,
            dateModified: refreshedOn && !Number.isNaN(Date.parse(refreshedOn)) ? new Date(refreshedOn).toISOString() : undefined,
            variableMeasured: allIndex.map((entry) => getDisplayName(entry.fee_category)),
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
