"use client";

import { useState, useTransition } from "react";
import { setAccountEmail } from "./email-actions";
import type { AccountEmailKind } from "./email-kinds";

/** One on/off switch for a Pro email. Flips at once and flips back if the save fails. */
export function EmailSwitch({
  kind,
  label,
  description,
  initialOn,
}: {
  kind: AccountEmailKind;
  label: string;
  description: string;
  initialOn: boolean;
}) {
  const [on, setOn] = useState(initialOn);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `email-${kind}`;

  function toggle() {
    const next = !on;
    setOn(next);
    setError(null);
    startTransition(async () => {
      const result = await setAccountEmail(kind, next);
      if (!result.ok) {
        setOn(!next);
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-[15px] font-medium text-[#1A1815]">
          {label}
        </p>
        <p id={`${id}-desc`} className="mt-0.5 text-[13px] text-[#6B6255]">
          {description}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-[12px] text-red-700">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-desc`}
        disabled={pending}
        onClick={toggle}
        className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C44B2E] focus-visible:ring-offset-2 disabled:opacity-60 ${
          on ? "bg-[#C44B2E]" : "bg-[#D8CDBD]"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
