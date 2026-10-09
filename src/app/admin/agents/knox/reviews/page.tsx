export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { hasPermission, requireAuth } from "@/lib/auth";
import {
  getKnoxReasonGroupCounts,
  getKnoxReviewCounts,
  listKnoxRejections,
} from "@/lib/data-store/knox-reviews";
import {
  describeFeeAmount,
  interpretKnoxReasons,
  isKnoxReasonGroup,
  KNOX_REASON_GROUP_LABELS,
  KNOX_REASON_GROUPS,
  type KnoxReasonGroup,
} from "@/lib/knox-reasons";
import { ConfirmButton, OverrideButton, SkipButton } from "./review-actions";
import { KnoxKeyboardNav } from "./keyboard-nav";
import { buildAdminRedirectPath, type AdminSearchParams } from "@/lib/admin-redirect-path";

type FilterTab = "pending" | "confirmed" | "overridden" | "all";
const TABS: FilterTab[] = ["pending", "confirmed", "overridden", "all"];

const FILTER_COLORS: Record<FilterTab, string> = {
  pending: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  confirmed: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  overridden: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
  all: "bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400",
};

function confidenceBadge(conf: number | null) {
  if (conf === null || conf === undefined) {
    return <span className="text-[11px] text-gray-400">-</span>;
  }
  const pct = Math.round(Number(conf) * 100);
  const cls =
    conf >= 0.9
      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
      : conf >= 0.7
        ? "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
        : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${cls}`}>
      {pct}%
    </span>
  );
}

/** The first reason Knox rejected on, in plain words, for the queue row. */
function reasonSummary(row: { payload: Record<string, unknown>; amount: number | null; amount_kind: string | null; rate_percent: number | null }): string {
  const amountRecorded = describeFeeAmount(row).kind !== "unknown";
  const first = interpretKnoxReasons(row.payload, { amountRecorded }).find((r) => r.blocking);
  return first ? first.detail : "No rejection reason stored.";
}

export async function KnoxDecisionsView({
  searchParams,
  embedded = false,
}: {
  searchParams: Promise<{ filter?: string; reason?: string; page?: string }>;
  embedded?: boolean;
}) {
  const user = await requireAuth("view");
  const canAct = hasPermission(user, "approve");

  const params = await searchParams;
  const filter = (TABS as readonly string[]).includes(params.filter ?? "")
    ? (params.filter as FilterTab)
    : "pending";
  const reason: KnoxReasonGroup | "all" = isKnoxReasonGroup(params.reason) ? params.reason : "all";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  let result = { rows: [], total: 0, page, pageSize: 25 } as Awaited<
    ReturnType<typeof listKnoxRejections>
  >;
  let counts = { pending: 0, confirmed: 0, overridden: 0, total: 0 };
  let groupCounts: Record<KnoxReasonGroup, number> = { zero_amount: 0, above_peers: 0, unrecognized: 0 };
  try {
    [result, counts, groupCounts] = await Promise.all([
      listKnoxRejections({ filter, reasonGroup: reason, page, pageSize: 25 }),
      getKnoxReviewCounts(),
      getKnoxReasonGroupCounts(filter),
    ]);
  } catch (e) {
    console.error("KnoxReviewsPage load failed:", e);
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  function hrefFor(next: Partial<{ filter: FilterTab; reason: string; page: number }>) {
    const qs = new URLSearchParams();
    qs.set("filter", next.filter ?? filter);
    qs.set("reason", next.reason ?? reason);
    qs.set("page", String(next.page ?? 1));
    qs.set("queue", "decisions");
    return `/admin/knox?${qs.toString()}`;
  }

  return (
    <>
      {!embedded && <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/admin" },
            { label: "Agents", href: "/admin/agents" },
            { label: "Knox Reviews" },
          ]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Knox Rejections
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Human review of Knox rejection decisions. Override to re-promote fees
          Knox incorrectly blocked; confirmations train Knox&apos;s rules.
        </p>
      </div>}

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 border-b overflow-x-auto">
        {TABS.map((t) => {
          const isActive = filter === t;
          const count =
            t === "all" ? counts.total : counts[t as keyof typeof counts];
          return (
            <Link
              key={t}
              href={hrefFor({ filter: t, page: 1 })}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px whitespace-nowrap ${
                isActive
                  ? "border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              {t}
              <span
                className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                  isActive
                    ? FILTER_COLORS[t]
                    : "bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400"
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Reason filter */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mr-1">
          Reason
        </span>
        <Link
          href={hrefFor({ reason: "all", page: 1 })}
          className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
            reason === "all"
              ? "bg-gray-900 text-white dark:bg-white/15 dark:text-gray-100"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400 dark:hover:bg-white/[0.1]"
          }`}
        >
          All
        </Link>
        {KNOX_REASON_GROUPS.filter((r) => groupCounts[r] > 0 || reason === r).map((r) => (
          <Link
            key={r}
            href={hrefFor({ reason: r, page: 1 })}
            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
              reason === r
                ? "bg-gray-900 text-white dark:bg-white/15 dark:text-gray-100"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400 dark:hover:bg-white/[0.1]"
            }`}
          >
            {KNOX_REASON_GROUP_LABELS[r]}
            <span className="ml-1 tabular-nums opacity-70">{groupCounts[r].toLocaleString("en-US")}</span>
          </Link>
        ))}
      </div>

      {result.rows.length === 0 ? (
        <div className="admin-card text-center py-12 text-gray-500">
          No Knox rejections match this filter.
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50/80 dark:bg-white/[0.03]">
              <tr>
                {[
                  "Fee",
                  "Institution",
                  "Reason",
                  "Amount",
                  "Conf.",
                  "When",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              {result.rows.map((r) => (
                <tr
                  key={r.message_id}
                  data-knox-row
                  className="hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      data-detail-link
                      href={`/admin/knox/decisions/${r.message_id}`}
                      className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 transition-colors"
                    >
                      {r.fee_name ?? "(unknown)"}
                    </Link>
                    {r.canonical_fee_key && (
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                        {r.canonical_fee_key}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className="text-gray-900 dark:text-gray-200">
                      {r.institution_name ?? "-"}
                    </span>
                    {r.state_code && (
                      <span className="ml-1 text-[10px] text-gray-400">
                        {r.state_code}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className="inline-block rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-gray-300 text-[10px] font-medium mr-1.5">
                      {KNOX_REASON_GROUP_LABELS[r.reason_group]}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {reasonSummary(r)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-900 dark:text-gray-200">
                    {describeFeeAmount(r).label}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {confidenceBadge(r.confidence !== null ? Number(r.confidence) : null)}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {canAct && r.review_decision === null ? (
                        <>
                          <ConfirmButton
                            messageId={r.message_id}
                            feeVerifiedId={r.fee_verified_id}
                          />
                          <OverrideButton
                            messageId={r.message_id}
                            feeVerifiedId={r.fee_verified_id}
                          />
                          <SkipButton messageId={r.message_id} />
                        </>
                      ) : r.review_decision ? (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            r.review_decision === "override"
                              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                          }`}
                        >
                          {r.review_decision}
                          {r.reviewer_username ? ` / ${r.reviewer_username}` : ""}
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">read-only</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <KnoxKeyboardNav rowCount={result.rows.length} />
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
          <span className="tabular-nums">
            Page {result.page} of {totalPages} ({result.total} total)
          </span>
          <div className="flex gap-1">
            <Link
              href={hrefFor({ page: Math.max(1, page - 1) })}
              className={`px-3 py-1 rounded-md border ${
                page === 1
                  ? "pointer-events-none opacity-40 border-gray-200 dark:border-white/[0.08]"
                  : "border-gray-300 hover:bg-gray-50 dark:border-white/[0.12] dark:hover:bg-white/[0.04]"
              }`}
            >
              Previous
            </Link>
            <Link
              href={hrefFor({ page: Math.min(totalPages, page + 1) })}
              className={`px-3 py-1 rounded-md border ${
                page === totalPages
                  ? "pointer-events-none opacity-40 border-gray-200 dark:border-white/[0.08]"
                  : "border-gray-300 hover:bg-gray-50 dark:border-white/[0.12] dark:hover:bg-white/[0.04]"
              }`}
            >
              Next
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

export default async function RedirectKnoxReviewsPage({
  searchParams,
}: {
  searchParams: Promise<AdminSearchParams>;
}) {
  redirect(buildAdminRedirectPath("/admin/knox", await searchParams, { queue: "decisions" }));
}
