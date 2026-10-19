export const dynamic = "force-dynamic";
import { Suspense } from "react";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import {
  getLatestBeigeBook,
  getDistrictContent,
  getDistrictIndicators,
  getDistrictMetrics,
} from "@/lib/data-store";
import { getDistrictEconomicSummary, getBeigeBookThemes } from "@/lib/data-store/fed";
import { getDistrictFeeRevenue } from "@/lib/data-store/call-reports";
import { getDistrictComplaintSummary } from "@/lib/data-store/complaints";
import { getDistrictFeeMedians } from "@/lib/data-store/fee-index";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { timeAgo, formatAmount } from "@/lib/format";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { DistrictTabs } from "./district-tabs";

export default async function DistrictDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth("operate");
  const { id } = await params;
  const districtId = parseInt(id, 10);

  if (isNaN(districtId) || districtId < 1 || districtId > 12) {
    return <p className="text-gray-500">Invalid district number.</p>;
  }

  return (
    <Suspense fallback={null}>
      <DistrictDetailContent districtId={districtId} />
    </Suspense>
  );
}

async function DistrictDetailContent({ districtId }: { districtId: number }) {
  const districtName = DISTRICT_NAMES[districtId] ?? `District ${districtId}`;
  const [beigeBook, content, indicators, metrics, econSummary, feeRevenue, complaints, themes, feeMedians] = await Promise.all([
    getLatestBeigeBook(districtId),
    getDistrictContent(districtId, 15),
    getDistrictIndicators(districtId),
    getDistrictMetrics(),
    getDistrictEconomicSummary(districtId).catch(() => null),
    getDistrictFeeRevenue(districtId).catch(() => null),
    getDistrictComplaintSummary(districtId).catch(() => null),
    getBeigeBookThemes().catch(() => []),
    getDistrictFeeMedians(districtId).catch(() => []),
  ]);
  const districtMetric = metrics.find((m) => m.district === districtId);
  const districtThemes = themes.filter((t: { fed_district: number }) => t.fed_district === districtId);

  const summary = beigeBook.find(
    (s) => s.section_name === "Summary of Economic Activity"
  );
  const otherSections = beigeBook.filter(
    (s) => s.section_name !== "Summary of Economic Activity"
  );

  const indicatorsBySeries = new Map<
    string,
    { title: string; units: string; points: { date: string; value: number }[] }
  >();
  for (const ind of indicators) {
    if (!indicatorsBySeries.has(ind.series_id)) {
      indicatorsBySeries.set(ind.series_id, {
        title: ind.series_title ?? ind.series_id,
        units: ind.units ?? "",
        points: [],
      });
    }
    if (ind.value !== null) {
      indicatorsBySeries.get(ind.series_id)!.points.push({
        date: ind.observation_date,
        value: ind.value,
      });
    }
  }

  return (
    <>
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/admin" },
            { label: "Districts", href: "/admin/districts" },
            { label: `${districtId} - ${districtName}` },
          ]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          District {districtId} &mdash; {districtName}
        </h1>
        {districtMetric && (
          <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 tabular-nums">
            <span>
              {districtMetric.institution_count.toLocaleString()} institutions
            </span>
            <span>
              {(districtMetric.fee_url_pct * 100).toFixed(0)}% fee URL coverage
            </span>
            <span>
              {districtMetric.total_fees.toLocaleString()} fees extracted
            </span>
          </div>
        )}
      </div>

      <DistrictTabs>
        {{
          economy: (
            <div className="space-y-6">
              {/* Economic Summary */}
              {(econSummary || feeRevenue) && (
                <div className="rounded-lg border bg-white dark:bg-white/[0.02]">
                  <div className="px-5 py-3 border-b bg-gray-50/80 dark:bg-white/[0.03]">
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                      District Economic Summary
                    </h2>
                  </div>
                  <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {econSummary && (
                      <div className="rounded-lg border p-3">
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Employment</div>
                        {econSummary.unemployment_rate && (
                          <div className="mb-2">
                            <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">{econSummary.unemployment_rate.current.toFixed(1)}%</span>
                            <span className="text-[11px] text-gray-400 ml-1">unemployment</span>
                          </div>
                        )}
                        {typeof econSummary.nonfarm_yoy_pct === "number" && (
                          <div>
                            <span className={`text-sm font-medium tabular-nums ${econSummary.nonfarm_yoy_pct > 0 ? "text-emerald-600" : "text-red-600"}`}>
                              {econSummary.nonfarm_yoy_pct > 0 ? "+" : ""}{econSummary.nonfarm_yoy_pct.toFixed(1)}%
                            </span>
                            <span className="text-[11px] text-gray-400 ml-1">nonfarm payroll YoY</span>
                          </div>
                        )}
                      </div>
                    )}
                    {feeRevenue && (
                      <div className="rounded-lg border p-3">
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Fee Revenue</div>
                        <div className="mb-1">
                          <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">{formatAmount(feeRevenue.total_sc_income)}</span>
                        </div>
                        <div className="text-[11px] text-gray-400">
                          {feeRevenue.institution_count} institutions | avg {formatAmount(feeRevenue.avg_sc_income)}/inst
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Economic Indicators (BLS, BEA, Fed Board) */}
              {indicatorsBySeries.size > 0 && (
                <div className="rounded-lg border bg-white dark:bg-white/[0.02]">
                  <div className="px-5 py-3 border-b bg-gray-50/80 dark:bg-white/[0.03]">
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                      Economic Indicators (BLS, BEA, Fed Board)
                    </h2>
                  </div>
                  <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Array.from(indicatorsBySeries.entries()).map(
                      ([seriesId, data]) => {
                        const latest = data.points[0];
                        const previous = data.points[1];
                        const change =
                          latest && previous
                            ? latest.value - previous.value
                            : null;
                        return (
                          <div key={seriesId} className="rounded-lg border p-3">
                            <div className="text-[11px] text-gray-400 mb-1">
                              {data.title}
                            </div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                                {latest?.value.toFixed(2) ?? "-"}
                              </span>
                              <span className="text-[11px] text-gray-400">
                                {data.units}
                              </span>
                              {change !== null && (
                                <span
                                  className={`text-xs font-medium tabular-nums ${
                                    change > 0
                                      ? "text-red-600"
                                      : change < 0
                                        ? "text-emerald-600"
                                        : "text-gray-400"
                                  }`}
                                >
                                  {change > 0 ? "+" : ""}
                                  {change.toFixed(2)}
                                </span>
                              )}
                            </div>
                            {latest && (
                              <div className="text-[10px] text-gray-400 mt-0.5">
                                As of {latest.date}
                              </div>
                            )}
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              )}

              {/* Recent Speeches & Research */}
              {content.length > 0 && (
                <div className="rounded-lg border bg-white dark:bg-white/[0.02]">
                  <div className="px-5 py-3 border-b bg-gray-50/80 dark:bg-white/[0.03]">
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                      Recent Speeches &amp; Research
                    </h2>
                  </div>
                  <div className="divide-y">
                    {content.map((item) => (
                      <div
                        key={item.id}
                        className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-gray-50/50 dark:hover:bg-white/[0.03] transition-colors"
                      >
                        <div className="min-w-0">
                          <a
                            href={item.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-gray-900 dark:text-gray-100 hover:text-blue-600 transition-colors font-medium line-clamp-1"
                          >
                            {item.title}
                          </a>
                          <div className="flex items-center gap-2 mt-0.5">
                            {item.speaker && (
                              <span className="text-xs text-gray-500">
                                {item.speaker}
                              </span>
                            )}
                            <span className="text-[11px] text-gray-400">
                              {timeAgo(item.published_at)}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`flex-shrink-0 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            item.content_type === "speech"
                              ? "bg-purple-50 text-purple-600"
                              : item.content_type === "testimony"
                                ? "bg-orange-50 text-orange-600"
                                : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {item.content_type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ),

          fees: (
            <div className="space-y-6">
              {feeMedians.length > 0 ? (
                <div className="admin-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50/80 dark:bg-white/[0.03] text-left">
                          <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                            Fee Category
                          </th>
                          <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                            Median
                          </th>
                          <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                            Institutions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {feeMedians.map((fm) => (
                          <tr key={fm.fee_category} className="border-b last:border-0 hover:bg-blue-50/30 dark:hover:bg-white/[0.03] transition-colors">
                            <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100">
                              {getDisplayName(fm.fee_category)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">
                              {formatAmount(fm.median_amount)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                              {fm.institution_count.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-white dark:bg-white/[0.02] p-6 text-center text-gray-400 text-sm">
                  No fee data for this district
                </div>
              )}
            </div>
          ),

          complaints: (
            <div className="space-y-6">
              {complaints ? (
                <div className="rounded-lg border bg-white dark:bg-white/[0.02]">
                  <div className="px-5 py-3 border-b bg-gray-50/80 dark:bg-white/[0.03]">
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                      CFPB Complaint Summary
                    </h2>
                  </div>
                  <div className="p-5">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div className="rounded-lg border p-3">
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Total Complaints</div>
                        <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
                          {complaints.total_complaints.toLocaleString()}
                        </span>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Fee-Related</div>
                        <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
                          {complaints.fee_related_complaints.toLocaleString()}
                        </span>
                        {complaints.total_complaints > 0 && (
                          <span className="text-[11px] text-gray-400 ml-2">
                            ({((complaints.fee_related_complaints / complaints.total_complaints) * 100).toFixed(0)}%)
                          </span>
                        )}
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Institutions</div>
                        <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
                          {complaints.institution_count.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {complaints.top_products.length > 0 && (
                      <div>
                        <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Products</h3>
                        <div className="space-y-1.5">
                          {complaints.top_products.map((tp) => (
                            <div key={tp.product} className="flex items-center justify-between text-sm">
                              <span className="text-gray-700 dark:text-gray-300">{tp.product}</span>
                              <span className="tabular-nums text-gray-500">{tp.count.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-white dark:bg-white/[0.02] p-6 text-center text-gray-400 text-sm">
                  No complaint data available for this district
                </div>
              )}
            </div>
          ),

          beigebook: (
            <div className="space-y-6">
              {beigeBook.length > 0 ? (
                <div className="rounded-lg border bg-white dark:bg-white/[0.02]">
                  <div className="px-5 py-3 border-b bg-gray-50/80 dark:bg-white/[0.03] flex items-center justify-between">
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                      Beige Book
                    </h2>
                    {summary && (
                      <span className="text-[11px] text-gray-400">
                        Published {timeAgo(summary.release_date)}
                      </span>
                    )}
                  </div>
                  <div className="p-5">
                    {summary && (
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                          Summary of Economic Activity
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">
                          {summary.content_text}
                        </p>
                      </div>
                    )}

                    {otherSections.length > 0 && (
                      <div className="space-y-3">
                        {otherSections.map((section) => (
                          <details key={section.id} className="group">
                            <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 py-1">
                              <svg
                                className="w-3.5 h-3.5 text-gray-400 transition-transform group-open:rotate-90"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                                />
                              </svg>
                              {section.section_name}
                            </summary>
                            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed pl-5.5 mt-1 whitespace-pre-line">
                              {section.content_text}
                            </p>
                          </details>
                        ))}
                      </div>
                    )}

                    {summary && (
                      <a
                        href={summary.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gray-500 hover:text-blue-600 transition-colors mt-3 inline-block"
                      >
                        View full report on federalreserve.gov
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-white dark:bg-white/[0.02] p-6 text-center text-gray-400 text-sm">
                  No Beige Book data available. The agentic ingest backend must import this source.
                </div>
              )}

              {/* Beige Book Themes */}
              {districtThemes.length > 0 && (
                <div className="rounded-lg border bg-white dark:bg-white/[0.02]">
                  <div className="px-5 py-3 border-b bg-gray-50/80 dark:bg-white/[0.03]">
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                      Beige Book Themes
                    </h2>
                  </div>
                  <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                    {districtThemes.map((theme: { theme_category: string; sentiment: string; summary: string }, i: number) => {
                      const sentimentStyles = {
                        positive: "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800",
                        negative: "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800",
                        mixed: "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800",
                        neutral: "bg-gray-50 border-gray-200 dark:bg-white/[0.05] dark:border-white/10",
                      };
                      const sentimentDots = {
                        positive: "bg-emerald-400",
                        negative: "bg-red-400",
                        mixed: "bg-amber-400",
                        neutral: "bg-gray-300",
                      };
                      const style = sentimentStyles[theme.sentiment as keyof typeof sentimentStyles] ?? sentimentStyles.neutral;
                      const dot = sentimentDots[theme.sentiment as keyof typeof sentimentDots] ?? sentimentDots.neutral;

                      return (
                        <div key={i} className={`rounded-lg border p-3 ${style}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                              {theme.theme_category.replace(/_/g, " ")}
                            </span>
                            <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3">
                            {theme.summary}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ),
        }}
      </DistrictTabs>

      {/* Quick link to peer segmentation */}
      <div className="text-sm mt-6">
        <Link
          href={`/admin/peers?district=${districtId}`}
          className="text-gray-500 hover:text-blue-600 transition-colors"
        >
          View peer segmentation for District {districtId}
        </Link>
      </div>
    </>
  );
}
