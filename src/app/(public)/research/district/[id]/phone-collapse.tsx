"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A context section that starts open on wide screens and closed on phones, so the economy,
 * income and market detail sits behind its heading instead of a long scroll. The heading
 * stays a real heading inside the summary.
 */
export function PhoneCollapse({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia("(max-width: 639px)").matches) ref.current.open = false;
  }, []);
  return (
    <details ref={ref} open className="group space-y-3">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">{summary}</div>
        <span aria-hidden="true" className="mt-1 text-[18px] leading-none text-ink-muted transition-transform group-open:rotate-90 sm:hidden">
          &rsaquo;
        </span>
      </summary>
      {children}
    </details>
  );
}
