import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/constants";
import { PrintButton } from "./print-button";
import type { PublicStatsSummary } from "@/lib/public-stats";

const SERIF = { fontFamily: "var(--fi-font-sans)" };
const MONO_FIGURE = { fontFamily: "var(--fi-font-mono)" } as const;

export const RESEARCH_SECTIONS = [
  { id: "findings", label: "Key findings" },
  { id: "studies", label: "Studies" },
  { id: "benchmarks", label: "Benchmarks" },
  { id: "charters", label: "Banks vs CUs" },
  { id: "geography", label: "States & districts" },
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
    <section className="relative overflow-hidden bg-ink text-paper">
      <div className="relative mx-auto max-w-page px-4 pb-10 pt-12 sm:px-6 sm:pb-12 sm:pt-16">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e0716a]">
          <span aria-hidden="true" className="h-px w-8 bg-[#e0716a]/60" />
          Research
        </p>
        <h1 className="mt-3 max-w-3xl text-[2.25rem] font-extrabold leading-[1.05] tracking-[-0.015em] text-white sm:text-[3.25rem]" style={SERIF}>
          What published bank and credit union fees reveal
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-paper/80 sm:text-base">
          Findings, original studies and national benchmarks from the {PRODUCT_NAME}. To look up prices, use the{" "}
          <Link href="/fees" className="underline decoration-paper/40 underline-offset-2 hover:decoration-white">
            fee explorer
          </Link>
          . Every number here comes from{" "}
          <a href="#verified" className="underline decoration-paper/40 underline-offset-2 hover:decoration-white">
            verified
          </a>{" "}
          published fee schedules.
        </p>

        <dl className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-ink px-5 py-5">
              <dt className="sr-only">{s.label}</dt>
              <dd>
                <span className="block text-[2rem] font-semibold leading-none tabular-nums text-white sm:text-[2.5rem]" style={MONO_FIGURE}>
                  {s.value}
                </span>
                <span className="mt-2 block text-[13px] font-semibold text-paper">{s.label}</span>
                <span className="mt-0.5 block text-[11px] text-paper/60">{s.note}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-[12px]">
          <span className="inline-flex items-center gap-2 text-paper/75">
            <span aria-hidden="true" className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7fb59b] opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7fb59b]" />
            </span>
            {summary.freshnessLabel}
          </span>
          <Link href="/research/national-fee-index" className="font-semibold text-[#e0716a] hover:text-white">
            Open the full {PRODUCT_NAME} &rarr;
          </Link>
          <Link href="/methodology" className="text-paper/75 hover:text-white">
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
    <nav aria-label={label} className="print:hidden sticky top-14 z-30 border-b border-border bg-paper/95 backdrop-blur">
      <ul className="mx-auto flex max-w-page gap-1 overflow-x-auto px-4 py-2 sm:px-6">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              className="block rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft transition-colors hover:bg-ink hover:text-white"
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
