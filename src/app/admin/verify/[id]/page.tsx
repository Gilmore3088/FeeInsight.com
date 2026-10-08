export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import {
  getGoldStandardCandidate,
  getExtractedFeesForInstitution,
} from "@/lib/admin-queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatAmount, formatAssets } from "@/lib/format";
import { VerifyForm } from "./verify-form";

export default async function VerifyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth("view");

  const { id } = await params;
  const institutionId = parseInt(id, 10);

  const institution = await getGoldStandardCandidate(institutionId);
  if (!institution) {
    return <p className="text-gray-500">Institution not found.</p>;
  }

  const fees = await getExtractedFeesForInstitution(institutionId);
  // A hand-given schedule (stored as a companion) shows beside the main link when they differ.
  const handScheduleUrl =
    institution.hand_schedule_url && institution.hand_schedule_url !== institution.fee_schedule_url
      ? institution.hand_schedule_url
      : null;
  const previewUrl = institution.fee_schedule_url ?? handScheduleUrl;

  return (
    <div className="admin-content space-y-6">
      <Breadcrumbs
        items={[
          { label: "Verify", href: "/admin/verify" },
          { label: institution.institution_name },
        ]}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">
            {institution.institution_name}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {institution.state_code ?? ""} &middot;{" "}
            {institution.asset_size_tier
              ? institution.asset_size_tier.replace(/_/g, " ")
              : ""}{" "}
            &middot; {formatAssets(institution.asset_size)} &middot;{" "}
            {fees.length} extracted fees
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {institution.fee_schedule_url && (
            <a
              href={institution.fee_schedule_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            >
              Open Fee Schedule
            </a>
          )}
          {handScheduleUrl && (
            <a
              href={handScheduleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            >
              Open hand-found schedule
            </a>
          )}
        </div>
      </div>

      {previewUrl && (
        <div className="admin-card overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-200">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Fee Schedule Source
            </span>
          </div>
          <div className="p-1">
            <iframe
              src={previewUrl}
              className="w-full h-[500px] rounded border border-gray-200"
              title="Fee schedule"
              sandbox="allow-same-origin"
            />
          </div>
          <div className="px-4 py-2 border-t border-gray-100">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              Open in new tab if iframe is blocked
            </a>
          </div>
        </div>
      )}

      <VerifyForm institutionId={institutionId} fees={fees} />
    </div>
  );
}
