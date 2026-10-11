import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/constants";
import { PrintButton } from "./print-button";
import type { PublicStatsSummary } from "@/lib/public-stats";

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

/** Light glass hero (the /subscribe look): what this page is, the live counts behind it, and where to jump. */
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
    <section aria-labelledby="research-title" className="relative">
      <div className="relative mx-auto grid max-w-page items-end gap-10 px-6 pb-10 pt-12 sm:pb-12 sm:pt-16 xl:grid-cols-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">Research</p>
          <h1
            id="research-title"
            className="mt-3 max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight text-[#1A1815] sm:text-5xl"
          >
            What banks and credit unions actually charge
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[#3D3830]">
            National benchmarks, state and Federal Reserve district coverage, and original studies from the{" "}
            {PRODUCT_NAME}. Every number on this page comes from verified, published fee schedules.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 text-[13px]">
            <span className="inline-flex items-center gap-2 text-[#5A5347]">
              <span aria-hidden="true" className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7FB77E] opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4F6B3A]" />
              </span>
              {summary.freshnessLabel}
            </span>
            <Link
              href="/research/national-fee-index"
              className="inline-flex min-h-11 items-center rounded-lg bg-[#C44B2E] px-4 py-2 font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#A93D25]"
            >
              Open the full {PRODUCT_NAME} &rarr;
            </Link>
            <Link href="/methodology" className="inline-flex min-h-11 items-center font-semibold text-[#A93D25] underline underline-offset-2 hover:text-[#8E2A17]">
              Methodology
            </Link>
            <PrintButton className="inline-flex min-h-11 items-center rounded-lg bg-white/70 px-4 py-2 font-semibold text-[#1A1815] ring-1 ring-[#E8E1D6] transition-colors duration-200 hover:bg-white print:hidden" />
          </div>
        </div>

        <dl className="grid grid-cols-2 items-stretch gap-3 sm:gap-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/75 ring-1 ring-[#E8E1D6]/80 shadow-[0_12px_40px_-12px_rgba(26,24,21,0.25),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl flex h-full flex-col px-5 py-5">
              <dt className="order-2 mt-2 text-[13px] font-semibold text-[#1A1815]">{s.label}</dt>
              <dd className="order-1 text-[2rem] font-bold leading-none tracking-tight text-[#1A1815] [font-variant-numeric:tabular-nums] sm:text-[2.5rem]">
                {s.value}
              </dd>
              <dd className="order-3 mt-0.5 text-[12px] text-[#5A5347]">{s.note}</dd>
            </div>
          ))}
        </dl>
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
    <nav aria-label={label} className="print:hidden sticky top-14 z-30 border-y border-white/60 bg-[#F3EEE6]/80 backdrop-blur-md">
      <ul className="mx-auto flex max-w-page gap-1 overflow-x-auto px-6 py-2">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              className="flex min-h-9 items-center rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-[#3D3830] transition-colors duration-200 hover:bg-white hover:text-[#A93D25]"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Shared section heading: eyebrow, title in the page font, one-line explainer. */
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
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#1A1815] sm:text-3xl">
          {title}
        </h2>
        {children && <p className="mt-2 text-[15px] leading-relaxed text-[#3D3830]">{children}</p>}
      </div>
      {action}
    </div>
  );
}
