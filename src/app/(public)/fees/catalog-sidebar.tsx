import Link from "next/link";
import type { FeeCategorySummary } from "@/lib/data-store";
import { familySectionId } from "./family-section";
import { GLASS, GLASS_SOFT } from "@/components/public/site-look";

const EYEBROW = "text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]";
const CARD = `p-5 ${GLASS}`;
const CARD_SOFT = `p-5 ${GLASS_SOFT}`;

const GO_DEEPER_LINKS = [
  { label: "National benchmarks", href: "/research/national-fee-index" },
  { label: "State & district reports", href: "/research" },
  { label: "Consumer guides", href: "/guides" },
  { label: "API documentation", href: "/api-docs" },
];

interface CatalogSidebarProps {
  familyOrder: string[];
  byFamily: Map<string, FeeCategorySummary[]>;
  /** Kept for callers; the spotlight medians are shown as the page's top cards instead. */
  spotlightFees?: FeeCategorySummary[];
  statesLabel: string;
}

/**
 * The /fees side panel at desktop widths: a sticky "on this page" list of the fee families,
 * then where to go next and what the figures are drawn from, as /subscribe-style glass boxes.
 * The spotlight medians are already the cards at the top of the page, so they are not repeated.
 */
export function CatalogSidebar({ familyOrder, byFamily, statesLabel }: CatalogSidebarProps) {
  return (
    <aside aria-label="Fee index navigation" className="hidden space-y-5 self-start xl:sticky xl:top-20 xl:block">
      <div className={CARD}>
        <p className={EYEBROW}>On this page</p>
        <nav aria-label="Fee families" className="mt-3 space-y-0.5">
          {familyOrder.map((familyName) => {
            const cats = byFamily.get(familyName);
            if (!cats || cats.length === 0) return null;
            return (
              <a
                key={familyName}
                href={`#${familySectionId(familyName)}`}
                className="group flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#3D3830] transition-colors duration-200 hover:bg-[#F3EEE6] hover:text-[#1A1815]"
              >
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#C44B2E]" />
                {familyName}
                <span className="ml-auto text-xs [font-variant-numeric:tabular-nums] text-[#5A5347]">
                  {cats.length} <span className="sr-only">{cats.length === 1 ? "fee" : "fees"}</span>
                </span>
              </a>
            );
          })}
        </nav>
      </div>

      <div className={CARD_SOFT}>
        <p className={EYEBROW}>Go deeper</p>
        <ul className="mt-2 space-y-0.5">
          {GO_DEEPER_LINKS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex min-h-9 items-center justify-between gap-2 rounded-lg px-2.5 text-sm font-medium text-[#1A1815] transition-colors duration-200 hover:bg-[#F3EEE6] hover:text-[#A93D25]"
              >
                {item.label}
                <span aria-hidden="true" className="text-[#A93D25]">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className={CARD_SOFT}>
        <p className={EYEBROW}>Sources and coverage</p>
        <ul className="mt-3 space-y-1.5 text-sm text-[#3D3830]">
          <li>Published fee schedules</li>
          <li>FDIC Call Reports and NCUA 5300 Reports</li>
          <li>Institution websites</li>
        </ul>
        <ul className="mt-3 space-y-1.5 border-t border-[#E8E1D6] pt-3 text-sm text-[#3D3830]">
          <li>Banks and credit unions, all asset tiers</li>
          <li>All 12 Fed districts</li>
          <li>{statesLabel} states</li>
        </ul>
      </div>
    </aside>
  );
}
