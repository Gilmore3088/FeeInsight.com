import Link from "next/link";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { PRODUCT_NAME, REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { PrintButton } from "../../../research/print-button";
import { SectionHeading } from "../../../research/research-hero";
import { ExhibitSource } from "../../../research/exhibits";
import { formatDelta, type StateComparison } from "@/lib/research-report/state-findings";
import { MIN_BENCHMARK_INSTITUTIONS, MIN_CHARTER_INSTITUTIONS } from "./report-data";
import { teaserScale, type InstitutionTeaser } from "./institution-view";

const MONO_FIGURE = { fontFamily: "var(--fi-font-mono)" } as const;

/** Where the paid institution report line goes: the request form on /reports. */
export const INSTITUTION_REPORT_HREF = "/reports?report=institution&src=benchmark#request";

export interface HeroStat {
  value: string;
  label: string;
  note: string;
}

export function ReportHero({
  eyebrow,
  title,
  lede,
  stats,
  freshnessLabel,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  stats: HeroStat[];
  freshnessLabel: string;
}) {
  return (
    <section className="relative overflow-hidden bg-ink text-paper">
      <div className="relative mx-auto max-w-page px-4 pb-10 pt-10 sm:px-6 sm:pb-12 sm:pt-12">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e0716a]">
          <span aria-hidden="true" className="h-px w-8 bg-[#e0716a]/60" />
          {eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.03em] text-white sm:text-[3.25rem]">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-paper/80 sm:text-base">{lede}</p>

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
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#7fb59b]" />
            {freshnessLabel}
          </span>
          <Link href="/methodology" className="text-paper/75 hover:text-white print:hidden">
            Methodology
          </Link>
          <PrintButton className="rounded-full border border-white/25 px-3.5 py-1.5 font-semibold text-white hover:bg-white/10 print:hidden" />
        </div>
      </div>
    </section>
  );
}

function pct(value: number, scaleMax: number): number {
  return Math.max(0, Math.min(100, (value / scaleMax) * 100));
}

function RangeTrack({
  label,
  median,
  p25,
  p75,
  scaleMax,
  tone,
}: {
  label: string;
  median: number;
  p25: number | null;
  p75: number | null;
  scaleMax: number;
  tone: "area" | "national";
}) {
  const band = tone === "area" ? "bg-brick/25" : "bg-ink/12";
  const tick = tone === "area" ? "bg-brick" : "bg-ink/70";
  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)_56px] items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{label}</span>
      <div className="relative h-2.5 rounded-full bg-surface-200" aria-hidden="true">
        {p25 != null && p75 != null && (
          <div
            className={`absolute inset-y-0 rounded-full ${band}`}
            style={{ left: `${pct(p25, scaleMax)}%`, width: `${Math.max(pct(p75, scaleMax) - pct(p25, scaleMax), 1.5)}%` }}
          />
        )}
        <div className={`absolute -top-1 h-[18px] w-1 -translate-x-1/2 rounded-full ${tick}`} style={{ left: `${pct(median, scaleMax)}%` }} />
      </div>
      <span className="text-right text-[12px] font-semibold tabular-nums text-ink">{formatAmount(median)}</span>
    </div>
  );
}

