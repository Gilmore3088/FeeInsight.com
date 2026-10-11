import Link from "next/link";
import { BarChart2, ClipboardCheck, FileText, MessageSquareText } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import { CTA_PRIMARY, GLASS, GLASS_SOFT, TEXT_LINK } from "@/components/public/site-look";
import type { PublicInstitutionProfileLinks } from "@/lib/institution-profile-links";
import { METHODOLOGY_COPY } from "./profile-copy";

const PRO_LINK_SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/15 hover:ring-white/40";

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
    <aside className="min-w-0 space-y-6 lg:sticky lg:top-6">
      {regulatorFacts.length > 0 && (
        <section className={`p-5 ${GLASS_SOFT}`}>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">Regulator</p>
          <dl className="mt-2 space-y-1.5 text-sm">
            {regulatorFacts.map((fact) => (
              <div key={fact.label} className="flex justify-between gap-3">
                <dt className="text-[#6B6255]">{fact.label}</dt>
                <dd className="text-right font-medium text-[#1A1815]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {showProCard && (
        <section className={`rounded-2xl bg-[#1A1815] p-5 text-white shadow-[0_12px_40px_-12px_rgba(26,24,21,0.35)] ring-1 ring-black/10`}>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#D4A574]">
            Fee Insight Pro
          </p>
          <h2 className="mt-2 text-lg font-semibold">Benchmark this institution in Hamilton</h2>
          <div className="mt-4 grid gap-2">
            <Link
              href={links.briefHref}
              className={CTA_PRIMARY}
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
            <p className="mt-3 text-xs text-[#E8DFD1]">Opens pricing first, then returns here.</p>
          )}
        </section>
      )}

      <div className="flex items-center gap-1.5 text-xs text-[#6B6255]">
        <span>How we verify fees</span>
        <InfoTip label="How we verify fees">
          <span className="block space-y-2">
            {METHODOLOGY_COPY.map((paragraph) => (
              <span key={paragraph} className="block">{paragraph}</span>
            ))}
          </span>
        </InfoTip>
        <span aria-hidden="true" className="text-[#D5CBBF]">·</span>
        <Link href="/methodology" className={TEXT_LINK}>
          Methodology
        </Link>
      </div>
    </aside>
  );
}
