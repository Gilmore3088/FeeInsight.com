"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryFeeRefresh } from "../institution/[id]/actions";

/** H03-T08: retries the refresh after an operator's fee action. Changes no fee. Admin only (checked on the server). */
export function RetryRefreshButton({ runId }: { runId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      const result = await retryFeeRefresh(runId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="rounded border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-white/[0.12] dark:text-gray-300 dark:hover:bg-white/[0.06]"
      >
        {pending ? "Retrying…" : "Retry refresh"}
      </button>
      {error && <span className="text-[11px] text-red-600" role="alert">{error}</span>}
    </span>
  );
}
