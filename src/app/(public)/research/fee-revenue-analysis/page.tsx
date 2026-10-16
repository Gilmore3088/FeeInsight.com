export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { FDIC_TIER_LABELS } from "@/lib/fed-districts";
import { formatAmount, formatAssets } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DataFreshness } from "@/components/data-freshness";
import { PAGE_HEADER } from "@/components/public/page-header";
import { SITE_URL } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";
import { getFeeRevenueDataCached, getTierFeeRevenueSummaryCached, getCharterFeeRevenueSummaryCached } from "@/lib/data-store/public-cached-reads";

export const metadata: Metadata = {
  // Signed-out visitors, crawlers included, see only the upgrade gate: keep it out of the index.
  robots: { index: false, follow: true },
  title: "Fee-to-Revenue Analysis - How Bank Fees Drive Income",
  description:
    "Original research correlating bank and credit union fee schedules with service charge income from call reports. Analysis by asset tier and charter type.",
  keywords: [
    "bank fee revenue",
    "service charge income",
    "bank fee analysis",
    "credit union fees vs banks",
    "bank fee income ratio",
  ],
};

export default async function FeeRevenueAnalysisPage() {
  const user = await getCurrentUser();
  if (!canAccessPremium(user)) {
    return (
      <div className="max-w-3xl mx-auto py-16 px-4">
        <UpgradeGate
          message="Fee-to-revenue analysis"
          locked="How published fee schedules line up with service-charge income from call reports, broken out by asset tier and charter type."
        />
      </div>
    );
  }
  const [correlations, tierSummary, charterSummary] = await Promise.all([
    getFeeRevenueDataCached(),
    getTierFeeRevenueSummaryCached(),
    getCharterFeeRevenueSummaryCached(),
  ]);

  const totalInstitutions = correlations.length;
  const avgFee = totalInstitutions > 0
    ? correlations.reduce((sum, c) => sum + c.avg_fee, 0) / totalInstitutions
    : 0;
  const avgServiceCharge = totalInstitutions > 0
    ? correlations.reduce((sum, c) => sum + (c.service_charge_income ?? 0), 0) / totalInstitutions
    : 0;

  return (
    <div className="mx-auto max-w-page px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: "Fee-Revenue Analysis", href: "/research/fee-revenue-analysis" },
        ]}
      />

      <header className={PAGE_HEADER}>
        <div className="flex items-center justify-center gap-2 mb-4 sm:justify-start">
          <span className="h-px w-8 bg-brick/40" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brick/60">
            Original Research
          </span>
        </div>
        <h1
          className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] font-extrabold text-ink"
          style={{ fontFamily: "var(--fi-font-sans)" }}
        >
          Fee-to-Revenue Analysis
        </h1>
        <p className="mx-auto mt-2 max-w-[34rem] text-[14px] text-ink-muted sm:mx-0 sm:max-w-2xl">
          How do published fee schedules correlate with actual service charge
          income reported in call reports? This analysis cross-references
          extracted fees with FDIC and NCUA financial data to reveal the
          relationship between fee pricing and revenue.
        </p>
        <div className="mt-1">
          <DataFreshness />
        </div>
      </header>

      {/* Summary cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
            Institutions Analyzed
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-ink">
            {totalInstitutions.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
            Avg Fee Amount
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-ink">
            {formatAmount(avgFee)}
          </p>
        </div>
        <div className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
            Avg Service Charge Income
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-ink">
            {formatAssets(avgServiceCharge)}
          </p>
        </div>
      </div>

      {/* Charter Type Comparison */}
      {charterSummary.length > 0 && (
        <section className="mt-8">
          <h2
            className="text-sm font-bold text-ink"
            style={{ fontFamily: "var(--fi-font-sans)" }}
          >
            Banks vs. Credit Unions — Fee Revenue
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            How fee pricing and fee-related revenue differ between banks and
            credit unions.
          </p>

          <div className="mt-3 overflow-hidden rounded-xl border border-border/80">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-paper/60">
                  <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Charter Type
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Institutions
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Avg Fee
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Avg Service Charges
                  </th>
                  <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted sm:table-cell">
                    Fee/Assets (bps)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {charterSummary.map((row) => (
                  <tr
                    key={row.charter_type}
                    className="hover:bg-paper/60 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-medium text-ink">
                      {row.charter_type === "bank" ? "Banks" : "Credit Unions"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                      {row.institution_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                      {formatAmount(row.avg_fee_amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                      {formatAssets(row.avg_service_charge_income)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums text-ink-muted sm:table-cell">
                      {row.avg_fee_income_ratio?.toFixed(1) ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* By Asset Tier */}
      {tierSummary.length > 0 && (
        <section className="mt-8">
          <h2
            className="text-sm font-bold text-ink"
            style={{ fontFamily: "var(--fi-font-sans)" }}
          >
            Fee Revenue by Asset Tier
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Do larger institutions charge higher fees? How does fee-to-asset
            ratio vary by size?
          </p>

          <div className="mt-3 overflow-hidden rounded-xl border border-border/80">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-paper/60">
                  <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Asset Tier
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Institutions
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Avg Fee
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Avg Service Charges
                  </th>
                  <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted sm:table-cell">
                    Fee/Assets (bps)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {tierSummary.map((row) => (
                  <tr
                    key={row.asset_size_tier}
                    className="hover:bg-paper/60 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-medium text-ink">
                      {FDIC_TIER_LABELS[row.asset_size_tier] ?? row.asset_size_tier}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                      {row.institution_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                      {formatAmount(row.avg_fee_amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                      {formatAssets(row.avg_service_charge_income)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums text-ink-muted sm:table-cell">
                      {row.avg_fee_income_ratio?.toFixed(1) ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Top institutions by fee-income ratio */}
      <section className="mt-8">
        <h2
          className="text-sm font-bold text-ink"
          style={{ fontFamily: "var(--fi-font-sans)" }}
        >
          Institutions — Fee Pricing vs. Service Charge Income
        </h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Showing {Math.min(correlations.length, 50)} institutions with the
          highest fee-to-asset ratios (basis points of service charge income
          relative to total assets).
        </p>

        <div className="mt-3 overflow-hidden rounded-xl border border-border/80">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-paper/60">
                <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                  Institution
                </th>
                <th className="hidden px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted sm:table-cell">
                  Type
                </th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                  Avg Fee
                </th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                  Service Charges
                </th>
                <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted md:table-cell">
                  Total Assets
                </th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                  Ratio (bps)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {correlations
                .filter((c) => c.fee_income_ratio !== null)
                .sort((a, b) => (b.fee_income_ratio ?? 0) - (a.fee_income_ratio ?? 0))
                .slice(0, 50)
                .map((row) => (
                  <tr
                    key={row.institution_id}
                    className="hover:bg-paper/60 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/institution/${row.institution_id}`}
                        className="font-medium text-ink hover:text-brick transition-colors"
                      >
                        {row.institution_name}
                      </Link>
                      <span className="ml-1 text-[11px] text-ink-muted">
                        {row.state_code}
                      </span>
                    </td>
                    <td className="hidden px-4 py-2.5 text-ink-muted sm:table-cell">
                      {row.charter_type === "bank" ? "Bank" : "CU"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                      {formatAmount(row.avg_fee)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                      {formatAssets(row.service_charge_income)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums text-ink-muted md:table-cell">
                      {row.total_assets ? formatAssets(row.total_assets) : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                      {row.fee_income_ratio?.toFixed(1) ?? "-"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Methodology */}
      <section className="mt-10 rounded-xl border border-border bg-paper/50 px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Methodology
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          This analysis cross-references extracted fee schedule data with
          financial data from FDIC Call Reports and NCUA 5300 Reports.
          &ldquo;Avg Fee&rdquo; is the mean of all extracted fee amounts for
          each institution. &ldquo;Service Charges&rdquo; is the most recent
          quarterly service charge income from call reports.
          &ldquo;Fee/Assets&rdquo; ratio is service charge income divided by
          total assets, expressed in basis points (bps). Only institutions
          with 3+ extracted fees and matching financial data are included.
        </p>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ScholarlyArticle",
            headline: "Fee-to-Revenue Analysis: How Bank Fees Drive Income",
            description: "Original research correlating bank fee schedules with service charge income from call reports.",
            url: `${SITE_URL}/research/fee-revenue-analysis`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
