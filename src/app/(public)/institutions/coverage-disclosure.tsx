"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Map as MapIcon } from "lucide-react";

/**
 * The coverage-by-state section. With no search it shows in full; once a search or state filter
 * is on, the results come first and the section folds to one line with a control that opens it.
 */
export function CoverageDisclosure({
  collapsed,
  headingId,
  heading,
  title,
  summary,
  children,
}: {
  collapsed: boolean;
  /** The section's heading id: the folded line is the heading, so the section keeps its name. */
  headingId: string;
  /** The full section's heading, shown when it is not folded. */
  heading: ReactNode;
  title: string;
  /** The folded line's figure, e.g. "Median state: 40% published"; null leaves only the title. */
  summary: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!collapsed) {
    return (
      <>
        {heading}
        {children}
      </>
    );
  }
  return (
    <div>
      <h2 id={headingId}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border bg-surface-0 px-4 py-2 text-left transition-colors hover:border-ink/40"
        >
          <MapIcon aria-hidden="true" className="size-5 shrink-0 text-brick" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">{title}</span>
            {summary && <span className="block text-[13px] text-ink-muted">{summary}</span>}
          </span>
          <span className="shrink-0 text-[14px] font-medium text-ink">{open ? "Hide" : "Show"}</span>
          <ChevronDown
            aria-hidden="true"
            className={`size-4 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h2>
      <div id={panelId} hidden={!open} className={open ? "fi-reveal mt-6" : undefined}>
        {children}
      </div>
    </div>
  );
}
