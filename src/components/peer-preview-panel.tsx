import Link from "next/link";
import type { PeerPreviewStats, PeerTopCategory, BeigeBookSection } from "@/lib/data-store";
import { formatAmount, formatPct } from "@/lib/format";
import { getDisplayName, getFeeFamily, getFamilyColor } from "@/lib/fee-taxonomy";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { timeAgo } from "@/lib/format";

interface PeerPreviewPanelProps {
  hasFilters: boolean;
  stats: PeerPreviewStats;
  topCategories: PeerTopCategory[];
  filterDescription: string;
  exploreHref: string;
  singleDistrict?: number | null;
  beigeBookSections?: BeigeBookSection[];
  multipleDistricts?: boolean;
}

export function PeerPreviewPanel({
  hasFilters,
  stats,
  topCategories,
  filterDescription,
  singleDistrict,
  beigeBookSections,
  multipleDistricts,
}: PeerPreviewPanelProps) {
  if (!hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-4 text-center">
        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-2">
          <svg aria-hidden="true"
            className="w-5 h-5 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
            />
          </svg>
        </div>
        <p className="text-sm text-gray-500">
          Select filters to see segment analytics.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Big number + description */}
      <div className="mb-3">
        <div className="flex items-baseline gap-3">
          <p className="text-3xl font-bold text-gray-900">
            {stats.total_institutions.toLocaleString()}
          </p>
          <p className="text-sm text-gray-500">{filterDescription}</p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <KPICard
          label="Fee URL Coverage"
          value={formatPct(stats.fee_url_pct)}
          highlight={stats.fee_url_pct > 0.5}
        />
        <KPICard
          label="Fees Extracted"
          value={stats.total_fees.toLocaleString()}
        />
        <KPICard
          label="Flag Rate"
          value={formatPct(stats.flag_rate)}
          warn={stats.flag_rate > 0.1}
        />
        <KPICard
          label="Avg Confidence"
          value={formatPct(stats.avg_confidence)}
          highlight={stats.avg_confidence > 0.8}
        />
      </div>

      {/* Top categories */}
      {topCategories.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Top Fee Categories
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="pb-1 font-medium">Category</th>
                <th className="pb-1 font-medium text-right">Median</th>
                <th className="pb-1 font-medium text-right">Institutions</th>
              </tr>
            </thead>
            <tbody>
              {topCategories.map((cat) => {
                const family = getFeeFamily(cat.fee_category);
                const colors = family ? getFamilyColor(family) : null;
                return (
                  <tr
                    key={cat.fee_category}
                    className="border-t border-gray-100"
                  >
                    <td className="py-1.5">
                      <Link
                        href={`/admin/fees/catalog/${cat.fee_category}`}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        {getDisplayName(cat.fee_category)}
                      </Link>
                      {family && colors && (
                        <span
                          className={`ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text}`}
                        >
                          {family}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right font-mono text-gray-700 text-xs">
                      {formatAmount(cat.median_amount)}
                    </td>
                    <td className="py-1.5 text-right text-gray-600 text-xs">
                      {cat.institution_count}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Regional context (Beige Book) */}
      {singleDistrict && beigeBookSections && beigeBookSections.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Regional Context &mdash; District {singleDistrict} ({DISTRICT_NAMES[singleDistrict]})
            </h3>
            <span className="text-[10px] text-gray-400">
              Published {timeAgo(beigeBookSections[0].release_date)}
            </span>
          </div>
          <div className="text-xs text-gray-600 leading-relaxed">
            {beigeBookSections
              .filter((s) => s.section_name === "Summary of Economic Activity")
              .map((s) => (
                <p key={s.id} className="line-clamp-4">
                  {s.content_text}
                </p>
              ))}
          </div>
          <Link
            href={`/admin/districts/${singleDistrict}`}
            className="text-xs text-blue-600 hover:underline mt-1.5 inline-block"
          >
            Full district report
          </Link>
        </div>
      )}
      {multipleDistricts && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 italic">
            Select a single district for regional economic context.
          </p>
        </div>
      )}
    </div>
  );
}

function KPICard({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-100 px-3 py-2">
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">
        {label}
      </p>
      <p
        className={`text-lg font-semibold mt-0.5 ${
          warn
            ? "text-orange-600"
            : highlight
              ? "text-blue-600"
              : "text-gray-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
