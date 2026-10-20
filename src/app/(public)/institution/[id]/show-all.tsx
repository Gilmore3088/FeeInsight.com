"use client";

import { useState } from "react";

/**
 * Wraps a list whose rows past the first few carry the `group-data-[all=true]/fees` classes:
 * one button opens the rest. Starts open when the reader arrived for a fee further down.
 */
export function ShowAll({
  total,
  shown,
  initialAll = false,
  aside = null,
  tabbed = false,
  children,
}: {
  total: number;
  shown: number;
  initialAll?: boolean;
  /** Sits at the end of the "Show all" row, such as a correction link; shown either way. */
  aside?: React.ReactNode;
  /**
   * The list sits in Personal / Business tabs. `total` counts each fee once, while a fee for
   * both is listed in each tab, so the tabs' rows can add up to more than the total (#1592).
   */
  tabbed?: boolean;
  children: React.ReactNode;
}) {
  const [all, setAll] = useState(initialAll || total <= shown);
  return (
    <div data-all={all} className="group/fees">
      {children}
      {(!all || aside) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {!all && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <button
                type="button"
                onClick={() => setAll(true)}
                className="inline-flex min-h-12 items-center rounded-full border border-ink px-6 text-[14px] font-semibold text-ink hover:bg-surface-0"
              >
                Show all {total} fees
              </button>
              <span className="text-[13px] text-ink-muted">
                {tabbed
                  ? `Showing the first ${shown} in each tab. ${total} fees in all, each counted once; a fee for personal and business accounts is listed in both tabs.`
                  : `Showing ${shown} of ${total} fees.`}
              </span>
            </div>
          )}
          {aside}
        </div>
      )}
    </div>
  );
}
