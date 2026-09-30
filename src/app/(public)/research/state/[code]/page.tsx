export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getNationalIndexCached,
  getPeerIndex,
  getStateStats,
} from "@/lib/data-store";
import {
  getDisplayName,
  isFeaturedFee,
} from "@/lib/fee-taxonomy";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { formatAmount } from "@/lib/format";
import { STATE_NAMES, STATE_CODES } from "@/lib/us-states";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DataFreshness } from "@/components/data-freshness";
import { LeadCapture } from "@/components/public/lead-capture";
import { REPORT_OFFER, SITE_URL } from "@/lib/constants";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateStaticParams() {
  const { hasData } = await import("@/lib/data-store/connection");
  if (!(await hasData())) return [];
  return STATE_CODES.map((code) => ({ code }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const name = STATE_NAMES[code.toUpperCase()];
  if (!name) return { title: "State Not Found" };

  return {
    title: `${name} Bank Fees - State Fee Report`,
    description: `Compare bank and credit union fees in ${name}. Median fees, state vs. national benchmarks, charter type comparisons, and institution-level data.`,
    keywords: [
      `${name} bank fees`,
      `${name} overdraft fees`,
      `${name} credit union fees`,
      `bank fees by state`,
      `${name} ATM fees`,
    ],
  };
}

function DeltaPill({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.5) {
    return <span className="text-[11px] text-[#6B6255]">-</span>;
  }
  const isBelow = delta < 0;
  return (
    <span
      className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        isBelow
          ? "bg-emerald-50 text-emerald-600"
          : "bg-red-50 text-red-600"
      }`}
    >
      {isBelow ? "" : "+"}{delta.toFixed(1)}%
    </span>
  );
}

export default async function StateReportPage({ params }: PageProps) {
  const { code } = await params;
  const stateCode = code.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  if (!stateName) notFound();

  const user = await getCurrentUser();
  const showAllCategories = canAccessAllCategories(user);

  const stats = await getStateStats(stateCode);
  const stateIndex = await getPeerIndex({ state_code: stateCode });
  const nationalIndex = await getNationalIndexCached();
  const district = STATE_TO_DISTRICT[stateCode];

  // Build national lookup
  const nationalMap = new Map(
    nationalIndex.map((e) => [e.fee_category, e])
  );

  // Build comparison data: state vs national with deltas
  const comparisons = stateIndex
    .filter((e) => e.median_amount !== null && e.institution_count >= 3)
    .map((entry) => {
      const national = nationalMap.get(entry.fee_category);
      const nationalMedian = national?.median_amount ?? null;
      const delta =
        nationalMedian && entry.median_amount
          ? ((entry.median_amount - nationalMedian) / nationalMedian) * 100
          : null;
      return { ...entry, nationalMedian, delta };
    })
    .sort((a, b) => b.institution_count - a.institution_count);

  const featured = comparisons.filter((c) => isFeaturedFee(c.fee_category));
  const extended = comparisons.filter((c) => !isFeaturedFee(c.fee_category));

  return (
    <div className="mx-auto max-w-7xl px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: stateName, href: `/research/state/${stateCode}` },
        ]}
      />

      {/* Breadcrumb — sticky on mobile */}
      <nav className="flex items-center gap-2 text-[12px] text-[#6B6255] mb-4 sticky top-14 z-30 -mx-6 px-6 py-2 bg-[#FAF7F2]/95 backdrop-blur-sm sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none">
        <Link href="/" className="hover:text-[#1A1815] transition-colors">Home</Link>
        <span className="text-[#D4C9BA]">/</span>
        <Link href="/research" className="hover:text-[#1A1815] transition-colors">Research</Link>
        <span className="text-[#D4C9BA]">/</span>
        <span className="text-[#5A5347]">{stateName}</span>
      </nav>

      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-[#C44B2E]/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
          State Fee Report
        </span>
      </div>
      <h1 className="mt-1 font-[Newsreader] text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815]">
        {stateName} Bank & Credit Union Fees
      </h1>
      <p className="mt-2 max-w-2xl text-[14px] text-[#6B6255]">
        Fee benchmarks for {stats.institution_count.toLocaleString()} financial
        institutions in {stateName}, compared against national medians.
        {district && (
          <>
            {" "}Part of{" "}
            <Link
              href={`/research/district/${district}`}
              className="text-[#C44B2E] hover:underline"
            >
              Federal Reserve District {district} ({DISTRICT_NAMES[district]})
            </Link>
            .
          </>
        )}
      </p>
      <div className="mt-1">
        <DataFreshness />
      </div>

      <LeadCapture
        placement="state_benchmark"
        className="mt-5"
        stateCode={stateCode}
        eyebrow="Free benchmark"
        headline={`Get the free ${stateName} fee benchmark`}
        body={`${stateName} medians against national, sent each time the state index refreshes — plus a link to the sample ${REPORT_OFFER.name}.`}
        buttonLabel="Send it to me"
        secondaryLink={{ href: "/reports/sample-competitive-fee-position", label: "See the sample report" }}
      />

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Institutions", value: stats.institution_count.toLocaleString() },
          { label: "With Fee Data", value: stats.with_fees.toLocaleString() },
          { label: "Banks", value: stats.bank_count.toLocaleString() },
          { label: "Credit Unions", value: stats.cu_count.toLocaleString() },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-4 py-3"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
              {card.label}
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums text-[#1A1815]">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Charter breakdown */}
      {stateIndex.length > 0 && (
        <section className="mt-8">
          <h2 className="font-[Newsreader] text-sm font-bold text-[#1A1815]">
            Bank vs. Credit Union — {stateName}
          </h2>
          <p className="mt-1 text-[13px] text-[#6B6255]">
            How fees compare between banks and credit unions in this state.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-[#E8DFD1]/80">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
                  <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Charter
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Institutions
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Fee Observations
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD1]/60">
                <tr className="hover:bg-[#FAF7F2]/60 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-[#1A1815]">Banks</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
                    {stats.bank_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                    {stateIndex.reduce((sum, e) => sum + e.bank_count, 0).toLocaleString()}
                  </td>
                </tr>
                <tr className="hover:bg-[#FAF7F2]/60 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-[#1A1815]">Credit Unions</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
                    {stats.cu_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                    {stateIndex.reduce((sum, e) => sum + e.cu_count, 0).toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </section>
      )}

      {/* Fee comparison table */}
      {comparisons.length > 0 && (
        <section className="mt-8">
          <h2 className="font-[Newsreader] text-sm font-bold text-[#1A1815]">
            Fee Benchmarks — {stateName} vs. National
          </h2>
          <p className="mt-1 text-[13px] text-[#6B6255]">
            {comparisons.length} fee categories with sufficient data.
            Green deltas indicate below-national fees; red indicates above.
          </p>

          <div className="mt-3 overflow-hidden rounded-xl border border-[#E8DFD1]/80">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
                  <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Fee Category
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    {stateName} Median
                  </th>
                  <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] sm:table-cell">
                    National Median
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Delta
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Institutions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD1]/60">
                {featured.map((row) => (
                  <tr
                    key={row.fee_category}
                    className="hover:bg-[#FAF7F2]/60 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/fees/${row.fee_category}`}
                        className="font-medium text-[#1A1815] hover:text-[#C44B2E] transition-colors"
                      >
                        {getDisplayName(row.fee_category)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-[#1A1815]">
                      {formatAmount(row.median_amount)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] sm:table-cell">
                      {formatAmount(row.nationalMedian)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {row.delta !== null ? (
                        <DeltaPill delta={row.delta} />
                      ) : (
                        <span className="text-[11px] text-[#6B6255]">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                      {row.institution_count.toLocaleString()}
                    </td>
                  </tr>
                ))}

                {extended.length > 0 && showAllCategories && (
                  <>
                    <tr>
                      <td
                        colSpan={5}
                        className="bg-[#FAF7F2]/60 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]"
                      >
                        Extended Categories
                      </td>
                    </tr>
                    {extended.map((row) => (
                      <tr
                        key={row.fee_category}
                        className="hover:bg-[#FAF7F2]/60 transition-colors"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/fees/${row.fee_category}`}
                            className="text-[#5A5347] hover:text-[#C44B2E] transition-colors"
                          >
                            {getDisplayName(row.fee_category)}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
                          {formatAmount(row.median_amount)}
                        </td>
                        <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] sm:table-cell">
                          {formatAmount(row.nationalMedian)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {row.delta !== null ? (
                            <DeltaPill delta={row.delta} />
                          ) : (
                            <span className="text-[11px] text-[#6B6255]">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                          {row.institution_count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </section>
      )}

      {/* Upgrade gate for free users */}
      {!showAllCategories && extended.length > 0 && (
        <div className="mt-6">
          <UpgradeGate count={extended.length} message={`${extended.length} more fee categories for ${stateName}`} />
        </div>
      )}

      {/* Methodology */}
      <section className="mt-10 rounded-xl border border-[#E8DFD1] bg-[#FAF7F2]/50 px-5 py-4">
        <h2 className="font-[Newsreader] text-xs font-semibold uppercase tracking-wider text-[#6B6255]">
          Methodology
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[#6B6255]">
          Data sourced from published fee schedules of FDIC-insured banks and
          NCUA-insured credit unions in {stateName}. Medians computed from
          extracted fee amounts excluding rejected reviews. Delta shows
          percentage difference from the national median. Institutions with
          fewer than 3 observations per category are excluded from state-level
          reporting.
        </p>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `${stateName} Bank & Credit Union Fees`,
            description: `Fee benchmarks for financial institutions in ${stateName}.`,
            url: `${SITE_URL}/research/state/${stateCode}`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
