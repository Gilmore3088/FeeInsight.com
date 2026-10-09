import type { ReactNode } from "react";

/** The window every /subscribe example sits in, matching the benchmark preview. */
export function PreviewFrame({ label, aside, children }: { label: string; aside?: string; children: ReactNode }) {
  return (
    <figure className="flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(26,24,21,0.06),0_12px_32px_-16px_rgba(26,24,21,0.2)] ring-1 ring-[#E8E1D6]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-[#EDE6DB] bg-[#FBF9F5] px-4 py-2.5 sm:px-5">
        <span className="flex items-center gap-2 text-sm font-semibold text-[#1A1815]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[#C44B2E]" />
          {label}
        </span>
        {aside && <span className="hidden text-xs text-[#6B6255] sm:inline">{aside}</span>}
      </figcaption>
      {children}
    </figure>
  );
}
