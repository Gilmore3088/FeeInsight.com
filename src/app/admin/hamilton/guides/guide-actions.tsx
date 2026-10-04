"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveGuideRegulatoryAction,
  archiveGuideAction,
  moveGuideToRegulatoryReviewAction,
  moveGuideToReviewAction,
  publishGuideAction,
} from "./actions";

export interface GuideActionRow {
  id: number;
  slug: string;
  title: string;
  status: string;
  carriesRegulatoryContent: boolean;
  regulatoryApprovedBy: string | null;
  regulatoryApprovedAt: string | null;
  unresolvedTokenCount: number;
}

const BTN =
  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50";

export function GuideActions({ guide }: { guide: GuideActionRow }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // The publish control is disabled with a stated reason rather than silently absent,
  // so a reviewer can see what is blocking the guide.
  const needsApproval =
    guide.carriesRegulatoryContent && !guide.regulatoryApprovedAt;
  const hasBrokenTokens = guide.unresolvedTokenCount > 0;
  const publishBlockedReason = hasBrokenTokens
    ? `${guide.unresolvedTokenCount} token${guide.unresolvedTokenCount === 1 ? "" : "s"} has no data behind it`
    : needsApproval
      ? "Regulatory content is not approved"
      : guide.status === "published"
        ? "Already published"
        : null;

  function run(action: () => Promise<{ success: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.success) setError(result.error ?? "Action failed");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1.5">
        {guide.status === "draft" && (
          <button
            className={`${BTN} border-gray-300 text-gray-700 hover:bg-gray-50`}
            disabled={pending}
            onClick={() => run(() => moveGuideToReviewAction(guide.id))}
          >
            Send to review
          </button>
        )}

        {guide.carriesRegulatoryContent && guide.status === "in_review" && (
          <button
            className={`${BTN} border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`}
            disabled={pending}
            onClick={() => run(() => moveGuideToRegulatoryReviewAction(guide.id))}
          >
            Send to regulatory review
          </button>
        )}

        {needsApproval && (
          <button
            className={`${BTN} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
            disabled={pending}
            onClick={() => {
              if (
                !confirm(
                  `Approve the regulatory statements in "${guide.title}"?\n\nYour name is recorded against this exact text. Editing the guide clears the approval.`,
                )
              ) {
                return;
              }
              run(() => approveGuideRegulatoryAction(guide.id));
            }}
          >
            Approve regulatory content
          </button>
        )}

        <button
          className={`${BTN} border-gray-900 bg-gray-900 text-white hover:bg-gray-800`}
          disabled={pending || publishBlockedReason !== null}
          title={publishBlockedReason ?? "Publish this guide"}
          onClick={() => run(() => publishGuideAction(guide.id))}
        >
          Publish
        </button>

        {guide.status === "published" && (
          <button
            className={`${BTN} border-gray-300 text-gray-700 hover:bg-gray-50`}
            disabled={pending}
            onClick={() => {
              if (!confirm(`Archive "${guide.title}"? It will leave the public site.`))
                return;
              run(() => archiveGuideAction(guide.id));
            }}
          >
            Archive
          </button>
        )}
      </div>

      {publishBlockedReason && guide.status !== "published" && (
        <p className="text-right text-[11px] text-amber-700">
          Publishing blocked: {publishBlockedReason}
        </p>
      )}
      {error && <p className="text-right text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
