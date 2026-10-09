export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DataFreshness } from "@/components/data-freshness";
import { SITE_URL } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";
import { getMarketConcentrationCached } from "@/lib/data-store/public-cached-reads";

export const metadata: Metadata = {
  title: "Market Concentration & Bank Fees - HHI Analysis by Metro Area",
  description:
    "Do banks charge higher fees in concentrated markets? Analysis of deposit market concentration (HHI) across U.S. metro areas using FDIC Summary of Deposits data.",
  keywords: [
    "bank market concentration",
    "HHI banking",
    "deposit market share",
    "bank competition fees",
    "FDIC summary of deposits",
  ],
};

function formatDeposits(thousands: number): string {
  if (thousands >= 1_000_000) return `$${(thousands / 1_000_000).toFixed(1)}B`;
  if (thousands >= 1_000) return `$${(thousands / 1_000).toFixed(1)}M`;
  return `$${thousands}K`;
}

function hhiLabel(hhi: number): { text: string; color: string } {
  if (hhi >= 2500) return { text: "Highly Concentrated", color: "text-red-600 bg-red-50" };
  if (hhi >= 1500) return { text: "Moderately Concentrated", color: "text-amber-700 bg-amber-50" };
  return { text: "Competitive", color: "text-emerald-700 bg-emerald-50" };
}

