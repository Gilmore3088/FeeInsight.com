"use client";

import Link from "next/link";

/** The one error screen, used by the root and public error boundaries. */
export function ErrorContent({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#6B6255]">Error</p>
      <h1
        className="mt-2 text-[1.75rem] tracking-[-0.02em] text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Something went wrong
      </h1>
      <p className="mt-3 text-[14px] text-[#6B6255]">We hit an unexpected error loading this page. Please try again.</p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-[#C44B2E] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#A93D25]"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-[#E8DFD1] bg-white/80 px-5 py-2.5 text-[13px] font-medium text-[#5A5347] no-underline transition-colors hover:border-[#C44B2E]/30 hover:text-[#A93D25]"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
