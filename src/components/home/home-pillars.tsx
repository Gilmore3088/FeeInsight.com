import Link from "next/link";
import { FeeRange, FeeRangeAxis } from "@/brand/components";
import { HAMILTON_MODES, REPORT_PRICE_INLINE } from "@/lib/constants";
import { formatFee, type HomeData } from "./home-data";
import { Eyebrow, Section, TextLink } from "./home-section";

const OLD_WAY = [
  "Competitor fee schedules, saved one PDF at a time",
  "A spreadsheet someone keeps by hand",
  "A national survey average from a sample you didn't choose",
  "Call-report peer ratios that don't list fees",
  "A consultant to put it together",
] as const;

const FLOW = ["Read", "Place", "Ask", "Report"] as const;

/** The fee study by hand next to the same study in Fee Insight. */
export function OldWaySection() {
  return (
    <Section tone="surface">
      <Eyebrow>Replace the fee study by hand</Eyebrow>
      <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-ink">
        Five sources, or one
      </h2>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <div className="rounded-lg border border-dashed border-control-border bg-paper p-6">
          <h3 className="text-[15px] font-bold text-ink-muted">How fee studies get done today</h3>
          <ul className="mt-4 grid gap-3">
            {OLD_WAY.map((line) => (
              <li key={line} className="flex gap-3 text-[15px] text-ink-soft">
                <span aria-hidden="true" className="mt-2 h-px w-4 shrink-0 bg-control-border" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col rounded-lg border border-border bg-paper p-6 text-ink" data-theme="dark">
          <h3 className="text-[15px] font-bold">In Fee Insight</h3>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
            Published fee schedules flow into the Bank Fee Index, out to five markets, then into Hamilton.
          </p>
          <ol className="mt-auto grid grid-cols-4 gap-2 pt-8">
            {FLOW.map((step, i) => (
              <li key={step} className="grid gap-2">
                <span className="font-mono text-[12px] text-ink-muted">0{i + 1}</span>
                <span className="h-0.5 w-full bg-ink/30" aria-hidden="true" />
                <span className="text-[17px] font-bold">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="mt-6 text-[15px] text-ink-soft">
        Every figure in Fee Insight keeps its source: the institution&apos;s own document, the page and the date.
      </p>
    </Section>
  );
}

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

/** Every market: the national spread, live, with the market layers named. */
export function EveryMarketSection({ data }: { data: HomeData }) {
  const fees = data.nationalFees;
  const top = Math.max(10, ...fees.map((fee) => fee.max));
  const domainMax = Math.ceil(top / 10) * 10;
  const ticks = [0, domainMax / 4, domainMax / 2, (domainMax * 3) / 4, domainMax];
  return (
    <Section tone="surface">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <Eyebrow>Every market</Eyebrow>
          <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-ink">
            See each fee in five markets at once
          </h2>
          <p className="mt-5 text-[17px] leading-relaxed text-ink-soft">
            Each of your fees sits against your market (institutions with branches in your counties), your state, your Fed
            district, your peer group (same charter and asset size) and the nation. You see the median, the middle half and
            whether your fee is above, inside or below the range. A market with fewer than five institutions gets no median.
          </p>
          <TextLink href="/reports">Read the free national and Fed district reports</TextLink>
        </div>
        {fees.length > 0 ? (
          <div className="rounded-lg border border-border bg-paper p-5">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">The nation, median shown</div>
            {fees.map((fee) => (
              <FeeRange key={fee.key} label={fee.label} min={fee.min} q1={fee.q1} median={fee.median} q3={fee.q3} max={fee.max} domain={[0, domainMax]} format={formatFee} />
            ))}
            <FeeRangeAxis ticks={ticks} />
            <p className="mt-3 text-[12px] text-ink-muted">Bank Fee Index · {data.freshnessLabel}. Your market, state, district and peer group are in Hamilton.</p>
          </div>
        ) : null}
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

