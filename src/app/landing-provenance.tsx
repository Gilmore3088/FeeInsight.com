import { BadgeCheck, FileSearch, ListPlus, Globe2, type LucideIcon } from "lucide-react";
import { PRODUCT_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { SANS, SECTION_INNER, SectionHeading, hasFigure } from "./landing-shared";

type ProvenanceSummary = Pick<
  PublicStatsSummary,
  "monitoredLabel" | "institutionsLabel" | "observationsLabel" | "refreshedOn" | "freshnessLabel"
>;

interface Step {
  icon: LucideIcon;
  label: string;
  /** A live figure and what it counts; left out when the read failed. */
  figure?: { value: string; unit: string };
  /** What the step keeps, in a few words. */
  note: string;
}

/**
 * Brief 06 §4.3 item 5: the navy operating record. Each step's figure comes from the live
 * snapshot; a step with no live field shows none. data-theme="dark" flips the tokens.
 */
export function LandingProvenance({ summary }: { summary: ProvenanceSummary }) {
  const figure = (value: string, unit: string) => (hasFigure(value) ? { value, unit } : undefined);
  const steps: Step[] = [
    { icon: FileSearch, label: "Schedule read", figure: figure(summary.monitoredLabel, "institutions monitored"), note: "The institution's own document" },
    { icon: ListPlus, label: "Fee recorded", note: "With its document, page and date" },
    { icon: BadgeCheck, label: "Checked against source", note: "Before anything is published" },
    {
      icon: Globe2,
      label: "Published",
      figure: figure(summary.observationsLabel, `fee entries from ${summary.institutionsLabel} institutions`),
      note: summary.freshnessLabel,
    },
  ];
  return (
    <section data-theme="dark" className="bg-paper text-ink">
      <div className={`${SECTION_INNER} py-16 sm:py-24`}>
        <SectionHeading eyebrow="Behind every figure" title={`How a fee reaches the ${PRODUCT_NAME}`} />
        <ol className="relative mt-10 grid gap-3 sm:mt-14 lg:grid-cols-4 lg:gap-4">
          <span aria-hidden className="absolute left-[1.75rem] top-6 bottom-6 w-px bg-border lg:left-6 lg:right-6 lg:top-[2.25rem] lg:bottom-auto lg:h-px lg:w-auto" />
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.label} className="relative flex gap-4 rounded-2xl border border-border bg-surface-0 p-4 lg:flex-col lg:p-6">
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-paper">
                  <Icon className="h-5 w-5 text-ink" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[12px] tabular-nums text-ink-muted">{String(i + 1).padStart(2, "0")}</p>
                  <h3 className="mt-1 text-[17px] font-semibold text-ink" style={SANS}>
                    {step.label}
                  </h3>
                  {step.figure ? (
                    <p className="mt-3">
                      <span className="block text-[30px] font-semibold leading-8 tabular-nums tracking-[-0.03em] text-ink">
                        {step.figure.value}
                      </span>
                      <span className="text-[13px] text-ink-muted">{step.figure.unit}</span>
                    </p>
                  ) : null}
                  <p className="mt-2 text-[13px] leading-5 text-ink-muted">{step.note}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
