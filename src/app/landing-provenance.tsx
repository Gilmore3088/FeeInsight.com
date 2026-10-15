import { ArrowRight, BadgeCheck, FileSearch, Globe2, ListPlus, type LucideIcon } from "lucide-react";
import { PRODUCT_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { SANS, SECTION_INNER, hasFigure } from "./landing-shared";

type ProvenanceSummary = Pick<PublicStatsSummary, "institutionsLabel" | "observationsLabel" | "freshnessLabel">;

const STEPS: { icon: LucideIcon; label: string }[] = [
  { icon: FileSearch, label: "Schedule read" },
  { icon: ListPlus, label: "Fee recorded" },
  { icon: BadgeCheck, label: "Checked against source" },
  { icon: Globe2, label: "Published" },
];

/**
 * Brief 06 §4.3 item 5, as one compact navy strip: the four steps a fee goes through, and the
 * one live figure the pipeline publishes (fee entries and institutions). A failed read shows
 * the steps without the figure. data-theme="dark" flips the tokens.
 */
export function LandingProvenance({ summary }: { summary: ProvenanceSummary }) {
  const figure = hasFigure(summary.observationsLabel) && hasFigure(summary.institutionsLabel);
  return (
    <section data-theme="dark" aria-labelledby="provenance-heading" className="bg-paper text-ink">
      <div className={`${SECTION_INNER} flex flex-col gap-6 py-10 sm:py-12 lg:flex-row lg:items-center lg:justify-between lg:gap-10`}>
        <div className="min-w-0">
          <h2 id="provenance-heading" className="text-[20px] !font-semibold leading-tight !tracking-[-0.02em] text-ink sm:text-[24px]" style={SANS}>
            How a fee reaches the {PRODUCT_NAME}
          </h2>
          {figure ? (
            <p className="mt-2 text-[14px] text-ink-muted">
              <span className="text-[18px] font-semibold tabular-nums text-ink">{summary.observationsLabel}</span> fee
              entries from {summary.institutionsLabel} institutions · {summary.freshnessLabel}
            </p>
          ) : (
            <p className="mt-2 text-[14px] text-ink-muted">{summary.freshnessLabel}</p>
          )}
        </div>
        <ol className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5 lg:shrink-0 lg:flex-nowrap">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.label} className="flex items-center gap-1.5">
                <span className="flex min-h-10 w-full items-center gap-2 rounded-full border border-border bg-surface-0 px-3.5 text-[13px] font-semibold text-ink sm:w-auto">
                  <Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  {step.label}
                </span>
                {i < STEPS.length - 1 ? <ArrowRight className="hidden h-4 w-4 shrink-0 text-ink-muted sm:block" aria-hidden="true" /> : null}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
