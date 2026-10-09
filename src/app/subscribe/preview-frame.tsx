import type { ReactNode } from "react";

/** The window every /subscribe example sits in, matching the benchmark preview. */
export function PreviewFrame({ label, aside, children }: { label: string; aside?: string; children: ReactNode }) {
  return (
    <figure className="flex h-full flex-col overflow-hidden rounded-xl bg-white/70 backdrop-blur-xl ring-1 ring-[#E2E8F0]/80 shadow-[0_8px_32px_-12px_rgba(30,41,59,0.22),inset_0_1px_0_rgba(255,255,255,0.7)]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-[#E2E8F0]/80 bg-white/50 px-4 py-2.5 sm:px-5">
        <span className="flex items-center gap-2 text-sm font-semibold text-[#1E293B]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[#C44B2E]" />
          {label}
        </span>
        {aside && <span className="hidden text-xs text-[#556377] sm:inline">{aside}</span>}
      </figcaption>
      {children}
    </figure>
  );
}
