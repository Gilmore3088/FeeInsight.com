import Link from "next/link";
import { HAMILTON_MODES, REPORT_PRICE_INLINE } from "@/lib/constants";
import type { HomeData } from "./home-data";
import { Eyebrow, Section, TextLink } from "./home-section";

/** Every fee: the Bank Fee Index, live. */
export function EveryFeeSection({ data }: { data: HomeData }) {
  const proof = [
    { value: data.institutionsLabel, label: "Institutions with published fees" },
    { value: data.observationsLabel, label: "Published fee entries" },
    { value: data.categoriesLabel, label: "Fee categories" },
    { value: data.statesLabel, label: "States" },
  ];
  return (
    <Section>
      <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <Eyebrow>Every fee</Eyebrow>
          <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-ink">
            Your competitors&apos; fees, from their own schedules
          </h2>
          <p className="mt-5 text-[17px] leading-relaxed text-ink-soft">
            The Bank Fee Index reads each institution&apos;s published fee schedule and keeps every fee with the document,
            page and date it came from. When a board member quotes a national average from the press, you can answer with
            the schedules of the banks your customers can walk into.
          </p>
          <TextLink href="/methodology">How we read a fee schedule</TextLink>
        </div>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            {proof.map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-surface-0 p-5">
                <div className="font-mono text-[28px] font-semibold tabular-nums tracking-tight text-ink">{item.value}</div>
                <div className="mt-1 text-[13px] text-ink-muted">{item.label}</div>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-ink-muted">Bank Fee Index · {data.freshnessLabel}</p>
        </div>
      </div>
    </Section>
  );
}

/** One workspace: Hamilton, the chat that ends in a report. */
export function OneWorkspaceSection() {
  return (
    <Section>
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>One workspace</Eyebrow>
        <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-ink">
          Ask, compare and take a report to committee
        </h2>
        <p className="mt-5 text-[17px] leading-relaxed text-ink-soft">
          Hamilton, the Fee Insight Pro workspace, puts the index and the markets in one place. Ask Hamilton a question and
          each answer cites its source. Add the findings you want to keep, and Hamilton writes a sourced report. Hamilton
          shows the position and the options; the decision stays with your institution.
        </p>
        <ul className="mt-8 flex flex-wrap justify-center gap-2">
          {[...HAMILTON_MODES, "Regulatory Wire"].map((mode) => (
            <li key={mode} className="rounded-md border border-border bg-surface-0 px-3 py-1.5 text-[13px] font-semibold text-ink">
              {mode}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <Link href="/subscribe" className="fi-btn fi-btn-primary">
            See Hamilton plans
          </Link>
          <span className="text-[14px] text-ink-muted">
            Prefer one document? A Competitive Fee Position Report, {REPORT_PRICE_INLINE}.
          </span>
        </div>
      </div>
    </Section>
  );
}

