import type { ReactNode } from "react";

/**
 * Detail kept behind a visible control: a full-width row with a chevron and a plain label, the
 * same disclosure the state page uses for its extra data. Closed by default.
 */
export function Disclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group/disc border-t border-border pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open/disc:rotate-90">
          &rsaquo;
        </span>
        {summary}
      </summary>
      <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-ink-soft">{children}</div>
    </details>
  );
}
