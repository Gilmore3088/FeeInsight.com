import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/constants";
import { PrintButton } from "./print-button";
import type { PublicStatsSummary } from "@/lib/public-stats";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

export const RESEARCH_SECTIONS = [
  { id: "findings", label: "Key findings" },
  { id: "benchmarks", label: "Benchmarks" },
  { id: "charters", label: "Banks vs CUs" },
  { id: "states", label: "States" },
  { id: "districts", label: "Fed districts" },
  { id: "library", label: "Studies & guides" },
  { id: "methodology", label: "How it's built" },
] as const;

interface ResearchHeroProps {
  summary: PublicStatsSummary;
  /** The 50 states (not DC or territories) with published fees. */
  stateCount: number;
  hasDc: boolean;
  territoryCount: number;
}

/** Dark editorial band: what this page is, the live counts behind it, and where to jump. */
export function ResearchHero({ summary, stateCount, hasDc, territoryCount }: ResearchHeroProps) {
  const extras = [hasDc ? "DC" : null, territoryCount > 0 ? `${territoryCount} territories` : null].filter(Boolean);
  const stats = [
    { value: summary.observationsLabel, label: "published fee entries", note: "each traced to a published schedule" },
    { value: summary.institutionsLabel, label: "institutions with published fees", note: `of ${summary.monitoredLabel} monitored` },
    { value: summary.categoriesLabel, label: "fee categories with published fees", note: "from overdraft to wires" },
    {
      value: String(stateCount),
      label: "states",
      note: extras.length > 0 ? `plus ${extras.join(" and ")}` : "with published fees",
    },
  ];

  return (
    <section className="relative overflow-hidden bg-[#1A1815] text-[#F5EFE6]">
      {/* Faint grid of bars as texture: decoration only, carries no data. */}
      <svg aria-hidden="true" className="pointer-events-none absolute -right-10 bottom-0 h-full w-[46rem] opacity-[0.07]" viewBox="0 0 460 300" preserveAspectRatio="xMaxYMax meet">
        {Array.from({ length: 18 }).map((_, i) => {
          const h = 40 + ((i * 53) % 220);
          return <rect key={i} x={i * 25} y={300 - h} width="14" height={h} rx="2" fill="#F5EFE6" />;
        })}
      </svg>

      <div className="relative mx-auto max-w-page px-4 pb-10 pt-12 sm:px-6 sm:pb-12 sm:pt-16">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#E8A48F]">
          <span aria-hidden="true" className="h-px w-8 bg-[#E8A48F]/60" />
          Research
        </p>
        <h1 className="mt-3 max-w-3xl text-[2.25rem] font-normal leading-[1.05] tracking-[-0.015em] text-white sm:text-[3.25rem]" style={SERIF}>
          What banks and credit unions actually charge
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[#F5EFE6]/80 sm:text-base">
          National benchmarks, state and Federal Reserve district coverage, and original studies from the{" "}
          {PRODUCT_NAME}. Every number on this page comes from verified, published fee schedules.
        </p>

        <dl className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-[#1A1815] px-5 py-5">
              <dt className="sr-only">{s.label}</dt>
              <dd>
                <span className="block text-[2rem] font-semibold leading-none tabular-nums text-white sm:text-[2.5rem]" style={SERIF}>
                  {s.value}
                </span>
                <span className="mt-2 block text-[13px] font-semibold text-[#F5EFE6]">{s.label}</span>
                <span className="mt-0.5 block text-[11px] text-[#F5EFE6]/60">{s.note}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-[12px]">
          <span className="inline-flex items-center gap-2 text-[#F5EFE6]/75">
            <span aria-hidden="true" className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7FB77E] opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7FB77E]" />
            </span>
            {summary.freshnessLabel}
          </span>
          <Link href="/research/national-fee-index" className="font-semibold text-[#E8A48F] hover:text-white">
            Open the full {PRODUCT_NAME} &rarr;
          </Link>
          <Link href="/methodology" className="text-[#F5EFE6]/75 hover:text-white">
            Methodology
          </Link>
          <PrintButton className="rounded-full border border-white/25 px-3.5 py-1.5 font-semibold text-white hover:bg-white/10 print:hidden" />
        </div>
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
    <nav aria-label={label} className="print:hidden sticky top-14 z-30 border-b border-[#E8DFD1] bg-[#FAF7F2]/95 backdrop-blur">
      <ul className="mx-auto flex max-w-page gap-1 overflow-x-auto px-4 py-2 sm:px-6">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              className="block rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-[#5A5347] transition-colors hover:bg-[#1A1815] hover:text-white"
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A93D25]">{eyebrow}</p>
        <h2 className="mt-1.5 text-[1.6rem] font-normal leading-tight tracking-[-0.01em] text-[#1A1815] sm:text-[2rem]" style={SERIF}>
          {title}
        </h2>
        {children && <p className="mt-2 text-[14px] leading-relaxed text-[#6B6255]">{children}</p>}
      </div>
      {action}
    </div>
  );
}