export default async function MarketConcentrationPage() {
  const user = await getCurrentUser();
  if (!canAccessPremium(user)) {
    return (
      <div className="max-w-3xl mx-auto py-16 px-4">
        <UpgradeGate
          message="Market concentration by metro"
          locked="Deposit market concentration (HHI) for U.S. metro areas from FDIC Summary of Deposits data: the most and least concentrated markets and the largest markets by deposits."
        />
      </div>
    );
  }

  const [mostConcentrated, leastConcentrated, largestMarkets] = await Promise.all([
    getMarketConcentrationCached({
      sort: "hhi_desc",
      limit: 30,
      minInstitutions: 5,
    }),
    getMarketConcentrationCached({
      sort: "hhi_asc",
      limit: 20,
      minInstitutions: 10,
    }),
    getMarketConcentrationCached({
      sort: "deposits_desc",
      limit: 20,
      minInstitutions: 5,
    }),
  ]);

  const totalMarkets = mostConcentrated.length + leastConcentrated.length;
  const highlyConcentrated = mostConcentrated.filter((m) => m.hhi >= 2500).length;
  const avgHhi = mostConcentrated.length > 0
    ? Math.round(
        mostConcentrated.reduce((s, m) => s + m.hhi, 0) / mostConcentrated.length
      )
    : 0;

  return (
    <div className="mx-auto max-w-page px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: "Market Concentration", href: "/research/market-concentration" },
        ]}
      />

      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-[#C44B2E]/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
          Original Research
        </span>
      </div>
      <h1
        className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] font-bold text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Market Concentration & Bank Fees
      </h1>
      <p className="mt-2 max-w-2xl text-[14px] text-[#6B6255]">
        Do banks charge higher fees in markets with less competition? This
        analysis measures deposit market concentration (HHI) across U.S. metro
        areas using FDIC Summary of Deposits data, identifying the most and
        least competitive banking markets.
      </p>
      <div className="mt-1">
        <DataFreshness />
      </div>

      {/* Summary cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
            Metro Areas Analyzed
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-[#1A1815]">
            {totalMarkets > 0 ? totalMarkets.toLocaleString() : "Run ingest-sod first"}
          </p>
        </div>
        <div className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
            Highly Concentrated
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-[#1A1815]">
            {highlyConcentrated}
            <span className="ml-1 text-xs font-normal text-[#6B6255]">
              HHI &ge; 2,500
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
            Avg HHI (Top 30)
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-[#1A1815]">
            {avgHhi.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Most Concentrated Markets */}
      {mostConcentrated.length > 0 && (
        <section className="mt-8">
          <h2
            className="text-sm font-bold text-[#1A1815]"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            Most Concentrated Banking Markets
          </h2>
          <p className="mt-1 text-[13px] text-[#6B6255]">
            Metro areas with the highest HHI scores, indicating fewer competitors
            and greater deposit market power. DOJ considers HHI above 2,500 as
            highly concentrated.
          </p>

          <div className="mt-3 overflow-hidden rounded-xl border border-[#E8DFD1]/80">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
                  <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Metro Area
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    HHI
                  </th>
                  <th className="hidden px-4 py-2 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] sm:table-cell">
                    Classification
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Banks
                  </th>
                  <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] sm:table-cell">
                    Top 3 Share
                  </th>
                  <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] md:table-cell">
                    Total Deposits
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD1]/60">
                {mostConcentrated.map((row) => {
                  const label = hhiLabel(row.hhi);
                  return (
                    <tr
                      key={row.msa_code}
                      className="hover:bg-[#FAF7F2]/60 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium text-[#1A1815]">
                        {row.msa_name || `MSA ${row.msa_code}`}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1815]">
                        {row.hhi.toLocaleString()}
                      </td>
                      <td className="hidden px-4 py-2.5 text-center sm:table-cell">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${label.color}`}
                        >
                          {label.text}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
                        {row.institution_count}
                      </td>
                      <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] sm:table-cell">
                        {row.top3_share.toFixed(0)}%
                      </td>
                      <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] md:table-cell">
                        {formatDeposits(row.total_deposits)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Most Competitive Markets */}
      {leastConcentrated.length > 0 && (
        <section className="mt-8">
          <h2
            className="text-sm font-bold text-[#1A1815]"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            Most Competitive Banking Markets
          </h2>
          <p className="mt-1 text-[13px] text-[#6B6255]">
            Metro areas with the lowest HHI, indicating strong competition among
            many deposit-taking institutions.
          </p>

          <div className="mt-3 overflow-hidden rounded-xl border border-[#E8DFD1]/80">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
                  <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Metro Area
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    HHI
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Banks
                  </th>
                  <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] sm:table-cell">
                    Top 3 Share
                  </th>
                  <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] md:table-cell">
                    Total Deposits
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD1]/60">
                {leastConcentrated.map((row) => (
                  <tr
                    key={row.msa_code}
                    className="hover:bg-[#FAF7F2]/60 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-medium text-[#1A1815]">
                      {row.msa_name || `MSA ${row.msa_code}`}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">
                      {row.hhi.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
                      {row.institution_count}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] sm:table-cell">
                      {row.top3_share.toFixed(0)}%
                    </td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] md:table-cell">
                      {formatDeposits(row.total_deposits)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Largest Markets by Deposits */}
      {largestMarkets.length > 0 && (
        <section className="mt-8">
          <h2
            className="text-sm font-bold text-[#1A1815]"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            Largest Banking Markets by Deposits
          </h2>
          <p className="mt-1 text-[13px] text-[#6B6255]">
            The biggest U.S. metro areas ranked by total deposit volume, with
            concentration metrics.
          </p>

          <div className="mt-3 overflow-hidden rounded-xl border border-[#E8DFD1]/80">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
                  <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Metro Area
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Total Deposits
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Banks
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    HHI
                  </th>
                  <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] sm:table-cell">
                    Top 3 Share
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD1]/60">
                {largestMarkets.map((row) => {
                  const label = hhiLabel(row.hhi);
                  return (
                    <tr
                      key={row.msa_code}
                      className="hover:bg-[#FAF7F2]/60 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium text-[#1A1815]">
                        {row.msa_name || `MSA ${row.msa_code}`}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-[#1A1815]">
                        {formatDeposits(row.total_deposits)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
                        {row.institution_count}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
                        <span className={label.color.split(" ")[0]}>
                          {row.hhi.toLocaleString()}
                        </span>
                      </td>
                      <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] sm:table-cell">
                        {row.top3_share.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Empty state */}
      {mostConcentrated.length === 0 && (
        <div className="mt-8 rounded-xl border border-[#E8DFD1] bg-[#FAF7F2]/50 px-6 py-10 text-center">
          <p className="text-sm font-medium text-[#5A5347]">
            No market concentration data available yet.
          </p>
          <p className="mt-1 text-[13px] text-[#6B6255]">
            Start the Atlas data refresh from the admin console to populate branch deposit
            data and compute market HHI.
          </p>
        </div>
      )}

      {/* Methodology */}
      <section className="mt-10 rounded-xl border border-[#E8DFD1] bg-[#FAF7F2]/50 px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B6255]">
          Methodology
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[#6B6255]">
          Market concentration is measured using the Herfindahl-Hirschman Index
          (HHI), computed from FDIC Summary of Deposits (SOD) branch-level
          deposit data. HHI is the sum of squared deposit market shares for
          each institution within a Metropolitan Statistical Area (MSA). The
          DOJ considers markets with HHI below 1,500 as competitive, 1,500 to
          2,500 as moderately concentrated, and above 2,500 as highly
          concentrated. Only MSAs with 5+ deposit-taking institutions are
          included.
        </p>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ScholarlyArticle",
            headline: "Market Concentration & Bank Fees: HHI Analysis",
            description: "Analysis of deposit market concentration across U.S. metro areas using FDIC Summary of Deposits data.",
            url: `${SITE_URL}/research/market-concentration`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
