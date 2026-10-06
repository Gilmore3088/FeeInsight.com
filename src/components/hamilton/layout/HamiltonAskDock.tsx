"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { getDisplayName } from "@/lib/fee-taxonomy";

/**
 * Ask Hamilton, docked at the bottom of every workspace screen. A question opens in Analyze with
 * the bank in context; it is filled in there, not sent, so nothing runs a paid model call until the
 * user sends it. The Analyze screen has its own input, so the dock stays off it.
 */
export function HamiltonAskDock({ selectedInstitutionId }: { selectedInstitutionId?: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (pathname.startsWith("/pro/analyze")) return null;

  const fee = searchParams.get("fee") ?? searchParams.get("category");
  const instId = searchParams.get("instId") ?? selectedInstitutionId ?? null;
  const topic = fee ? getDisplayName(fee).replace(/\s*\([^)]*\)\s*$/, "").toLowerCase() : null;
  const placeholder = topic
    ? `Ask Hamilton about ${topic}: what changes if we match the market?`
    : "Ask Hamilton: how does our overdraft fee compare in our counties?";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-4 print:hidden sm:px-6">
      <form
        method="get"
        action="/pro/analyze"
        role="search"
        aria-label="Ask Hamilton"
        className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-warm-ink-700 bg-warm-ink-900 p-2 pl-4 shadow-2xl"
      >
        <span aria-hidden className="text-sm text-warm-ink-50" style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
          H
        </span>
        <label htmlFor="hamilton-ask" className="sr-only">
          Ask Hamilton
        </label>
        <input
          id="hamilton-ask"
          name="q"
          required
          maxLength={500}
          autoComplete="off"
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-warm-ink-50 placeholder:text-warm-ink-300 focus:outline-none"
        />
        {instId ? <input type="hidden" name="instId" value={instId} /> : null}
        <button type="submit" className="rounded-lg bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark">
          Ask
        </button>
      </form>
    </div>
  );
}
