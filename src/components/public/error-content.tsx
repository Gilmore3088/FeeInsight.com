"use client";

import Link from "next/link";

/** The one error screen, used by the root and public error boundaries. */
export function ErrorContent({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted">Error</p>
      <h1
        className="font-extrabold mt-2 text-[1.75rem] tracking-[-0.02em] text-ink"
        style={{ fontFamily: "var(--fi-font-sans)" }}
      >
        Something went wrong
      </h1>
      <p className="mt-3 text-[14px] text-ink-muted">We hit an unexpected error loading this page. Please try again.</p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-brick px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-brick-ink"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-border bg-white/80 px-5 py-2.5 text-[13px] font-medium text-ink-soft no-underline transition-colors hover:border-brick/30 hover:text-brick"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
