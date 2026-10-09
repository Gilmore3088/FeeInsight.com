import type { ReactNode } from "react";
import { ScrollRegion } from "./scroll-region";

/**
 * A wide data table that may be panned sideways inside its own card, never the page.
 * The card's scroll region is keyboard-focusable and carries a written cue whenever the
 * table is wider than the card (ScrollRegion).
 *
 * Tailwind only generates class names it can read in the source, so the min-width and the
 * matching first-paint cue threshold are picked from a fixed list instead of built from a
 * number. The card is a size container, so that first-paint cue follows the card's width.
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
      <ScrollRegion
        label={label}
        initialCueClass={width.cue}
        cueClassName="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60 px-4 py-2 text-[12px] font-medium text-[#5A5347]"
      >
        <table className={`w-full text-left text-sm ${width.table}`}>{children}</table>
      </ScrollRegion>
    </div>
  );
}
