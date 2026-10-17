import Link from "next/link";
import { PRODUCT_NAME, REPORT_OFFER } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { SectionJump } from "./section-jump";

const SERIF = { fontFamily: "var(--fi-font-sans)" };

export const RESEARCH_SECTIONS = [
  { id: "find", label: "States and districts" },
  { id: "findings", label: "Findings" },
  { id: "benchmarks", label: "Benchmarks" },
  { id: "districts", label: "Fed districts" },
  { id: "in-progress", label: "In progress" },
  { id: "about-data", label: "About the data" },
] as const;

/**
 * Short dark band: what this page is and one live line of coverage. The full counts, the
 * methodology and the PDF sit in "About the data" so the findings come first.
 */
export function ResearchHero({ summary, sampleHref }: { summary: PublicStatsSummary; sampleHref?: string | null }) {
  return (
    <section className="bg-ink text-paper">
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-10 text-center sm:px-6 sm:pb-10 sm:pt-12">
        <h1 className="text-[2rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-white sm:text-[2.75rem]" style={SERIF}>
          Bank fee research
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-paper/80 sm:text-base">
          Findings and benchmarks from the {PRODUCT_NAME}, read from each bank&apos;s and credit union&apos;s own published fee schedule.
        </p>
        <p className="mt-4 text-[13px] font-semibold tabular-nums text-paper">
          {summary.institutionsLabel} institutions <span aria-hidden="true" className="px-1 text-paper/40">·</span>{" "}
          {summary.categoriesLabel} fee categories
        </p>
        <p className="mt-1 text-[12px] text-paper/60">{summary.freshnessLabel}</p>
        {sampleHref && (
          <Link
            href={sampleHref}
            className="mt-5 inline-flex min-h-11 items-center rounded-full bg-brick px-5 text-[14px] font-semibold text-white hover:bg-brick-ink"
          >
            See the sample {REPORT_OFFER.name}
          </Link>
        )}
      </div>
    </section>
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
