"use client";

import { useState, useTransition } from "react";
import { revalidateAdmin } from "@/app/admin/actions/revalidate";

export function RefreshCacheButton() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    startTransition(async () => {
      const result = await revalidateAdmin();
      if (result.success) {
        setMessage("Cache cleared");
        setTimeout(() => setMessage(null), 3000);
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 hover:text-gray-900 transition-colors disabled:opacity-50"
    >
      <svg aria-hidden="true"
        className={`w-3.5 h-3.5 ${isPending ? "animate-spin" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      {isPending ? "Refreshing..." : message || "Refresh Cache"}
    </button>
  );
}
