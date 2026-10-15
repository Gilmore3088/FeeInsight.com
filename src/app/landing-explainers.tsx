import { ArrowDown, BarChart3, FileSpreadsheet, FileText, Landmark, UserRound, type LucideIcon } from "lucide-react";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { SANS, SECTION_INNER, SectionHeading } from "./landing-shared";

/** Brief 08 §B.5, left panel: the alternatives SHERLOCK read (01 §1). */
const OLD_WAY: { icon: LucideIcon; text: string }[] = [
  { icon: FileText, text: "Competitor fee schedules, saved one PDF at a time" },
  { icon: FileSpreadsheet, text: "A spreadsheet someone keeps by hand" },
  { icon: BarChart3, text: "A national survey average from a sample you didn't choose" },
  { icon: Landmark, text: "Call-report peer ratios that don't list fees" },
  { icon: UserRound, text: "A consultant to put it together" },
];

/** Brief 08 §B.5, right panel: schedules into the index, out to five markets, into Hamilton. */
const NEW_WAY = ["Published fee schedules", PRODUCT_NAME, "Five markets", "Hamilton"] as const;
const HAMILTON_VERBS = ["Read", "Place", "Ask", "Report"] as const;

/** Brief 08 §B.5: the fee study by hand against Fee Insight. */
export function LandingFiveSources() {
  return (
    <section className="border-b border-border bg-paper">
      <div className={`${SECTION_INNER} py-14 sm:py-16`}>
        <SectionHeading eyebrow="Replace the fee study by hand" title="Five sources, or one" />
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-dashed border-ink-muted/50 bg-paper p-5 sm:p-6">
            <h3 className="text-[15px] font-semibold text-ink-soft">How fee studies get done today</h3>
            <ul className="mt-4 divide-y divide-dashed divide-border">
              {OLD_WAY.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3 py-3 text-[15px] leading-6 text-ink-soft">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 rounded-lg border border-ink bg-surface-0 p-5 sm:p-6">
            <h3 className="text-[15px] font-semibold text-ink">In {SITE_NAME}</h3>
            <ol className="mt-4 flex flex-col items-stretch" aria-label={`How ${SITE_NAME} works`}>
              {NEW_WAY.map((step, index) => (
                <li key={step} className="flex flex-col items-center">
                  {index > 0 ? <ArrowDown className="my-1 h-4 w-4 text-ink" aria-hidden="true" /> : null}
                  <span className="w-full rounded-md border border-ink px-4 py-2.5 text-center text-[15px] font-semibold text-ink">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
            <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="In Hamilton">
              {HAMILTON_VERBS.map((verb) => (
                <li key={verb} className="rounded-full bg-ink px-3 py-1 text-[13px] font-semibold text-on-ink">
                  {verb}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-6 max-w-3xl text-[15px] leading-relaxed text-ink-soft">
          Every figure in {SITE_NAME} keeps its source: the institution&apos;s own document, the page and the date.
        </p>
      </div>
    </section>
  );
}

type FeePathSummary = Pick<PublicStatsSummary, "observationsLabel" | "freshnessLabel">;

/**
 * Brief 08 §B.9: the navy operating-record panel. The footer leaves out the re-read cadence
 * ("on a rolling calendar"), which 08 §C still marks [NEED]. data-theme="dark" flips the tokens.
 */
export function LandingFeePath({ summary }: { summary: FeePathSummary }) {
  const hasCount = /\d/.test(summary.observationsLabel);
  const steps = [
    { label: "Schedule read", line: "The institution's own published fee schedule is collected and read." },
    { label: "Fee recorded", line: "Each fee is kept with its document, page and date." },
    { label: "Checked against source", line: "A fee is checked against the schedule it came from before it is published." },
    { label: "Published", line: `It joins the ${PRODUCT_NAME}. ${summary.freshnessLabel}.` },
  ];
  return (
    <section data-theme="dark" className="bg-paper text-ink">
      <div className={`${SECTION_INNER} py-14 sm:py-16`}>
        <SectionHeading eyebrow="Behind every figure" title="How a fee reaches the index" />
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.label} className="min-w-0 rounded-lg border border-border bg-surface-0 p-5">
              <p className="font-mono text-[13px] font-semibold tabular-nums text-ink-muted">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-2 text-[16px] font-semibold text-ink" style={SANS}>
                {step.label}
              </h3>
              <p className="mt-1.5 text-[14px] leading-6 text-ink-muted">{step.line}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-[14px] leading-6 text-ink-muted">
          {hasCount ? `${summary.observationsLabel} published fee entries. ` : ""}A competitor&apos;s change shows once
          its schedule is re-read.
        </p>
      </div>
    </section>
  );
}

/** Brief 04 Direction A §6: how to start, in three steps. */
const START_STEPS = [
  "Search your institution.",
  "See where two fees stand against your state or district.",
  "Open Hamilton for all five markets, or ask us for one report.",
] as const;

export function LandingHowToStart() {
  return (
    <section className="border-b border-border bg-paper">
      <div className={`${SECTION_INNER} py-14 sm:py-16`}>
        <SectionHeading title="How to start" />
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {START_STEPS.map((step, index) => (
            <li key={step} className="flex min-w-0 items-start gap-4">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-on-ink"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <p className="pt-1 text-[16px] leading-relaxed text-ink">{step}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
