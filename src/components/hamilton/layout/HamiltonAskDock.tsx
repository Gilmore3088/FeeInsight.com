"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getDisplayName } from "@/lib/fee-taxonomy";

/**
 * Ask Hamilton, docked at the bottom of every workspace screen. A question opens the Ask screen
 * with the bank in context and is answered there straight away (James, 2026-10-06: never make the
 * banker retype it). The dock stays off the Ask screen and the plan documents.
 *
 * Closed, it is one small button in the corner so it never sits over a chart or a figure
 * (James, 2026-10-07: the full bar covered the Try a price chart); a tap opens the bar.
 */
export function HamiltonAskDock({ selectedInstitutionId }: { selectedInstitutionId?: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  // Kept while the bar is closed, so a stray tap on ✕ never throws a typed question away.
  const [draft, setDraft] = useState("");
  // The Ask screen loads fresh; until it does, the bar says so and can't be sent twice.
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) pillRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  // The Ask screen has its own bar, and the plan formats are documents to read and print.
  if (pathname.startsWith("/pro/analyze") || pathname.startsWith("/pro/simulate/plan")) return null;

  const fee = searchParams.get("fee") ?? searchParams.get("category");
  const instId = searchParams.get("instId") ?? selectedInstitutionId ?? null;
  const topic = fee ? getDisplayName(fee).replace(/\s*\([^)]*\)\s*$/, "").toLowerCase() : null;
  const placeholder = topic
    ? `Ask Hamilton about ${topic}: what changes if we match the market?`
    : "Ask Hamilton: how does our overdraft fee compare in our counties?";

  if (!open) {
    return (
      <div className="fixed bottom-4 right-4 z-30 print:hidden sm:right-6">
        <button
          ref={pillRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="flex items-center gap-2 rounded-full border border-warm-ink-700 bg-warm-ink-900 py-2 pl-3 pr-4 text-sm font-medium text-warm-ink-50 shadow-lg hover:bg-warm-ink-800"
        >
          <span aria-hidden style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            H
          </span>
          Ask Hamilton
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-4 print:hidden sm:px-6">
      <form
        method="get"
        action="/pro/analyze"
        role="search"
        aria-label="Ask Hamilton"
        onSubmit={() => setSending(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-warm-ink-700 bg-warm-ink-900 p-2 pl-4 shadow-2xl"
      >
        <span aria-hidden className="text-sm text-warm-ink-50" style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
          H
        </span>
        <label htmlFor="hamilton-ask" className="sr-only">
          Ask Hamilton
        </label>
        <input
          ref={inputRef}
          id="hamilton-ask"
          name="q"
          required
          maxLength={500}
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-warm-ink-50 placeholder:text-warm-ink-300 focus:outline-none"
        />
        <input type="hidden" name="send" value="1" />
        {instId ? <input type="hidden" name="instId" value={instId} /> : null}
        <button
          type="submit"
          disabled={sending}
          className="min-h-11 rounded-lg bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-60"
        >
          {sending ? "Opening…" : "Ask"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close Ask Hamilton"
          className="min-h-11 min-w-11 rounded-lg px-2 py-2 text-sm text-warm-ink-300 hover:text-warm-ink-50"
        >
          ✕
        </button>
      </form>
    </div>
  );
}
