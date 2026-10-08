"use client";

import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/constants";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

/**
 * Shown when a Hamilton screen fails to load: plain language, a retry, and a way out. It uses the
 * site's own colour tokens because /pro/error.tsx renders it outside the Hamilton shell, where the
 * shell's variables don't exist (the Try again button was white on nothing).
 */
export function HamiltonErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="mx-auto max-w-xl bg-warm-50 px-6 py-16 text-center">
      <h2 className="text-2xl text-warm-900" style={SERIF}>
        This screen didn&apos;t load
      </h2>
      <p className="mt-3 text-sm text-warm-700">
        Hamilton couldn&apos;t reach the data it needs. Your saved work is safe. Try again, or go back to This month.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="min-h-11 rounded-md bg-terra px-4 py-2 text-sm font-semibold text-white hover:bg-terra-dark"
        >
          Try again
        </button>
        <Link
          href="/pro/hamilton"
          className="inline-flex min-h-11 items-center rounded-md border border-warm-300 px-4 py-2 text-sm text-warm-900 hover:border-warm-500"
        >
          Back to This month
        </Link>
      </div>
      <p className="mt-6 text-xs text-warm-600">
        If this keeps happening, email {CONTACT_EMAIL}
        {error.digest ? ` and mention reference ${error.digest}` : ""}.
      </p>
    </div>
  );
}
