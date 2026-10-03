import Link from "next/link";
import { BarChart2, ClipboardCheck, FileText, MessageSquareText } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import type { PublicInstitutionProfileLinks } from "@/lib/institution-profile-links";
import { METHODOLOGY_COPY } from "./profile-copy";

const PRO_LINK_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-md border border-[#5A5347] px-3 py-2 text-sm font-semibold text-white transition-colors hover:border-[#D4A574]";

export function ProfileSidebar({
  links,
  isAuthenticated,
  showAddSource,
  showProCard,
}: {
  links: PublicInstitutionProfileLinks;
  isAuthenticated: boolean;
  showAddSource: boolean;
  /** False on thin profiles (too few verified fees to benchmark). */
  showProCard: boolean;
}) {
  return (
    <aside className="min-w-0 space-y-6 lg:sticky lg:top-6">
      {showProCard && (
        <section className="border border-[#1A1815] bg-[#1A1815] p-5 text-white">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#D4A574]">
            Fee Insight Pro
          </p>
          <h2 className="mt-2 text-lg font-semibold">Benchmark this institution in Hamilton</h2>
          <div className="mt-4 grid gap-2">
            <Link
              href={links.briefHref}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[#C44B2E] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]"
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
        <Link href="/methodology" className="font-semibold text-[#A93D25] hover:text-[#8E2A17]">
          Methodology
        </Link>
      </div>
    </aside>
  );
}