function BenchmarkCard({ row, areaLabel }: { row: StateComparison; areaLabel: string }) {
  const values = [row.median_amount, row.p75_amount ?? 0, row.national_median ?? 0, row.national_p75 ?? 0];
  const scaleMax = Math.max(...values) * 1.35 || 1;
  const delta = row.delta_pct;
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-white p-5 print:break-inside-avoid">
      <p className="text-[12px] font-semibold text-ink-soft">{getDisplayName(row.fee_category)}</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-[2.25rem] font-semibold leading-none tabular-nums text-ink" style={MONO_FIGURE}>
          {formatAmount(row.median_amount)}
        </span>
        {delta != null && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
              Math.abs(delta) < 1 ? "bg-surface-200 text-ink-muted" : delta < 0 ? "bg-below-market/10 text-below-market" : "bg-brick/10 text-brick"
            }`}
          >
            {Math.abs(delta) < 1 ? "in line with US" : `${formatDelta(delta)} vs US`}
          </span>
        )}
      </p>
      <div className="mt-5 space-y-2.5">
        <RangeTrack label={areaLabel} median={row.median_amount} p25={row.p25_amount} p75={row.p75_amount} scaleMax={scaleMax} tone="area" />
        {row.national_median != null && (
          <RangeTrack label="US" median={row.national_median} p25={row.national_p25} p75={row.national_p75} scaleMax={scaleMax} tone="national" />
        )}
      </div>
      <p className="mt-auto pt-4 text-[11px] text-ink-muted">
        <span className="font-semibold tabular-nums text-ink">{row.institution_count.toLocaleString()}</span> institutions
        <span className="text-ink-muted">
          {" "}
          · {row.bank_count.toLocaleString()} banks, {row.cu_count.toLocaleString()} CUs
        </span>
      </p>
    </div>
  );
}

export function BenchmarkBoard({
  rows,
  place,
  areaLabel,
  omitted,
  asOf,
}: {
  rows: StateComparison[];
  /** "the St. Louis district" or "the U.S." */
  place: string;
  /** Short label on the range bar, e.g. "D8" or "US". */
  areaLabel: string;
  omitted: number;
  asOf: string | null;
}) {
  const comparing = rows.some((r) => r.national_median != null);
  return (
    <section id="benchmarks" className="scroll-mt-28">
      <SectionHeading eyebrow="Exhibit 1 · Headline fees" title={`What institutions in ${place} charge`}>
        The tick is the median; the shaded band is where the middle half of institutions land.
        {comparing && " The top bar is the district, the bottom bar is the whole country."}
      </SectionHeading>
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <BenchmarkCard key={row.fee_category} row={row} areaLabel={areaLabel} />
        ))}
      </div>
      <ExhibitSource asOf={asOf}>
        One value per institution. A fee is shown only when at least {MIN_BENCHMARK_INSTITUTIONS} institutions publish it
        {omitted > 0 ? `, so ${omitted} of the 15 headline fees are left out until more schedules are collected.` : "."}
      </ExhibitSource>
    </section>
  );
}

const POSITION_DOT = {
  above_market: "bg-brick",
  in_market: "bg-ink",
  below_market: "bg-below-market",
  free: "bg-below-market",
} as const;

/**
 * The paid next step, shown for real: one live institution's report lines, name withheld,
 * with the video slot for the clip of Hamilton building it.
 */
export function InstitutionView({ teaser }: { teaser: InstitutionTeaser | null }) {
  return (
    <section id="institution" aria-labelledby="institution-heading" className="scroll-mt-28 print:hidden">
      <SectionHeading eyebrow="Your institution" title="The same market, with one institution in it">
        {teaser
          ? `${teaser.who}, against ${teaser.competitors} local competitors. Name withheld; every figure is live.`
          : "Your own fees, next to the competitors you name."}
      </SectionHeading>
      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        {teaser && (
          <div className="rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6">
            <p className="text-[13px] text-ink-muted">
              Above the local middle half on{" "}
              <span className="font-semibold text-ink">
                {teaser.above} of {teaser.lines.length}
              </span>{" "}
              fees shown
            </p>
            <ol className="mt-3 divide-y divide-border">
              {teaser.lines.map((l) => {
                const x = teaserScale(l);
                return (
                  <li key={l.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 py-2.5 text-[13px] sm:grid-cols-[10rem_minmax(0,1fr)_4rem]">
                    <span className="leading-tight text-ink">{l.label}</span>
                    <span className="relative h-5" aria-hidden="true">
                      <span className="absolute inset-x-0 top-1/2 border-t border-border" />
                      <span
                        className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-brick-tint"
                        style={{ left: `${x(l.p25)}%`, width: `${Math.max(x(l.p75) - x(l.p25), 1)}%` }}
                      />
                      <span className="absolute top-0 h-5 w-[2px] bg-ink/60" style={{ left: `${x(l.median)}%` }} />
                      <span
                        className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 ${POSITION_DOT[l.position]}`}
                        style={{ left: `${x(l.own)}%` }}
                      />
                    </span>
                    <span className="text-right">
                      <span className="block font-mono font-semibold tabular-nums text-ink">{formatAmount(l.own)}</span>
                      <span className="block text-[11px] text-ink-muted">
                        {l.chargingLess} of {l.peers} less
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-hidden="true">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-5 rounded-full bg-brick-tint" /> Local middle half
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3.5 w-[2px] bg-ink/60" /> Local median
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-brick" /> Above
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-ink" /> Inside
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-below-market" /> Below
              </span>
            </p>
          </div>
        )}
        <figure className={teaser ? "" : "lg:col-span-2 lg:mx-auto lg:w-full lg:max-w-3xl"}>
          <figcaption className="mb-3 flex items-baseline justify-between gap-4">
            <span className="text-[15px] font-semibold text-ink">Watch Hamilton build this for one bank</span>
            <span className="text-[13px] text-ink-muted">Video coming</span>
          </figcaption>
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-warm-ink-900 shadow-fi-2 ring-1 ring-ink/10" aria-hidden="true">
            {teaser && (
              <div className="absolute inset-x-[10%] inset-y-[18%] flex flex-col justify-between opacity-40">
                {teaser.lines.map((l) => {
                  const x = teaserScale(l);
                  return (
                    <span key={l.key} className="relative block h-2">
                      <span className="absolute inset-x-0 top-1/2 border-t border-white/20" />
                      <span
                        className="absolute inset-y-0 rounded-full bg-[#e0716a]/60"
                        style={{ left: `${x(l.p25)}%`, width: `${Math.max(x(l.p75) - x(l.p25), 1)}%` }}
                      />
                      <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ left: `${x(l.own)}%` }} />
                    </span>
                  );
                })}
              </div>
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-fi-2">
                <svg viewBox="0 0 12 12" className="ml-1 h-6 w-6 text-ink">
                  <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
                </svg>
              </span>
            </span>
          </div>
        </figure>
      </div>
    </section>
  );
}

