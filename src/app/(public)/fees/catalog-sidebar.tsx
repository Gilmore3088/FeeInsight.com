import Link from "next/link";
import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName, FAMILY_COLORS } from "@/lib/fee-taxonomy";
import { familySectionId, money } from "./family-section";

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]";
const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };
const CARD = "rounded-xl border border-[#E8DFD1] bg-white/80 backdrop-blur-sm px-4 py-4";
const MAX_KEY_BENCHMARKS = 6;

const GO_DEEPER_LINKS = [
  { label: "National benchmarks", href: "/research/national-fee-index" },
  { label: "State & district reports", href: "/research" },
  { label: "Consumer guides", href: "/guides" },
  { label: "API documentation", href: "/api-docs" },
];

interface CatalogSidebarProps {
  familyOrder: string[];
  byFamily: Map<string, FeeCategorySummary[]>;
  spotlightFees: FeeCategorySummary[];
  statesLabel: string;
}

export function CatalogSidebar({ familyOrder, byFamily, spotlightFees, statesLabel }: CatalogSidebarProps) {
  return (
    <aside className="hidden xl:block space-y-5 sticky top-20 self-start">
      <div className={CARD}>
        <p className={EYEBROW}>Jump to Family</p>
        <nav aria-label="Fee families" className="mt-3 space-y-1">
          {familyOrder.map((familyName) => {
            const cats = byFamily.get(familyName);
            if (!cats || cats.length === 0) return null;
            const colorBg = FAMILY_COLORS[familyName]?.dot ?? "bg-[#A09788]";
            return (
              <a
                key={familyName}
                href={`#${familySectionId(familyName)}`}
                className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-[#6B6255] transition-colors hover:bg-[#FAF7F2] hover:text-[#1A1815]"
              >
                <span className={`inline-block h-2 w-2 rounded-full ${colorBg}`} />
                {familyName}
                <span className="ml-auto text-[11px] tabular-nums text-[#6B6255]">{cats.length}</span>
              </a>
            );
          })}
        </nav>
      </div>

      <div className={`${CARD} relative overflow-hidden`}>
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#C44B2E]/30 to-transparent" />
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">Key Benchmarks</p>
        <div className="mt-3 space-y-3">
          {spotlightFees.slice(0, MAX_KEY_BENCHMARKS).map((fee) => (
            <Link key={fee.fee_category} href={`/fees/${fee.fee_category}`} className="block group no-underline">
              <span className="text-[11px] text-[#6B6255] group-hover:text-[#A93D25] transition-colors">
                {getDisplayName(fee.fee_category)}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-lg tabular-nums font-light text-[#1A1815]" style={SERIF}>
                  {money(fee.median_amount)}
                </span>
                <span className="text-[11px] text-[#6B6255]">median</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className={CARD}>
        <p className={EYEBROW}>Go Deeper</p>
        <div className="mt-3 space-y-2">
          {GO_DEEPER_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-1.5 text-[13px] text-[#6B6255] hover:text-[#A93D25] transition-colors"
            >
              <span className="h-1 w-1 rounded-full bg-[#D4C9BA] shrink-0" />
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[#E8DFD1] bg-[#FAF7F2]/50 px-4 py-4">
        <p className={EYEBROW}>Data Sources</p>
        <ul className="mt-2 space-y-1 text-[12px] text-[#6B6255]">
          <li>Published fee schedules</li>
          <li>FDIC Call Reports</li>
          <li>NCUA 5300 Reports</li>
          <li>Institution websites</li>
        </ul>
        <div className="mt-3 border-t border-[#E8DFD1]/60 pt-2">
          <p className={EYEBROW}>Coverage</p>
          <ul className="mt-1.5 space-y-1 text-[12px] text-[#6B6255]">
            <li>Banks + Credit Unions</li>
            <li>All asset tiers</li>
            <li>All 12 Fed districts</li>
            <li>{statesLabel} states</li>
          </ul>
        </div>
      </div>
    </aside>
  );
}
