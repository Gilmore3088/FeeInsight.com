"use client";

import { useFormStatus } from "react-dom";

/** The pay buttons re-check the market and then open Stripe; say so while that runs. */
export function PayButton({
  label,
  className,
  pendingLabel = "Opening secure checkout…",
}: {
  label: string;
  className: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className} disabled:opacity-60`}>
      {pending ? pendingLabel : label}
    </button>
  );
}
