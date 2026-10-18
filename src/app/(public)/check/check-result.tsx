import Link from "next/link";
import { ArrowRight, Banknote, CalendarDays, Landmark, ReceiptText, Send, TrendingDown, TrendingUp, Undo2, Wallet } from "lucide-react";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { SERIF } from "@/app/landing-shared";
import { lowerLabel, type CheckCounts, type CheckRow } from "./check-data";

/** One icon per charge, the same set /consumer's charge tiles use; anything else gets a receipt. */
export function FeeIcon({ category, className }: { category: string; className?: string }) {
  const props = { "aria-hidden": true, className, strokeWidth: 1.75 } as const;
  switch (category) {
    case "overdraft":
      return <Wallet {...props} />;
    case "nsf":
      return <Undo2 {...props} />;
    case "atm_non_network":
      return <Banknote {...props} />;
    case "wire_domestic_outgoing":
      return <Send {...props} />;
    case "monthly_maintenance":
      return <CalendarDays {...props} />;
    default:
      return <ReceiptText {...props} />;
  }
}

/** "Monthly Maintenance" and "Overdraft (OD)" as "Monthly maintenance" and "Overdraft" on a chip. */
function sentenceLabel(label: string): string {
  return lowerLabel(label).replace(/^./, (c) => c.toUpperCase());
}

function placeOf(level: CheckCounts["level"], stateName: string | null): string {
  if (level === "state" && stateName) return `${stateName} medians`;
  if (level === "mixed" && stateName) return `${stateName} and U.S. medians`;
  return "U.S. medians";
}

/**
 * The result as one figure (the institution page's "16 / 24 compared fees above the median"),
 * with one chip: the fee furthest above its median, or how the rest sit when none is above.
 */
export function ResultStat({
  counts,
  chip,
  stateName,
  size = "lg",
  center = true,
}: {
  counts: CheckCounts;
  chip: { label: string; gap: string } | null;
  stateName: string | null;
  size?: "lg" | "md";
  /** Centered on a phone, as the page header is; false where the block reads left-aligned. */
  center?: boolean;
}) {
  const figure = size === "lg" ? "text-[64px] sm:text-[84px]" : "text-[52px] sm:text-[64px]";
  return (
    <div className="fi-home-fade">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Compared with {placeOf(counts.level, stateName)}</p>
      <p className={`mt-1 font-medium leading-none tracking-[-0.02em] text-ink [font-variant-numeric:tabular-nums] ${figure}`} style={SERIF}>
        {counts.above}
        <span className="mx-2 font-normal text-ink-muted" aria-hidden="true">
          /
        </span>
        <span className="sr-only"> of </span>
        {counts.compared}
      </p>
      <p className="mt-2 text-[16px] text-ink sm:text-[18px]">main fees above the median</p>
      <p className={`mt-3 flex flex-wrap gap-2 ${center ? "justify-center sm:justify-start" : ""}`}>
        {chip ? (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-above-market/10 px-3 py-1.5 text-left text-[13px] font-semibold text-above-market">
            <TrendingUp aria-hidden="true" className="size-4 shrink-0" />
            <span className="min-w-0">
              {sentenceLabel(chip.label)}: {chip.gap}
            </span>
          </span>
        ) : null}
        {(counts.below > 0 || counts.same > 0) && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-below-market/10 px-3 py-1.5 text-[13px] font-semibold text-below-market">
            <TrendingDown aria-hidden="true" className="size-4 shrink-0" />
            {counts.below} below
            {counts.same > 0 ? `, ${counts.same} about the same` : ""}
          </span>
        )}
      </p>
    </div>
  );
}

/** "Ways to avoid" as one row of icon chips, one per compared fee that has a guide. */
export function AvoidChips({ rows, guideHrefs }: { rows: CheckRow[]; guideHrefs: Record<string, string | null> }) {
  const chips = rows.flatMap((row) => {
    const href = guideHrefs[row.category];
    return href ? [{ row, href }] : [];
  });
  if (chips.length === 0) return null;
  return (
    <nav aria-label="Ways to avoid these fees" className="min-w-0">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Ways to avoid</p>
      <ul className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
        {chips.map(({ row, href }) => {
          return (
            <li key={row.category}>
              <Link
                href={href}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-0 px-4 text-[14px] font-medium text-ink hover:border-ink"
              >
                <FeeIcon category={row.category} className="size-4 text-brick" />
                {sentenceLabel(row.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** "Work at <institution>? Explore Hamilton." The one Hamilton action, for a visitor who works there. */
export function HamiltonEmployeeBand({ name, placement }: { name: string; placement: string }) {
  return (
    <aside
      aria-label="For bank and credit union teams"
      className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-0 px-4 py-3 text-center shadow-fi-1 sm:flex-row sm:justify-between sm:text-left"
    >
      <p className="flex min-w-0 items-center gap-3 text-[15px] font-semibold text-ink">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brick-tint text-brick">
          <Landmark className="size-[18px]" strokeWidth={1.75} />
        </span>
        <span className="min-w-0">Work at {name}?</span>
      </p>
      <TrackLink
        event="upgrade_click"
        eventProps={{ placement }}
        href={PRO_PLANS_NAV.href}
        className="fi-btn fi-btn-brick inline-flex min-h-11 shrink-0 items-center gap-2 px-5 text-[14px]"
      >
        Explore Hamilton
        <ArrowRight aria-hidden="true" className="size-4" />
      </TrackLink>
    </aside>
  );
}
