export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import {
  getInstitutionById,
  getPeerAnalysis,
  getFinancialsByInstitution,
  getComplaintsByInstitution,
  getBeigeBookHeadline,
} from "@/lib/data-store";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatAssets, formatAmount, timeAgo } from "@/lib/format";
import { FeeUrlActions } from "./fee-url-actions";
import { FDIC_TIER_LABELS, DISTRICT_NAMES } from "@/lib/fed-districts";

interface FeeComparisonRow {
  canonical_name: string;
  display_name: string;
  target_amount: number | null;
  peer_min: number;
  peer_max: number;
  peer_median: number;
  peer_p25: number;
  peer_p75: number;
  peer_count: number;
  percentile_rank: number;
}

interface PeerRow {
  id: number;
  name: string;
  asset_size: number | null;
  tier: string;
  district: number | null;
  state: string | null;
  score: number;
}

interface Highlight {
  fee: string;
  direction: "above" | "below";
  amount: number;
  peer_median: number;
  percentile: number;
}

export default async function PeerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth("view");

  const { id } = await params;
  const targetId = parseInt(id, 10);
  const institution = await getInstitutionById(targetId);

  if (!institution) {
    return <p className="text-gray-500">Institution not found</p>;
  }

  const financials = await getFinancialsByInstitution(targetId);
  const complaints = await getComplaintsByInstitution(targetId);
  const beigeBookHeadline = institution.fed_district
    ? await getBeigeBookHeadline(institution.fed_district)
    : null;

  const analysis = await getPeerAnalysis(targetId) as {
    peer_count: number;
    peers: PeerRow[];
    fee_comparisons: FeeComparisonRow[];
    highlights: Highlight[];
  } | null;

  return (
    <>
      <div className="mb-6">
        <Breadcrumbs items={[
          { label: "Dashboard", href: "/admin" },
          { label: "Peer Index", href: "/admin/peers" },
          { label: institution.institution_name },
        ]} />
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          {institution.institution_name}
        </h1>
        <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
              institution.charter_type === "bank"
                ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                : "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
            }`}
          >
            {institution.charter_type === "bank" ? "Bank" : "Credit Union"}
          </span>
          <span className="tabular-nums">{formatAssets(institution.asset_size)}</span>
          {institution.asset_size_tier && (
            <span>
              {FDIC_TIER_LABELS[institution.asset_size_tier] ||
                institution.asset_size_tier}
            </span>
          )}
          {institution.fed_district && (
            <span>
              District {institution.fed_district} -{" "}
              {DISTRICT_NAMES[institution.fed_district]}
            </span>
          )}
          <span>
            {institution.city}, {institution.state_code}
          </span>
          <Link
            href={`/admin/institution/${targetId}`}
            className="text-gray-500 hover:text-blue-600 transition-colors"
          >
            View fees
          </Link>
        </div>
      </div>

      {/* Fee Schedule URL + Crawl */}
      <div className="mb-4">
        <FeeUrlActions
          institutionId={targetId}
          currentUrl={institution.fee_schedule_url}
          institutionName={institution.institution_name}
        />
      </div>

      {/* Regional context */}
      {institution.fed_district && beigeBookHeadline && (
        <div className="admin-card mb-6">
          <div className="px-5 py-3 border-b bg-gray-50/80 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800">Regional Context</h2>
            <span className="text-[11px] text-gray-400">
              {timeAgo(beigeBookHeadline.release_date)}
            </span>
          </div>
          <div className="p-4">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-700">
                District {institution.fed_district} &mdash;{" "}
                {DISTRICT_NAMES[institution.fed_district]}:
              </span>{" "}
              {beigeBookHeadline.text}
            </p>
            <Link
              href={`/admin/districts/${institution.fed_district}`}
              className="text-xs text-gray-500 hover:text-blue-600 transition-colors mt-2 inline-block"
            >
              Full district report
            </Link>
          </div>
        </div>
      )}

      {/* Financial data */}
      {financials.length > 0 && (
        <div className="admin-card mb-6">
          <div className="px-5 py-3 border-b bg-gray-50/80">
            <h2 className="text-sm font-bold text-gray-800">Financial Data</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Source: {financials[0].source === "fdic" ? "FDIC Call Reports" : "NCUA 5300 Reports"}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/80 text-left">
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Period</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Total Assets</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Deposits</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Loans</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                    {financials[0].source === "ncua" ? "Fee Income" : "Non-Int Income"}
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">ROA</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                    {financials[0].source === "fdic" ? "Efficiency" : "Net Worth"}
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Branches</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                    {financials[0].source === "ncua" ? "Members" : "Employees"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {financials.map((f) => (
                  <tr key={f.report_date} className="border-b last:border-0 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {f.report_date}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                      {formatAssets(f.total_assets)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {formatAssets(f.total_deposits)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {formatAssets(f.total_loans)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {f.source === "ncua"
                        ? formatAssets(f.service_charge_income)
                        : formatAssets(f.other_noninterest_income)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {f.roa != null ? `${f.roa.toFixed(2)}%` : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {f.source === "fdic"
                        ? f.efficiency_ratio != null
                          ? `${f.efficiency_ratio.toFixed(1)}%`
                          : "-"
                        : f.tier1_capital_ratio != null
                          ? `${f.tier1_capital_ratio.toFixed(2)}%`
                          : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {f.branch_count?.toLocaleString() ?? "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {f.source === "ncua"
                        ? f.member_count?.toLocaleString() ?? "-"
                        : f.employee_count?.toLocaleString() ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CFPB Complaints */}
      {complaints.length > 0 && (
        <div className="admin-card mb-6">
          <div className="px-5 py-3 border-b bg-gray-50/80">
            <h2 className="text-sm font-bold text-gray-800">
              CFPB Complaints (2024)
            </h2>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            {complaints.map((c, i) => (
              <div key={`${c.product}-${i}`} className="rounded-lg border p-3 dark:border-white/[0.08]">
                <div className="text-xs text-gray-500">{c.product}</div>
                <div className="text-2xl font-bold tabular-nums text-gray-900 mt-1">
                  {c.complaint_count.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!analysis ? null : (
        <>
          {/* Highlights */}
          {analysis.highlights && analysis.highlights.length > 0 && (
            <div className="admin-card mb-6">
              <div className="px-5 py-3 border-b bg-gray-50/80">
                <h2 className="text-sm font-bold text-gray-800">
                  Notable Findings
                </h2>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysis.highlights.map((h, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 ${
                      h.direction === "above"
                        ? "border-red-200 bg-red-50/50 dark:border-red-800/40 dark:bg-red-900/20"
                        : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/40 dark:bg-emerald-900/20"
                    }`}
                  >
                    <div className="font-medium text-gray-900">{h.fee}</div>
                    <div className="text-sm mt-1">
                      <span className="tabular-nums">
                        {formatAmount(h.amount)}
                      </span>
                      <span className="text-gray-500 mx-1">vs median</span>
                      <span className="tabular-nums">
                        {formatAmount(h.peer_median)}
                      </span>
                    </div>
                    <div
                      className={`text-xs mt-0.5 tabular-nums ${
                        h.direction === "above"
                          ? "text-red-600"
                          : "text-emerald-600"
                      }`}
                    >
                      {h.direction === "above" ? "Above" : "Below"}{" "}
                      {h.percentile}th percentile
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fee comparison table */}
          {analysis.fee_comparisons &&
            analysis.fee_comparisons.length > 0 && (
              <div className="admin-card mb-6">
                <div className="px-5 py-3 border-b bg-gray-50/80">
                  <h2 className="text-sm font-bold text-gray-800">
                    Fee Comparison
                  </h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Compared against {analysis.peer_count} peers
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50/80 text-left">
                        <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Fee</th>
                        <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                          This Institution
                        </th>
                        <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                          Peer Min
                        </th>
                        <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                          P25
                        </th>
                        <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                          Median
                        </th>
                        <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                          P75
                        </th>
                        <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                          Peer Max
                        </th>
                        <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-center">
                          Rank
                        </th>
                        <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-center">
                          Peers
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.fee_comparisons.map((fc) => {
                        const isAbove =
                          fc.target_amount !== null &&
                          fc.percentile_rank >= 75;
                        const isBelow =
                          fc.target_amount !== null &&
                          fc.percentile_rank <= 25 &&
                          fc.percentile_rank >= 0;
                        return (
                          <tr
                            key={fc.canonical_name}
                            className={`border-b last:border-0 transition-colors ${
                              isAbove
                                ? "bg-red-50/50 dark:bg-red-900/10"
                                : isBelow
                                  ? "bg-emerald-50/50 dark:bg-emerald-900/10"
                                  : "hover:bg-gray-50/50"
                            }`}
                          >
                            <td className="px-4 py-2.5 font-medium">
                              <Link
                                href={`/admin/fees/catalog/${fc.canonical_name}`}
                                className="text-gray-900 hover:text-blue-600 transition-colors"
                              >
                                {fc.display_name}
                              </Link>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900">
                              {formatAmount(fc.target_amount)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                              {formatAmount(fc.peer_min)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                              {formatAmount(fc.peer_p25)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-700">
                              {formatAmount(fc.peer_median)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                              {formatAmount(fc.peer_p75)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                              {formatAmount(fc.peer_max)}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {fc.percentile_rank >= 0 ? (
                                <span
                                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                                    fc.percentile_rank >= 75
                                      ? "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                                      : fc.percentile_rank <= 25
                                        ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                                        : "bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400"
                                  }`}
                                >
                                  P{fc.percentile_rank}
                                </span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-center tabular-nums text-gray-500">
                              {fc.peer_count}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          {/* Matched peers */}
          {analysis.peers && analysis.peers.length > 0 && (
            <div className="admin-card">
              <div className="px-5 py-3 border-b bg-gray-50/80">
                <h2 className="text-sm font-bold text-gray-800">
                  Matched Peers ({analysis.peers.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/80 text-left">
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Institution</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">State</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                        Assets
                      </th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Tier</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-center">
                        District
                      </th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-center">
                        Match Score
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.peers.map((peer) => (
                      <tr
                        key={peer.id}
                        className="border-b last:border-0 hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/admin/peers/${peer.id}`}
                            className="text-gray-900 hover:text-blue-600 transition-colors font-medium"
                          >
                            {peer.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">
                          {peer.state || "-"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                          {formatAssets(peer.asset_size)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">
                          {peer.tier
                            ? FDIC_TIER_LABELS[peer.tier] || peer.tier
                            : "-"}
                        </td>
                        <td className="px-4 py-2.5 text-center tabular-nums text-gray-500">
                          {peer.district || "-"}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                              peer.score >= 5
                                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : peer.score >= 3
                                  ? "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                                  : "bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400"
                            }`}
                          >
                            {peer.score}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
