"use client";

import { useFormStatus } from "react-dom";

/** The pay button re-checks the market and then opens Stripe; say so while that runs. */
export function PayButton({ label, className }: { label: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className} disabled:opacity-60`}>
      {pending ? "Opening secure checkout…" : label}
    </button>
  );
}
