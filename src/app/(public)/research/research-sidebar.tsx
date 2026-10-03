import Link from "next/link";
import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { SITE_NAME } from "@/lib/constants";
import { HAMILTON_CANONICAL } from "@/app/for-institutions/hamilton-copy";

const SECTION_LINKS = [
  { label: "National benchmarks", href: "#national-index" },
  { label: "Analysis previews", href: "#analysis" },
  { label: "State reports", href: "#states" },
  { label: "Fed districts", href: "#districts" },
  { label: "Original research", href: "#original-research" },
  { label: "Methodology", href: "#methodology" },
];

const EYEBROW = "text-[10px] font-semibold uppercase tracking-wider text-[#6B6255] mb-3";
const CARD = "rounded-xl border border-[#E8DFD1]/80 px-4 py-4";
const EXPLORE_LINK =
  "flex items-center gap-2 rounded px-2 py-1.5 text-[12px] text-[#6B6255] hover:bg-[#FAF7F2] hover:text-[#A93D25] transition-colors";
const MAX_QUICK_STATS = 4;

const PRO_BULLETS = [
  "Unlimited peer sets by charter, size and district",
  "FDIC/NCUA financial context on every peer",
  "Scenarios, board-ready reports, monitoring",
  "CSV exports (API access on request)",
];

interface ResearchSidebarProps {
  spotlightFees: FeeCategorySummary[];
  categoriesLabel: string;
}

export function ResearchSidebar({ spotlightFees, categoriesLabel }: ResearchSidebarProps) {
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-24 space-y-5">
        <nav className={CARD}>
          <p className={EYEBROW}>Research</p>
          <ul className="space-y-1.5">
            {SECTION_LINKS.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="block rounded px-2 py-1 text-[12px] text-[#6B6255] hover:bg-[#FAF7F2] hover:text-[#5A5347] transition-colors"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className={CARD}>
          <p className={EYEBROW}>Quick Stats</p>
          <div className="space-y-3">
            {spotlightFees.slice(0, MAX_QUICK_STATS).map((fee) => (
              <div key={fee.fee_category}>
                <p className="text-[11px] text-[#6B6255]">{getDisplayName(fee.fee_category)}</p>
                <p className="text-sm font-bold tabular-nums text-[#1A1815]">{formatAmount(fee.median_amount)}</p>
                {fee.p25_amount != null && fee.p75_amount != null && (
                  <p className="text-[10px] tabular-nums text-[#6B6255]">
                    P25 {formatAmount(fee.p25_amount)} &middot; P75 {formatAmount(fee.p75_amount)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={CARD}>
          <p className={EYEBROW}>Explore</p>
          <ul className="space-y-1.5">
            <li>
              <Link href="/fees" className={EXPLORE_LINK}>
                <span className="h-1 w-1 rounded-full bg-[#D4C9BA] shrink-0" />
                All {categoriesLabel} fee categories
              </Link>
            </li>
            <li>
              <Link href="/research/national-fee-index" className={EXPLORE_LINK}>
                <span className="h-1 w-1 rounded-full bg-[#D4C9BA] shrink-0" />
                National benchmarks
              </Link>
            </li>
            <li>
              <Link href="/guides" className={EXPLORE_LINK}>
                <span className="h-1 w-1 rounded-full bg-[#D4C9BA] shrink-0" />
                Consumer guides
              </Link>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-[#1A1815] bg-[#1A1815] px-4 py-4 text-white">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#F5EFE6]/80">
            {SITE_NAME} Pro
          </p>
          <p className="mt-1.5 text-[13px] font-semibold text-white">Hamilton workspace</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[#F5EFE6]/90">{HAMILTON_CANONICAL}</p>
          <ul className="mt-2.5 space-y-1.5 text-[12px] text-[#F5EFE6]/90">
            {PRO_BULLETS.map((bullet) => (
              <li key={bullet} className="flex items-start gap-1.5">
                <span className="mt-0.5 text-[#F5EFE6]">&#10003;</span>
                {bullet}
              </li>
            ))}
          </ul>
          <Link
            href="/subscribe"
            className="mt-3 block rounded-md bg-[#C44B2E] px-3 py-2 text-center text-[12px] font-semibold text-white no-underline hover:bg-[#A93D25] transition-colors"
          >
            See pricing
          </Link>
        </div>
      </div>
    </aside>
  );
}
