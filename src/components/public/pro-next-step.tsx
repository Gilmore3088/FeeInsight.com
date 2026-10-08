import Link from "next/link";

/** Where the Pro strip's link goes: the Pro plans on /subscribe (below Free and Report on a phone). */
export const PRO_PLANS_HREF = "/subscribe#pro";

/**
 * The ongoing next step after a free report or a bank page: Fee Insight Pro.
 * No price here; /subscribe owns it, so this stays right when prices change.
 */
export function ProNextStep({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border border-[#E8DFD1] bg-white px-6 py-5 print:hidden sm:flex-row sm:items-center sm:justify-between sm:px-8 ${className}`}
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B6255]">Fee Insight Pro</p>
        <p className="mt-1 text-[15px] font-semibold text-[#1A1815]">Need this every month, for your whole team?</p>
        <p className="mt-1 text-[13px] leading-relaxed text-[#5A5347]">
          Pro gives up to 5 people the Hamilton workspace: your fees against peers you pick, a watchlist of competitor
          fee changes, and cited board-ready reports.
        </p>
      </div>
      <Link
        href={PRO_PLANS_HREF}
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#C44B2E] px-5 py-2.5 text-sm font-semibold text-[#A93D25] hover:bg-[#F4EFE7]"
      >
        See Pro plans
      </Link>
    </div>
  );
}
