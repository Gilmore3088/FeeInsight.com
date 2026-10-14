import type { ReactNode } from "react";
import Link from "next/link";
import { REPORT_OFFER, REPORT_OFFER_LINE, REPORT_PRICE_INLINE } from "@/lib/constants";
import { CONSULTANT_PRICE_NOTE, PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import type { HomeData } from "./home-data";
import { Eyebrow, Section } from "./home-section";

const RECORD_STEPS = [
  { label: "Schedule read", line: "The institution's own published fee schedule is collected and read." },
  { label: "Fee recorded", line: "Each fee is kept with its document, page and date." },
  { label: "Checked against source", line: "A fee is checked against the schedule it came from before it is published." },
  { label: "Published", line: "It joins the Bank Fee Index." },
] as const;

/** How a fee reaches the index, as an operating record on a navy band. */
export function OperatingRecordSection({ data }: { data: HomeData }) {
  return (
    <Section dark>
      <Eyebrow>Behind every figure</Eyebrow>
      <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-ink">
        How a fee reaches the index
      </h2>
      <ol className="mt-10 overflow-hidden rounded-lg border border-border bg-surface-0">
        {RECORD_STEPS.map((step, i) => (
          <li key={step.label} className="grid grid-cols-[3rem_1fr] gap-4 border-b border-border px-5 py-4 last:border-b-0 sm:grid-cols-[3rem_14rem_1fr]">
            <span className="font-mono text-[13px] tabular-nums text-ink-muted">0{i + 1}</span>
            <span className="text-[15px] font-bold text-ink">{step.label}</span>
            <span className="col-start-2 text-[15px] text-ink-soft sm:col-start-auto">
              {step.line}
              {i === RECORD_STEPS.length - 1 ? ` ${data.freshnessLabel}.` : null}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-[14px] text-ink-muted">
        <span className="font-mono tabular-nums text-ink">{data.observationsLabel}</span> published fee entries. Schedules are
        re-read on a rolling calendar, and a competitor&apos;s change shows once its schedule is re-read.
      </p>
    </Section>
  );
}

/** Prices on the page: free, Hamilton Pro by asset size, and the one-off report. */
export function PricingPreviewSection() {
  return (
    <Section id="pricing">
      <Eyebrow>Prices on the page</Eyebrow>
      <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-ink">What it costs</h2>
      <div className="mt-10 grid gap-4 lg:grid-cols-[1fr_2fr_1fr]">
        <PriceCard title="Free" lines={[REPORT_OFFER_LINE, "Institution search for anyone, and basic fee alerts with a free account."]}>
          <Link href="/research/national-fee-index" className="fi-btn fi-btn-secondary">
            Read the national report
          </Link>
        </PriceCard>
        <div className="flex flex-col rounded-lg border border-ink bg-surface-0 p-6">
          <h3 className="text-[17px] font-bold text-ink">Hamilton Pro</h3>
          <p className="mt-1 text-[14px] text-ink-muted">One plan for up to 5 people, priced by your institution&apos;s assets.</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            {PRO_TIERS.map((tier) => (
              <li key={tier.key} className="rounded-md border border-border bg-paper p-4">
                <div className="text-[13px] text-ink-muted">{tier.assetsLabel}</div>
                <div className="mt-2 font-mono text-[20px] font-semibold tabular-nums text-ink">{tierPriceLabel(tier.key, "monthly")}</div>
                <div className="mt-1 text-[12px] text-ink-muted">or {tierPriceLabel(tier.key, "annual")}</div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12px] text-ink-muted">{CONSULTANT_PRICE_NOTE}</p>
          <Link href="/subscribe" className="fi-btn fi-btn-primary mt-5 self-start">
            See Hamilton plans
          </Link>
        </div>
        <PriceCard title="One report" lines={[`${REPORT_OFFER.name}, ${REPORT_PRICE_INLINE}.`, `Each report is quoted. ${REPORT_OFFER.nextStep}.`]}>
          <Link href="/reports" className="fi-btn fi-btn-secondary">
            {REPORT_OFFER.institutionCtaLabel}
          </Link>
        </PriceCard>
      </div>
    </Section>
  );
}

function PriceCard({ title, lines, children }: { title: string; lines: string[]; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-0 p-6">
      <h3 className="text-[17px] font-bold text-ink">{title}</h3>
      {lines.map((line) => (
        <p key={line} className="text-[14px] text-ink-soft">
          {line}
        </p>
      ))}
      <div className="mt-auto pt-3">{children}</div>
    </div>
  );
}
