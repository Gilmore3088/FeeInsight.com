export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { buildAdminRedirectPath, type AdminSearchParams } from "@/lib/admin-redirect-path";
import { requireAuth } from "@/lib/auth";
import { getGoldStandardCandidates } from "@/lib/admin-queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatAssets } from "@/lib/format";

export async function GoldStandardView({ embedded = false }: { embedded?: boolean } = {}) {
  await requireAuth("view");

  const candidates = await getGoldStandardCandidates(50);

  return (
    <div className="admin-content space-y-6">
      {!embedded && <Breadcrumbs items={[{ label: "Verify" }]} />}

      {!embedded && <div>
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          Gold Standard Verification
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Top institutions by asset size with extracted fees. Verify extraction
          accuracy against original fee schedules.
        </p>
      </div>}

      <div className="admin-card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="bg-gray-50/80 border-b border-gray-200">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Institution
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                State
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Tier
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Assets
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Fees
              </th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Source
              </th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {candidates.map((c) => (
              <tr
                key={c.id}
                className="hover:bg-gray-50/50 transition-colors"
              >
                <td className="px-4 py-2.5 font-medium text-gray-900">
                  {c.institution_name}
                </td>
                <td className="px-4 py-2.5 text-gray-500">
                  {c.state_code ?? "-"}
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">
                  {c.asset_size_tier
                    ? c.asset_size_tier.replace(/_/g, " ")
                    : "-"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                  {formatAssets(c.asset_size)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                  {c.fee_count}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {c.fee_schedule_url || c.hand_schedule_url ? (
                    <div className="flex flex-col items-center gap-0.5">
                      {c.fee_schedule_url && (
                        <a
                          href={c.fee_schedule_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 text-xs underline"
                        >
                          Fee Schedule
                        </a>
                      )}
                      {c.hand_schedule_url && c.hand_schedule_url !== c.fee_schedule_url && (
                        <a
                          href={c.hand_schedule_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 text-xs underline"
                        >
                          Hand-found schedule
                        </a>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-300 text-xs">No URL</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Link
                    href={`/admin/verify/${c.id}`}
                    className="inline-flex items-center rounded px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    Verify
                  </Link>
                </td>
              </tr>
            ))}
            {candidates.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-gray-400"
                >
                  No institutions with extracted fees found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function RedirectVerifyPage({
  searchParams,
}: {
  searchParams: Promise<AdminSearchParams>;
}) {
  redirect(buildAdminRedirectPath("/admin/knox", await searchParams, { queue: "gold" }));
}
