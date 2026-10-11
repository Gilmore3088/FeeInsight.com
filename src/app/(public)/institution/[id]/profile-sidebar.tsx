import Link from "next/link";
import { BarChart2, ClipboardCheck, FileText, MessageSquareText } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import type { PublicInstitutionProfileLinks } from "@/lib/institution-profile-links";
import { METHODOLOGY_COPY } from "./profile-copy";
import { GLASS, GLASS_SOFT } from "@/components/public/site-look";

const PRO_LINK_SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm font-semibold text-[#1A1815] ring-1 ring-[#E8E1D6] transition-colors duration-200 hover:bg-white hover:ring-[#C44B2E]/40";

export function ProfileSidebar({
  links,
  isAuthenticated,
  showAddSource,
  showProCard,
  regulatorFacts = [],
}: {
  /** Regulator identity from the regulatory registry; the block is hidden when empty. */
  regulatorFacts?: Array<{ label: string; value: string }>;
  links: PublicInstitutionProfileLinks;
  isAuthenticated: boolean;
  showAddSource: boolean;
  /** False on thin profiles (too few verified fees to benchmark). */
  showProCard: boolean;
}) {
  return (
    <aside className="min-w-0 space-y-5 lg:sticky lg:top-6">
      {regulatorFacts.length > 0 && (
        <section className={`p-5 ${GLASS_SOFT}`}>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">Regulator</h2>
          <dl className="mt-2 space-y-1.5 text-sm">
            {regulatorFacts.map((fact) => (
              <div key={fact.label} className="flex justify-between gap-3">
                <dt className="text-[#5A5347]">{fact.label}</dt>
                <dd className="text-right font-medium text-[#1A1815]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {showProCard && (
        <section className={`p-6 ${GLASS}`}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
            Fee Insight Pro
          </p>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-[#1A1815]">Benchmark this institution in Hamilton</h2>
          <div className="mt-4 grid gap-2">
            <Link
              href={links.briefHref}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#C44B2E] px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#A93D25]"
            >
              <BarChart2 className="h-4 w-4" />
              Generate competitive brief
            </Link>
            <Link href={links.analyzeHref} className={PRO_LINK_SECONDARY}>
              <MessageSquareText className="h-4 w-4" />
              Ask about this institution
            </Link>
            <Link href={links.scenarioHref} className={PRO_LINK_SECONDARY}>
              <FileText className="h-4 w-4" />
              Run scenario
            </Link>
            {showAddSource && (
              <Link href={links.correctSourceHref} className={PRO_LINK_SECONDARY}>
                <ClipboardCheck className="h-4 w-4" />
                Add a fee source
              </Link>
            )}
          </div>
          {!isAuthenticated && (
            <p className="mt-3 text-xs text-[#5A5347]">Opens pricing first, then returns here.</p>
          )}
        </section>
      )}

      <div className="flex items-center gap-1.5 px-1 text-xs text-[#5A5347]">
        <span>How we verify fees</span>
        <InfoTip label="How we verify fees">
          <span className="block space-y-2">
            {METHODOLOGY_COPY.map((paragraph) => (
              <span key={paragraph} className="block">{paragraph}</span>
            ))}
          </span>
        </InfoTip>
        <span aria-hidden="true" className="text-[#D5CBBF]">·</span>
        <Link href="/methodology" className="font-semibold text-[#A93D25] hover:text-[#8E2A17]">
          Methodology
        </Link>
      </div>
    </aside>
  );
}
