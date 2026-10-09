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
      className={`flex flex-col gap-3 rounded-2xl bg-white/70 px-6 py-5 ring-1 ring-[#E8E1D6]/80 shadow-[0_8px_32px_-12px_rgba(26,24,21,0.22),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl print:hidden sm:flex-row sm:items-center sm:justify-between sm:px-8 ${className}`}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">Fee Insight Pro</p>
        <p className="mt-1 text-[15px] font-semibold text-[#1A1815]">Need this every month, for your whole team?</p>
        <p className="mt-1 text-[13px] leading-relaxed text-[#5A5347]">
          Pro gives up to 5 people the Hamilton workspace: your fees against peers you pick, a watchlist of competitor
          fee changes, and cited board-ready reports.
        </p>
      </div>
      <Link
        href={PRO_PLANS_HREF}
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-white/70 px-5 py-2.5 text-sm font-semibold text-[#A93D25] ring-1 ring-[#C44B2E]/50 transition-colors duration-200 hover:bg-white"
      >
        See Pro plans
      </Link>
    </div>
  );
}
