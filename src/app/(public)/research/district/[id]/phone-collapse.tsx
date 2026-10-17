"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A context section that is always open on wide screens and closed on phones behind a visible
 * "View ..." button, so the economy, income and market detail sits behind its heading instead of
 * a long scroll. The heading stays a real heading above the button.
 */
export function PhoneCollapse({ summary, label, children }: { summary: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="space-y-8">
      <div>
        {summary}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-ink/30 px-4 text-[14px] font-semibold text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:hidden"
        >
          {open ? `Hide ${label}` : `View ${label}`}
          <span aria-hidden="true">{open ? "↑" : "↓"}</span>
        </button>
      </div>
      <div id={id} className={open ? "space-y-8" : "hidden space-y-8 sm:block"}>
        {children}
      </div>
    </div>
  );
}
