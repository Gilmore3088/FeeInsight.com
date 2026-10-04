"use client";

import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/constants";

/** Shown when a Hamilton screen fails to load: plain language, a retry, and a way out. */
export function HamiltonErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="mx-auto max-w-xl px-6 py-16 text-center">
      <h2
        className="text-2xl"
        style={{ fontFamily: "var(--hamilton-font-serif)", color: "var(--hamilton-text-primary)" }}
      >
        This screen didn&apos;t load
      </h2>
      <p className="mt-3 text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
        Hamilton couldn&apos;t reach the data it needs. Your saved work is safe. Try again, or go back to the
        briefing.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: "var(--hamilton-primary)" }}
        >
          Try again
        </button>
        <Link href="/pro/hamilton" className="rounded-md border px-4 py-2 text-sm" style={{ color: "var(--hamilton-text-primary)" }}>
          Back to briefing
        </Link>
      </div>
      <p className="mt-6 text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>
        If this keeps happening, email {CONTACT_EMAIL}
        {error.digest ? ` and mention reference ${error.digest}` : ""}.
      </p>
    </div>
  );
}
