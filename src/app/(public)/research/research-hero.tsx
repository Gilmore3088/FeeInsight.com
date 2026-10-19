import Link from "next/link";
import { PRODUCT_NAME, REPORT_OFFER } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { SectionJump } from "./section-jump";
import { PageHero } from "@/components/public/page-hero";

const SERIF = { fontFamily: "var(--fi-font-sans)" };

export const RESEARCH_SECTIONS = [
  { id: "findings", label: "Key findings" },
  { id: "explore", label: "Explore your market" },
  { id: "benchmarks", label: "National benchmarks" },
  { id: "economic-data", label: "Economic data" },
  { id: "apply", label: "For your institution" },
  { id: "about-data", label: "Methodology" },
] as const;

/**
 * The hub's opening on the shared curved navy hero (PageHero): what the page is, its coverage
 * and the date of the data. The findings follow straight after.
 */
export function ResearchHero({ summary, sampleHref }: { summary: PublicStatsSummary; sampleHref?: string | null }) {
  return (
    <PageHero
      eyebrow={`${PRODUCT_NAME} research`}
      title="Bank fee research"
      lede={<>National and regional benchmarks, read from each bank&apos;s and credit union&apos;s own published fee schedule.</>}
    >
      <p className="text-[14px] font-semibold tabular-nums text-white">
        {summary.institutionsLabel} institutions <span aria-hidden="true" className="px-1 text-white/50">·</span>{" "}
        {summary.categoriesLabel} fee categories
      </p>
      <p className="mt-1 text-[13px] text-[#c9d6de]">{summary.freshnessLabel}</p>
      {sampleHref && (
        <Link
          href={sampleHref}
          className="mt-5 inline-flex min-h-11 items-center rounded-full bg-white px-5 text-[14px] font-semibold text-ink hover:bg-paper"
        >
          See the sample {REPORT_OFFER.name}
        </Link>
      )}
    </PageHero>
  );
}

/** Sticky jump bar under the hero so a long page stays navigable. */
export function ResearchSectionNav({
  sections = RESEARCH_SECTIONS,
  label = "Research sections",
}: {
  sections?: readonly { id: string; label: string }[];
  label?: string;
} = {}) {
  return (
    <nav aria-label={label} className="print:hidden sticky top-14 z-30 border-b border-border bg-paper/95 backdrop-blur">
      <div className="mx-auto max-w-page px-4 py-2 sm:hidden">
        <SectionJump sections={sections} label={label} />
      </div>
      <ul className="mx-auto hidden max-w-page flex-wrap gap-1 px-4 py-1 sm:flex sm:px-6">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              className="inline-flex min-h-11 items-center rounded-full px-3.5 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-ink hover:text-white"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Shared section heading: eyebrow, serif title, one-line explainer. */
export function SectionHeading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brick">{eyebrow}</p>
        <h2 className="mt-1.5 text-[1.6rem] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[2rem]" style={SERIF}>
          {title}
        </h2>
        {children && <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}
