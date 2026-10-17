"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Detail kept behind a visible control: a full-width row with a chevron and a plain label, the
 * same disclosure the state page uses for its extra data. Closed on screen by default; it opens
 * for printing (Save as PDF) and returns to how the reader left it afterwards, since a closed
 * <details> prints closed.
 */
export function Disclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let wasOpen = false;
    const before = () => {
      if (!ref.current) return;
      wasOpen = ref.current.open;
      ref.current.open = true;
    };
    const after = () => {
      if (ref.current && !wasOpen) ref.current.open = false;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return (
    <details ref={ref} className="group/disc border-t border-border pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open/disc:rotate-90 print:hidden">
          &rsaquo;
        </span>
        {summary}
      </summary>
      <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-ink-soft">{children}</div>
    </details>
  );
}
