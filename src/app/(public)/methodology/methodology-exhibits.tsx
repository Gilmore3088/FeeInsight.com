import { TrackLink } from "@/components/track-link";
import { UnstatedAudienceFootnote, UnstatedAudienceMark } from "@/components/unstated-audience";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/constants";
import type { ActionLink, ComputeRule, ExampleBenchmark, PipelineStage } from "./methodology-view";

const SANS = { fontFamily: "var(--fi-font-sans)" } as const;
const MONO = { fontFamily: "var(--fi-font-mono)" } as const;

export const METHODOLOGY_SECTIONS = [
  { id: "pipeline", label: "How it flows" },
  { id: "compute", label: "How it is computed" },
  { id: "limits", label: "Limits" },
] as const;

/** Dark band: what the page is, how fresh the data is, and where to jump. */
export function MethodologyHero({ freshnessLabel }: { freshnessLabel: string }) {
  return (
    <section className="fi-on-navy bg-ink text-paper">
      <div className="mx-auto max-w-page px-4 pb-8 pt-10 sm:px-6 sm:pb-10 sm:pt-14">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e0716a]">
          <span aria-hidden="true" className="h-px w-8 bg-[#e0716a]/60" />
          Methodology
        </p>
        <h1 className="mt-3 max-w-3xl text-[2rem] font-extrabold leading-[1.08] tracking-[-0.015em] text-white sm:text-[3rem]" style={SANS}>
          How a fee becomes a published number
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-paper/80 sm:text-base">
          Every figure in the {PRODUCT_NAME} starts as a line in a schedule the institution published itself.
        </p>
        <p className="mt-5 inline-flex items-center gap-2 text-[12px] text-paper/75">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#7fb59b]" />
          {freshnessLabel}
        </p>
        <nav aria-label="Methodology sections" className="mt-5">
          <ul className="flex flex-wrap gap-2">
            {METHODOLOGY_SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-white/25 px-4 text-[13px] font-semibold text-white hover:bg-white/10"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}

function SectionTitle({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brick">{eyebrow}</p>
      <h2 id={id} className="mt-1.5 text-[1.5rem] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[2rem]" style={SANS}>
        {title}
      </h2>
      {children && <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{children}</p>}
    </div>
  );
}

/** A stored document, drawn: the start of every fee. Decoration only, carries no data. */
function DocumentGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 48" className="h-12 w-10 shrink-0">
      <path d="M4 2h22l10 10v32a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke="currentColor" strokeOpacity="0.35" />
      <path d="M26 2v10h10" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      {[18, 24, 30, 36].map((y) => (
        <g key={y}>
          <rect x="7" y={y} width="16" height="2.5" rx="1" fill="currentColor" opacity="0.25" />
          <rect x="27" y={y} width="6" height="2.5" rx="1" fill="#b23a32" opacity="0.55" />
        </g>
      ))}
    </svg>
  );
}

/**
 * The exhibit: six steps from the institution's own schedule to the published index, each
 * with the live count the public site can read for it. Stages without a public read show none.
 */
