export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { linkPreview } from "@/lib/link-preview";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getBeigeBookHeadline,
  getLatestBeigeBook,
} from "@/lib/data-store";
import { getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import {
  getDisplayName,
  isFeaturedFee,
} from "@/lib/fee-taxonomy";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { getCurrentUser } from "@/lib/auth";
import { canAccessFullDistrict } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";
import { formatAmount } from "@/lib/format";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DataFreshness } from "@/components/data-freshness";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { getPeerIndexCached, getDistrictStatsCached } from "@/lib/data-store/public-cached-reads";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const districtId = parseInt(id, 10);
  const name = DISTRICT_NAMES[districtId];
  if (!name) notFound();

  const title = `${name} Fed District ${districtId} Fee Analysis`;
  const description = `Bank and credit union fees in the ${name} Fed district (District ${districtId}) against national benchmarks, with economic context from the Beige Book.`;
  return {
    title,
    description,
    ...linkPreview({ title, description, path: `/research/district/${districtId}` }),
    keywords: [
      `Federal Reserve District ${districtId}`,
      `${name} bank fees`,
      `Fed district fee analysis`,
      `banking fees ${name}`,
    ],
  };
}

function DeltaPill({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.5) {
    return <span className="text-[11px] text-ink-muted">-</span>;
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

export default async function DistrictReportPage({ params }: PageProps) {
  const { id } = await params;
  const districtId = parseInt(id, 10);
  if (districtId < 1 || districtId > 12 || isNaN(districtId)) notFound();

  const districtName = DISTRICT_NAMES[districtId];
  if (!districtName) notFound();

  const user = await getCurrentUser();
  const showFullDistrict = canAccessFullDistrict(user);

  const [stats, districtIndex, nationalIndex, beigeHeadline, beigeSections, summary] = await Promise.all([
    getDistrictStatsCached(districtId),
    getPeerIndexCached({ fed_districts: [districtId] }),
    getPublicNationalIndex(),
    getBeigeBookHeadline(districtId),
    getLatestBeigeBook(districtId),
    getPublicStatsSummary(),
  ]);
  const asOf = summary.refreshedOn;

  // States in this district
  const districtStates = Object.entries(STATE_TO_DISTRICT)
    .filter(([, d]) => d === districtId)
    .map(([code]) => code)
    .filter((code) => STATE_NAMES[code])
    .sort();

  // Build national lookup
  const nationalMap = new Map(
    nationalIndex.map((e) => [e.fee_category, e])
  );

  // Build comparison data
  const comparisons = districtIndex
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

  // Summary stats
  const aboveNational = comparisons.filter((c) => c.delta !== null && c.delta > 2).length;
  const belowNational = comparisons.filter((c) => c.delta !== null && c.delta < -2).length;

  return (
    <div className="mx-auto max-w-page px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: `District ${districtId}`, href: `/research/district/${districtId}` },
        ]}
      />

      {/* Breadcrumb — sticky on mobile */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-ink-muted mb-4 sticky top-14 z-30 -mx-6 px-6 py-2 bg-paper/95 backdrop-blur-sm sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none">
        <Link href="/" className="hover:text-ink transition-colors">Home</Link>
        <span className="text-border">/</span>
        <Link href="/research" className="hover:text-ink transition-colors">Research</Link>
        <span className="text-border">/</span>
        <span className="text-ink-soft">{districtName}</span>
      </nav>

      <p className="text-[11px] font-semibold uppercase tracking-wider text-brick">
        Federal Reserve District {districtId}
      </p>
      <h1 className="mt-1 text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-ink">
        {districtName} District Fee Analysis
      </h1>
      <p className="mt-2 max-w-2xl text-[14px] text-ink-muted">
        Fee benchmarks for {stats.institution_count.toLocaleString()} financial
        institutions across{" "}
        {districtStates.length} state{districtStates.length !== 1 ? "s" : ""}.
        {aboveNational > 0 && belowNational > 0 && (
          <> This district has {belowNational} fee categories below the
          national median and {aboveNational} above.</>
        )}
      </p>
      <div className="mt-1">
        <DataFreshness />
      </div>

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
            className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-4 py-3"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              {card.label}
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums text-ink">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* States in district */}
      <section className="mt-8">
        <h2 className="text-sm font-bold text-ink">
          States in This District
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {districtStates.map((code) => (
            <Link
              key={code}
              href={`/research/state/${code}`}
              className="rounded-full border border-border px-3.5 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:border-brick/30 hover:text-brick"
            >
              {STATE_NAMES[code]}
            </Link>
          ))}
        </div>
      </section>

      {/* Beige Book Context -- premium only */}
      {!showFullDistrict && beigeHeadline && (
        <div className="mt-8">
          <UpgradeGate
            message={`${districtName} Beige Book context`}
            locked={`The summary of economic activity from the latest ${districtName} Fed Beige Book, shown next to this district's fee benchmarks.`}
          />
        </div>
      )}
      {showFullDistrict && beigeHeadline && (
        <section className="mt-8">
          <h2 className="text-sm font-bold text-ink">
            Economic Context — Beige Book
          </h2>
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/30 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">
              Latest Release — {beigeHeadline.release_date}
            </p>
            {beigeSections
              .filter((s) => s.section_name === "Summary of Economic Activity")
              .map((section) => (
                <p
                  key={section.id}
                  className="mt-2 text-[13px] leading-relaxed text-ink-soft"
                >
                  {section.content_text.length > 600
                    ? section.content_text.slice(0, 597) + "..."
                    : section.content_text}
                </p>
              ))}
          </div>
        </section>
      )}

      {/* Fee comparison table */}
      {comparisons.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold text-ink">
            Fee Benchmarks — District {districtId} vs. National
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {comparisons.length} fee categories with sufficient data.
          </p>

          <div className="mt-3 overflow-hidden rounded-xl border border-border/80">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-paper/60">
                  <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Fee Category
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    District Median
                  </th>
                  <th className="hidden px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted sm:table-cell">
                    National Median
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Delta
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    Banks
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                    CUs
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {featured.map((row) => (
                  <tr
                    key={row.fee_category}
                    className="hover:bg-paper/60 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/fees/${row.fee_category}`}
                        className="font-medium text-ink hover:text-brick transition-colors"
                      >
                        {getDisplayName(row.fee_category)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                      {formatAmount(row.median_amount)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums text-ink-muted sm:table-cell">
                      {formatAmount(row.nationalMedian)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {row.delta !== null ? (
                        <DeltaPill delta={row.delta} />
                      ) : (
                        <span className="text-[11px] text-ink-muted">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                      {row.bank_count}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                      {row.cu_count}
                    </td>
                  </tr>
                ))}

                {extended.length > 0 && (
                  <>
                    <tr>
                      <td
                        colSpan={6}
                        className="bg-paper/60 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted"
                      >
                        Extended Categories
                      </td>
                    </tr>
                    {extended.map((row) => (
                      <tr
                        key={row.fee_category}
                        className="hover:bg-paper/60 transition-colors"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/fees/${row.fee_category}`}
                            className="text-ink-soft hover:text-brick transition-colors"
                          >
                            {getDisplayName(row.fee_category)}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                          {formatAmount(row.median_amount)}
                        </td>
                        <td className="hidden px-4 py-2.5 text-right tabular-nums text-ink-muted sm:table-cell">
                          {formatAmount(row.nationalMedian)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {row.delta !== null ? (
                            <DeltaPill delta={row.delta} />
                          ) : (
                            <span className="text-[11px] text-ink-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                          {row.bank_count}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                          {row.cu_count}
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

      {/* Methodology */}
      <section className="mt-10 rounded-xl border border-border bg-paper/50 px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Methodology
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          Data sourced from published fee schedules of FDIC-insured banks and
          NCUA-insured credit unions in Federal Reserve District {districtId} ({districtName}).
          Medians computed from extracted fee amounts excluding rejected reviews.
          Economic context from the Federal Reserve Beige Book. Delta shows
          percentage difference from the national median.
        </p>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `${districtName} District Fee Analysis`,
            description: `Bank and credit union fee analysis for Federal Reserve District ${districtId}.`,
            url: `${SITE_URL}/research/district/${districtId}`,
            dateModified: asOf && !Number.isNaN(Date.parse(asOf)) ? new Date(asOf).toISOString() : undefined,
            publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