/** The one closing band: Hamilton for your own institution, a demo, and the paid report as one line. */
export function ClosingBand() {
  return (
    <section className="rounded-2xl border border-border bg-surface-0 px-5 py-7 print:hidden sm:px-8">
      <p className="text-[22px] font-semibold tracking-[-0.02em] text-ink">See your own institution in this report</p>
      <p className="mt-2 max-w-[38rem] text-[14px] text-ink-muted">
        Hamilton puts your fees on every line of it and keeps them current as competitors change theirs.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <TrackLink
          event="upgrade_click"
          eventProps={{ placement: "benchmark_closing" }}
          href={PRO_PLANS_NAV.href}
          className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
        >
          {PRO_PLANS_NAV.label}
        </TrackLink>
        <Link href={DEMO_REQUEST_NAV.href} className="text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
          {DEMO_REQUEST_NAV.label}
        </Link>
      </div>
      <p className="mt-4 text-[13px] text-ink-muted">
        Or one report for one institution:{" "}
        <TrackLink
          event="request_report_click"
          eventProps={{ placement: "benchmark_closing" }}
          href={INSTITUTION_REPORT_HREF}
          className="font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          the {REPORT_OFFER.name}, {REPORT_PRICE_INLINE}
        </TrackLink>
        .
      </p>
    </section>
  );
}

export function ReportMethodology({ area, district = false }: { area: string; district?: boolean }) {
  return (
    <section id="methodology" className="scroll-mt-28 rounded-2xl border border-border bg-white p-6 sm:p-8">
      <SectionHeading eyebrow="Methodology" title="How this report is built" />
      <div className="mt-5 grid gap-5 text-[13px] leading-relaxed text-ink-soft md:grid-cols-3">
        <p>
          <span className="block font-semibold text-ink">Sources.</span>
          Published fee schedules from FDIC-insured banks and NCUA-insured credit unions in {area}. Every fee is read from
          the institution&apos;s own document and verified before it is published.
          {district && " Institutions are placed in a Fed district by their headquarters state."}
        </p>
        <p>
          <span className="block font-semibold text-ink">Statistics.</span>
          Each institution counts once per fee. A fee appears only with at least {MIN_BENCHMARK_INSTITUTIONS} institutions
          behind it, and a bank or credit union median needs at least {MIN_CHARTER_INSTITUTIONS}.
        </p>
        <p>
          <span className="block font-semibold text-ink">Comparison.</span>
          The national figure is the same statistic over every institution in the {PRODUCT_NAME}. Differences under 1% are
          shown as in line.{" "}
          <Link href="/methodology" className="font-semibold text-brick hover:underline print:hidden">
            Full methodology &rarr;
          </Link>
        </p>
      </div>
    </section>
  );
}
