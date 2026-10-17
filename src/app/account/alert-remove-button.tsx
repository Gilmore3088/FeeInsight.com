"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { removeInstitutionAlert } from "./alert-actions";

export function AlertRemoveButton({ institutionId, institutionName }: { institutionId: number; institutionName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        aria-label={`Remove ${institutionName} and stop its alerts`}
        onClick={() =>
          startTransition(async () => {
            const result = await removeInstitutionAlert(institutionId);
            if (result.ok) {
              trackEvent("fee_alert_remove", { from: "account" });
              router.refresh();
            } else {
              setError(result.error ?? "Could not remove");
            }
          })
        }
        className="text-[12px] font-medium text-ink-muted hover:text-brick hover:underline disabled:opacity-50"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {error && (
        <span role="alert" className="text-[12px] text-brick">
          {error}
        </span>
      )}
    </span>
  );
}