export function PipelineFlow({ stages }: { stages: PipelineStage[] }) {
  return (
    <section aria-labelledby="pipeline-heading" id="pipeline" className="scroll-mt-24">
      <SectionTitle id="pipeline-heading" eyebrow="How it flows" title="From the institution's schedule to the index">
        Six steps, each logged.
      </SectionTitle>

      <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-white px-4 py-3 text-ink">
        <DocumentGlyph />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Start</p>
          <p className="text-[15px] font-semibold text-ink">The institution&apos;s own fee schedule</p>
        </div>
      </div>

      <ol className="relative mt-2" aria-label="Pipeline steps">
        {stages.map((stage, i) => (
          <li key={stage.key} className="relative pl-12 pt-4" data-stage={stage.key}>
            {/* The rail joins the steps; it stops at the last one. */}
            <span
              aria-hidden="true"
              className={`absolute left-[19px] top-0 w-px bg-brick/30 ${i === stages.length - 1 ? "h-9" : "h-full"}`}
            />
            <span
              aria-hidden="true"
              className="absolute left-0 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-brick/40 bg-paper text-[13px] font-bold tabular-nums text-brick"
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="rounded-2xl border border-border bg-white px-4 py-4 shadow-fi-1 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <h3 className="text-[17px] font-bold text-ink" style={SANS}>{stage.title}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{stage.body}</p>
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-1 text-[12px] font-medium text-ink-soft">
                    <span aria-hidden="true" className="text-brick">&rarr;</span>
                    {stage.output}
                  </p>
                </div>
                {stage.figures.length > 0 && (
                  <dl className="grid shrink-0 grid-cols-2 gap-3 sm:w-56 sm:grid-cols-1">
                    {stage.figures.map((f) => (
                      <div key={f.label} className="flex min-w-0 flex-col">
                        <dt className="order-2 mt-1 text-[12px] text-ink-muted">{f.label}</dt>
                        <dd className="order-1 min-w-0">
                          <span className="block text-[1.35rem] font-semibold leading-none tabular-nums text-ink sm:text-[1.6rem]" style={MONO}>
                            {f.value}
                          </span>
                        </dd>
                        <dd className="order-3 min-w-0">
                          {f.share !== null && (
                            <span
                              role="img"
                              aria-label={`${f.share}% of institutions monitored`}
                              className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-paper"
                            >
                              <span className="block h-full rounded-full bg-brick" style={{ width: `${f.share}%` }} />
                            </span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-4 rounded-2xl border border-dashed border-brick/40 bg-brick-tint/40 px-4 py-4 sm:px-5">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brick">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
            <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Every day
        </p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
          Fees taken down for a confirmed error are run through the current checks again. If a check stops catching one, the team is alerted.
        </p>
      </div>
    </section>
  );
}

/** One live national benchmark with its median and middle half drawn on a $0-based bar. */
export function MedianExhibit({ example, freshnessLabel }: { example: ExampleBenchmark; freshnessLabel: string }) {
  return (
    <figure className="rounded-2xl border border-border bg-white px-4 py-5 shadow-fi-1 sm:px-6" data-category={example.category}>
      <figcaption className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        Live example · {example.label}, national
      </figcaption>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-[2.25rem] font-semibold leading-none tabular-nums text-ink" style={MONO}>
          {example.median}
          <UnstatedAudienceMark show={example.unstatedAudience} />
        </span>
        <span className="text-[13px] text-ink-muted">median</span>
      </p>
      <div
        className="relative mt-5 h-8"
        role="img"
        aria-label={`Middle half ${example.low} to ${example.high}, median ${example.median}, on a scale from $0 to ${example.axisMax}`}
      >
        <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-paper" />
        <span
          aria-hidden="true"
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-brick/60"
          style={{ left: `${example.lowPct}%`, width: `${Math.max(1, example.highPct - example.lowPct)}%` }}
        />
        <span aria-hidden="true" className="absolute top-0 h-8 w-0.5 -translate-x-1/2 rounded bg-ink" style={{ left: `${example.medianPct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[12px] tabular-nums text-ink-muted" aria-hidden="true">
        <span>$0</span>
        <span>{example.axisMax}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-[13px]">
        <div>
          <dt className="text-ink-muted">Middle half</dt>
          <dd className="font-semibold tabular-nums text-ink">
            {example.low} to {example.high}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Institutions</dt>
          <dd className="font-semibold tabular-nums text-ink">{example.institutions}, one value each</dd>
        </div>
      </dl>
      <p className="mt-3 text-[12px] text-ink-muted">From published fees in the {PRODUCT_NAME}. {freshnessLabel}.</p>
      <UnstatedAudienceFootnote show={example.unstatedAudience} className="mt-2" />
    </figure>
  );
}

/** The statistics contract, one line per rule, detail behind a native disclosure. */
export function ComputeRules({ rules }: { rules: ComputeRule[] }) {
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-white">
      {rules.map((rule) => (
        <li key={rule.id} id={rule.id} className="scroll-mt-24 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[15px] font-bold text-ink" style={SANS}>{rule.title}</h3>
            {rule.status && (
              <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink-muted ring-1 ring-border">
                {rule.status}
              </span>
            )}
          </div>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{rule.line}</p>
          {rule.detail.length > 0 && (
            <details className="group mt-1" open={rule.open}>
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">More</span>
                <span className="hidden group-open:inline">Less</span>
                <span className="sr-only"> about {rule.title.toLowerCase()}</span>
              </summary>
              <div className="space-y-1.5 pb-1 text-[13px] leading-relaxed text-ink-muted">
                {rule.detail.map((d) => (
                  <p key={d}>{d}</p>
                ))}
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

const LIMITS = [
  {
    title: "No pricing advice",
    body: "The index shows where a fee sits against the market. Whether to change it is the institution's call.",
  },
  {
    title: "Data can lag",
    body: "An institution can change its schedule before the new copy is collected. Each fee carries the date its schedule was collected.",
  },
  {
    title: "Published prices, not revenue",
    body: "Waivers and negotiated terms do not appear on a schedule, so they are not in the index.",
  },
  {
    title: "Coverage is uneven",
    body: "Thinner where schedules are not online, and for business, loan and investment fees.",
  },
] as const;

export function Limits() {
  return (
    <section aria-labelledby="limits-heading" id="limits" className="scroll-mt-24">
      <SectionTitle id="limits-heading" eyebrow="Limits" title="What the index does not do" />
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LIMITS.map((l) => (
          <li key={l.title} className="rounded-2xl border border-border bg-white px-4 py-4">
            <p className="flex items-center gap-2 text-[15px] font-bold text-ink" style={SANS}>
              <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-brick-tint text-[12px] text-brick">
                &times;
              </span>
              {l.title}
            </p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{l.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The one next action: the sample report when it is live, else the report request; a demo second. */
export function NextAction({ action }: { action: ActionLink }) {
  return (
    <section aria-labelledby="next-heading" id="next" className="fi-on-navy scroll-mt-24 rounded-2xl bg-ink px-5 py-6 text-paper sm:px-8 sm:py-8">
      <h2 id="next-heading" className="text-[1.4rem] font-bold leading-tight text-white sm:text-[1.75rem]" style={SANS}>
        See the method on one institution
      </h2>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-paper/80">
        Its fees set against its market, line by line, each traced to the schedule.
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <TrackLink
          event={action.event}
          eventProps={{ placement: "methodology" }}
          href={action.href}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-brick px-6 text-[14px] font-semibold text-white hover:bg-brick-ink"
        >
          {action.label}
        </TrackLink>
        <TrackLink
          event="contact_sales"
          eventProps={{ placement: "methodology_demo" }}
          href={DEMO_REQUEST_NAV.href}
          className="inline-flex min-h-11 items-center justify-center text-[14px] font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
        >
          {DEMO_REQUEST_NAV.label}
        </TrackLink>
      </div>
      <Link
        href="/institutions"
        className="mt-3 inline-flex min-h-11 items-center text-[13px] text-paper/75 underline decoration-white/20 underline-offset-4 hover:text-white"
      >
        Or look up your own institution
      </Link>
    </section>
  );
}

export function ContactLine({ email }: { email: string }) {
  return (
    <p className="text-[12px] text-ink-muted">
      Questions about the method?{" "}
      <a href={`mailto:${email}`} className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
        {email}
      </a>
    </p>
  );
}
