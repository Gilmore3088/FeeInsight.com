import Link from "next/link";
import { PRODUCT_NAME, REPORT_OFFER, REPORT_PRICE_INLINE, SITE_NAME } from "@/lib/constants";
import { PRO_PLANS_HREF } from "@/components/public/pro-next-step";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { PrintButton } from "./print-button";
import { HAMILTON_CANONICAL } from "@/app/for-institutions/hamilton-copy";
import { HubSection } from "./district/[id]/district-hub";

const SERIF = { fontFamily: "var(--fi-font-sans)" };

const STEPS = [
  { n: "1", title: "Find the schedule", body: "Locate each bank's and credit union's own published fee schedule or disclosure." },
  { n: "2", title: "Read it", body: "Turn web pages and PDFs into clean text, one whole document at a time." },
  { n: "3", title: "Extract each fee", body: "Pull every fee line with its amount and conditions, linked to the source document." },
  { n: "4", title: "Verify, then publish", body: "Check each fee against its own schedule before it can be published. Only verified fees reach this page." },
];

const VERIFIED_CHECKS = [
  "The amount appears in the stored text of the institution's own published schedule.",
  "For the main fee categories, the fee's name names that fee and not a different one.",
  "The price sits inside the expected range for that category.",
  "The fee links back to its source document.",
];

const SOURCES = [
  "Published fee schedules & disclosures",
  "FDIC Call Reports (service charge income)",
  "NCUA 5300 reports (credit union data)",
  "Federal Reserve Beige Book (economic context)",
];

const MONO_FIGURE = { fontFamily: "var(--fi-font-mono)" } as const;

/** A methodology note behind an explicit control, closed by default. */
function Note({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-surface-200 first:border-t-0">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[14px] font-semibold text-ink hover:bg-paper [&::-webkit-details-marker]:hidden">
        {title}
        <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-90">&rsaquo;</span>
      </summary>
      <div id={id} className="scroll-mt-28 px-5 pb-5 text-[13px] leading-relaxed text-ink-soft">
        {children}
      </div>
    </details>
  );
}

function Dots({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <li key={c} className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brick/70" />
          {c}
        </li>
      ))}
    </ul>
  );
}

/** Coverage counts, how the data is built and checked, and the PDF; after the findings, not before them. */
export function MethodFlow({ summary, stateCount, coverageLabel }: { summary: PublicStatsSummary; stateCount: number; coverageLabel: string }) {
  const stats = [
    { value: summary.observationsLabel, label: "published fee entries" },
    { value: summary.categoriesLabel, label: "fee categories" },
    { value: String(stateCount), label: "states with published fees" },
  ];

  return (
    <HubSection
      id="about-data"
      title="About the data"
      line={`${summary.institutionsLabel} of the ${summary.monitoredLabel} banks and credit unions monitored have verified published fees.`}
      source={`${PRODUCT_NAME}, verified published fee schedules; coverage spans ${coverageLabel}.`}
    >
      <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-white px-4 py-4 last:col-span-2 sm:last:col-span-1">
            <dt className="sr-only">{s.label}</dt>
            <dd>
              <span className="block text-[1.5rem] font-semibold leading-none tabular-nums text-ink" style={MONO_FIGURE}>
                {s.value}
              </span>
              <span className="mt-1.5 block text-[12px] leading-snug text-ink-muted">{s.label}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-white">
        <Note title={"What \u201cverified\u201d means"} id="verified">
          <Dots items={VERIFIED_CHECKS} />
          <p className="mt-3 text-[12px] text-ink-muted">
            Not yet checked: which account each price belongs to. A schedule with several accounts can list several prices
            for one fee, so each institution counts once, at the median of its prices (overdraft: its highest).
          </p>
        </Note>
        <Note title="How a fee gets here">
          <ol className="space-y-3">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="w-4 shrink-0 text-[12px] font-bold tabular-nums text-ink-muted">{s.n}</span>
                <span>
                  <span className="block font-semibold text-ink">{s.title}</span>
                  {s.body}
                </span>
              </li>
            ))}
          </ol>
        </Note>
        <Note title="Sources and coverage">
          <Dots items={SOURCES} />
          <p className="mt-3 text-[12px] text-ink-muted">
            Coverage: banks and credit unions of every asset size, all 12 Federal Reserve districts, {coverageLabel}.
            Each state and district report shows how many of its institutions have published fees so far.
          </p>
        </Note>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-[13px]">
        <Link href="/methodology" className="font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
          Full methodology
        </Link>
        <Link href="/research/national-fee-index" className="font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
          The full {PRODUCT_NAME}
        </Link>
        <PrintButton className="min-h-11 rounded-full border border-ink px-4 font-semibold text-ink hover:bg-ink hover:text-white print:hidden" />
      </div>

      </div>
    </HubSection>
  );
}

/** The page's one Pro band: Hamilton plans first, then the sample report (or the paid report while the sample is offline). */
export function ProBand({ sampleLive }: { sampleLive: boolean }) {
  const secondary = sampleLive
    ? { href: "/reports/sample-competitive-fee-position", label: `See the sample ${REPORT_OFFER.name}` }
    : { href: "/for-institutions#report", label: REPORT_OFFER.institutionCtaLabel };
  return (
      <section aria-labelledby="pro-heading" className="rounded-2xl bg-ink px-6 py-6 text-paper print:hidden sm:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#e0716a]">{SITE_NAME} Pro · Hamilton</p>
        <h2 id="pro-heading" className="mt-2 text-[20px] font-semibold leading-snug text-white" style={SERIF}>
          Benchmark your institution against the peers you choose.
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-paper/80">{HAMILTON_CANONICAL}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={PRO_PLANS_HREF} className="inline-flex min-h-11 items-center rounded-full bg-brick px-4 text-[13px] font-semibold text-white hover:bg-brick-ink">
            See Hamilton plans
          </Link>
          <Link href={secondary.href} className="inline-flex min-h-11 items-center rounded-full border border-white/25 px-4 text-[13px] font-semibold text-white hover:bg-white/10">
            {secondary.label}
          </Link>
        </div>
        <p className="mt-2 text-[12px] text-paper/60">
          Not ready for Pro? A one-time {REPORT_OFFER.name} is quoted per institution, {REPORT_PRICE_INLINE}.
        </p>
      </section>
  );
}
