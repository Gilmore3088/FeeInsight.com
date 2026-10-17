import Link from "next/link";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";

/** Where the Pro strip's link goes: the Pro plans on /subscribe (below Free and Report on a phone). */
export const PRO_PLANS_HREF = "/subscribe#pro";

/**
 * The ongoing next step after a free report or a bank page: Hamilton, the Pro workspace.
 * No price here; /subscribe owns it, so this stays right when prices change.
 */
export function ProNextStep({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border border-border bg-white px-6 py-5 print:hidden sm:flex-row sm:items-center sm:justify-between sm:px-8 ${className}`}
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Hamilton</p>
        <p className="mt-1 text-[15px] font-semibold text-ink">Need this every month, for your whole team?</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Hamilton, the Fee Insight workspace, gives up to {WORKSPACE_SEAT_LIMIT} people your fees against your
          market, a watchlist of the competitors you pick, and cited reports for the board.
        </p>
      </div>
      <Link
        href={PRO_PLANS_HREF}
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-brick px-5 py-2.5 text-sm font-semibold text-brick hover:bg-surface-200"
      >
        See Hamilton plans
      </Link>
    </div>
  );
}
