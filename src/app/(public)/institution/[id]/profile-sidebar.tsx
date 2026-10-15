import Link from "next/link";
import { BarChart2, ClipboardCheck, FileText, MessageSquareText } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import type { PublicInstitutionProfileLinks } from "@/lib/institution-profile-links";
import { METHODOLOGY_COPY } from "./profile-copy";

const PRO_LINK_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-md border border-ink-soft px-3 py-2 text-sm font-semibold text-white transition-colors hover:border-[#D4A574]";

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
        <section className="border border-border bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">Regulator</p>
          <dl className="mt-2 space-y-1.5 text-sm">
            {regulatorFacts.map((fact) => (
              <div key={fact.label} className="flex justify-between gap-3">
                <dt className="text-ink-muted">{fact.label}</dt>
                <dd className="text-right font-medium text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {showProCard && (
        <section className="border border-ink bg-ink p-5 text-white">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#D4A574]">
            Hamilton
          </p>
          <h2 className="mt-2 text-lg font-semibold">Benchmark this institution in Hamilton</h2>
          <div className="mt-4 grid gap-2">
            <Link
              href={links.briefHref}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-paper px-3 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
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
            <p className="mt-3 text-xs text-border">Opens pricing first, then returns here.</p>
          )}
        </section>
      )}

      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <span>How we verify fees</span>
        <InfoTip label="How we verify fees">
          <span className="block space-y-2">
            {METHODOLOGY_COPY.map((paragraph) => (
              <span key={paragraph} className="block">{paragraph}</span>
            ))}
          </span>
        </InfoTip>
        <span aria-hidden="true" className="text-border">·</span>
        <Link href="/methodology" className="font-semibold text-brick hover:text-brick-ink">
          Methodology
        </Link>
      </div>
    </aside>
  );
}
