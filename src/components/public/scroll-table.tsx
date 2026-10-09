import type { ReactNode } from "react";

/**
 * A wide data table that may be panned sideways inside its own box, never the page.
 *
 * - The region is focusable (tabIndex 0) with an accessible name, so a keyboard user can
 *   Tab to it and scroll it with the arrow keys; the focus ring is drawn inset so the
 *   card's rounded, clipped edge cannot hide it. The global `*:focus-visible` rule is
 *   unlayered, so the offset and radius here need Tailwind's important modifier.
 * - A written cue says the table scrolls. It shows only while the table is wider than its
 *   box: the card is a size container and the cue appears below the table's minimum width
 *   (`minWidth`). The right-edge fade from `.table-scroll` stays as a second signal.
 *
 * Tailwind only generates class names it can read in the source, so the min-width and the
 * matching cue threshold are picked from a fixed list instead of built from a number.
 */
const WIDTHS = {
  "520": { table: "min-w-[520px]", cue: "@max-[520px]:block" },
  "560": { table: "min-w-[560px]", cue: "@max-[560px]:block" },
  "640": { table: "min-w-[640px]", cue: "@max-[640px]:block" },
  "720": { table: "min-w-[720px]", cue: "@max-[720px]:block" },
} as const;

export type ScrollTableWidth = keyof typeof WIDTHS;

export function ScrollTable({
  label,
  minWidth = "560",
  children,
  className = "",
}: {
  /** Names the scroll region for screen readers, e.g. "Overdraft fee by Federal Reserve district". */
  label: string;
  /** Narrowest the table may get before it scrolls, in CSS px. */
  minWidth?: ScrollTableWidth;
  /** The table's caption, thead and tbody; the table element is supplied here. */
  children: ReactNode;
  className?: string;
}) {
  const width = WIDTHS[minWidth];
  return (
    <div
      className={`@container overflow-hidden rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm ${className}`}
    >
      <p
        aria-hidden="true"
        className={`hidden ${width.cue} border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60 px-4 py-2 text-[12px] font-medium text-[#5A5347]`}
      >
        Scroll sideways to see every column &rarr;
      </p>
      <div
        role="region"
        aria-label={`${label} (scrolls sideways)`}
        tabIndex={0}
        className="table-scroll focus-visible:rounded-xl! focus-visible:outline-offset-[-2px]!"
      >
        <table className={`w-full text-left text-sm ${width.table}`}>{children}</table>
      </div>
    </div>
  );
}
