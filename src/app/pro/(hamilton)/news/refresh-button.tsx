"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { refreshFeeds } from "./actions";

/** Feed ingestion is an operator task: the page shows this only to admins and analysts. */
export function RefreshButton() {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function handleRefresh() {
    startRefresh(async () => {
      try {
        const r = await refreshFeeds();
        setResult(`${r.inserted} new articles${r.errors.length > 0 ? ` (${r.errors.length} feed errors)` : ""}`);
        router.refresh();
      } catch {
        setResult("Failed to refresh feeds");
      }
      setTimeout(() => setResult(null), 4000);
    });
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        className="flex items-center gap-1.5 rounded-lg border border-warm-200 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-warm-600 transition-colors hover:bg-warm-100 hover:text-warm-900 disabled:opacity-50"
      >
        <svg
          aria-hidden="true"
          className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {refreshing ? "Fetching..." : "Refresh"}
      </button>
      {result ? (
        <span role="status" className="text-[11px] font-medium text-emerald-700">
          {result}
        </span>
      ) : null}
    </span>
  );
}
