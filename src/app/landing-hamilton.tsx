import { ArrowLeftRight, ArrowUpRight, Check, Landmark, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { DEMO_REQUEST_NAV, HAMILTON_PAGE_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { incomeLabel, quarterLabel, type RevenueContext } from "@/lib/custom-report/revenue-context";
import { placeLabel } from "./market-report/report-body";
import { HamiltonCarousel, type HamiltonSlide } from "./landing-hamilton-carousel";
import { cardMoney } from "./landing-index-view";
import { HOME_WRAP, SAMPLE_REPORT_HREF, SERIF, buildSampleView, type SampleRow, type SampleView } from "./landing-shared";

/** Benchmark rows shown, in report order. */
const BENCHMARK_ROWS = 3;
/** Fees the Monitor example names. */
const ANALYZE_ROWS = 2;

/** The one source line under a slide's question: the sample bank and its market. */
const SAMPLE = "mt-3 text-[12px] text-ink-muted";
const QUESTION = "border-b border-border pb-3 text-[22px] font-semibold leading-[1.12] tracking-[-0.025em] text-ink sm:text-[25px]";

function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-brick underline decoration-brick/40 underline-offset-4 hover:decoration-brick">
      {children}
      <ArrowUpRight aria-hidden="true" className="size-3.5" />
    </a>
  );
}

/**
 * The benchmark differences selected for review: fees above the local middle half first, then
 * the furthest from the local median relative to it. Prioritize shows the first; Monitor both. It names where a fee sits; it never says what
 * a fee should be (editorial policy §3).
 */
export function analyzePicks(rows: SampleRow[]): SampleRow[] {
  const gap = (r: SampleRow) => (r.median > 0 ? Math.abs(r.amount - r.median) / r.median : 0);
  return [...rows]
    .sort((a, b) => Number(b.position === "above_market") - Number(a.position === "above_market") || gap(b) - gap(a))
    .slice(0, ANALYZE_ROWS);
}

export function positionCounts(rows: SampleRow[]): { above: number; inside: number; below: number } {
  return {
    above: rows.filter((r) => r.position === "above_market").length,
    inside: rows.filter((r) => r.position === "in_market").length,
    below: rows.filter((r) => r.position === "below_market").length,
  };
}

function FeeRow({ row }: { row: SampleRow }) {
  return (
    <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)] items-center gap-3 text-[13px]" data-prioritize-fee>
      <span className="text-ink">{row.label}</span>
      <strong className="text-[19px] font-semibold leading-none tabular-nums text-ink">{cardMoney(row.amount)}</strong>
      <span className="text-right text-[12px] text-ink-muted">Local median {cardMoney(row.median)}</span>
    </div>
  );
}

/** One step of the Prioritize example: its name, then what it holds. */
function Step({ n, name, children }: { n: number; name: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 border-b border-border py-2.5">
      <span aria-hidden="true" className="text-[12px] font-semibold tabular-nums text-brick">{n}</span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-ink">{name}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * What Hamilton checks next: the sample bank's own reported service-charge income and the median
 * for its size (getRevenueContextCached, the read the sample report page shows), or, without that
 * read, the questions and where each answer comes from. Never a fee's revenue (editorial policy).
 */
function PrioritizeContext({ revenue, filing }: { revenue: RevenueContext | null; filing: string }) {
  if (!revenue) {
    return (
      <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">
        Service-charge income (Call Report), competitors&rsquo; published schedules, complaint and rule records
      </p>
    );
  }
  const latest = revenue.quarters[0];
  const items = [
    { line: `Deposit service charges, ${quarterLabel(latest.quarter)}`, value: incomeLabel(latest.thousands) },
    ...(revenue.peer ? [{ line: `Median for its size (${revenue.peer.tierLabel})`, value: incomeLabel(revenue.peer.medianThousands) }] : []),
  ];
  return (
    <>
      <dl className="mt-1 text-[12px]" data-prioritize-income>
        {items.map((item) => (
          <div key={item.line} className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 text-ink-soft">{item.line}</dt>
            <dd className="shrink-0 font-semibold tabular-nums text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-0.5 text-[11px] text-ink-muted">Source: {filing}</p>
    </>
  );
}

function sampleSlides(sample: SampleView, market: string | null, revenue: RevenueContext | null, filing: string): HamiltonSlide[] {
  const rows = sample.rows;
  const picks = analyzePicks(rows);
  const counts = positionCounts(rows);
  const name = sample.institutionName;
  return [
    {
      key: "benchmark",
      name: "Benchmark",
      body: (
        <>
          <p className={QUESTION}>How do our fees compare locally?</p>
          <p className={SAMPLE}>Sample: {name}{market ? ` · ${market}` : ""}</p>
          <table className="mt-2 w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] text-ink-muted">
                <th scope="col" className="py-2 text-left font-medium">Fee</th>
                <th scope="col" className="py-2 text-right font-medium">Your fee</th>
                <th scope="col" className="py-2 text-right font-medium">Local median</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, BENCHMARK_ROWS).map((row) => (
                <tr key={row.key} className="border-b border-border">
                  <th scope="row" className="py-2.5 text-left font-normal text-ink">{row.label}</th>
                  <td className="py-2.5 text-right font-semibold tabular-nums text-ink">{cardMoney(row.amount)}</td>
                  <td className="py-2.5 text-right tabular-nums text-ink-soft">{cardMoney(row.median)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <SourceLink href={SAMPLE_REPORT_HREF}>View the sample report</SourceLink>
        </>
      ),
    },
    {
      key: "analyze",
      name: "Prioritize",
      body: (
        <>
          <p className={QUESTION}>Which fees should we review next?</p>
          <p className={SAMPLE}>Sample: {name}{market ? ` · ${market}` : ""}</p>
          <ol className="mt-2">
            {picks[0] ? (
              <Step n={1} name="Observation">
                <p className="mt-0.5 text-[12px] text-ink-muted">Benchmark difference selected for review</p>
                <FeeRow row={picks[0]} />
              </Step>
            ) : null}
            <Step n={2} name="Context">
              <PrioritizeContext revenue={revenue} filing={filing} />
            </Step>
            <Step n={3} name="Next research step">
              <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">Compare that income with peers of similar assets and prepare a documented assessment.</p>
            </Step>
          </ol>
          <SourceLink href={SAMPLE_REPORT_HREF}>View the sample report</SourceLink>
        </>
      ),
    },
    {
      key: "monitor",
      name: "Monitor",
      body: (
        <>
          <p className={QUESTION}>Which local competitors can we watch?</p>
          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              { icon: Landmark, title: "Local competitors", line: `${sample.competitors} with published fees` },
              ...picks.map((p) => ({ icon: p.key.startsWith("wire") ? ArrowLeftRight : ReceiptText, title: p.label, line: `Published by ${p.competitors} local ${p.competitors === 1 ? "competitor" : "competitors"}` })),
            ].map((item) => (
              <li key={item.title} className="flex items-center gap-2.5 rounded-[5px] bg-paper px-3 py-3">
                <item.icon aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0 text-brick" />
                <span className="min-w-0">
                  <b className="block text-[12px] font-semibold text-ink">{item.title}</b>
                  <span className="block text-[11px] text-ink-muted">{item.line}</span>
                </span>
              </li>
            ))}
          </ul>
          <SourceLink href={HAMILTON_PAGE_NAV.href}>Explore Hamilton</SourceLink>
        </>
      ),
    },
    {
      key: "report",
      name: "Report",
      body: (
        <>
          <p className="text-[24px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[27px]">{name} against its local market</p>
          {market ? <p className="mt-1 text-[12px] text-ink-muted">{market}</p> : null}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { n: counts.above, line: "above local range" },
              { n: counts.inside, line: "within local range" },
              { n: counts.below, line: "below local range" },
            ].map((s) => (
              <div key={s.line} className="rounded-[4px] bg-paper px-2 py-3 text-center">
                <strong className="block text-[24px] font-semibold leading-none text-ink">{s.n}</strong>
                <span className="mt-1.5 block text-[11px] leading-snug text-ink-muted">{s.line}</span>
              </div>
            ))}
          </div>
          <ul className="mt-3 text-[13px] text-ink">
            <li className="flex items-center gap-2 border-b border-border py-2">
              <Check aria-hidden="true" className="size-3.5 text-brick" />
              {rows.length} {rows.length === 1 ? "fee" : "fees"} vs {sample.competitors} local {sample.competitors === 1 ? "competitor" : "competitors"}
            </li>
          </ul>
          <SourceLink href={SAMPLE_REPORT_HREF}>Read the sample report</SourceLink>
        </>
      ),
    },
  ];
}

/** Without a ready sample, each example asks its question and links on; no stand-in figures. */
function plainSlides(): HamiltonSlide[] {
  const plain = (key: HamiltonSlide["key"], name: string, question: string): HamiltonSlide => ({
    key,
    name,
    body: (
      <>
        <p className={QUESTION}>{question}</p>
        <SourceLink href={HAMILTON_PAGE_NAV.href}>Explore Hamilton</SourceLink>
      </>
    ),
  });
  return [
    plain("benchmark", "Benchmark", "How do our fees compare locally?"),
    plain("analyze", "Prioritize", "Which fees should we review next?"),
    plain("monitor", "Monitor", "Which local competitors can we watch?"),
    plain("report", "Report", "What do we take to the board?"),
  ];
}

/** Rows the sample must compare for its examples to read as examples. */
const MIN_SAMPLE_ROWS = 3;

/**
 * The Hamilton band (James's example, Oct 17; headings by growth): "Defend each fee with its source." with four
 * examples from the live sample report for Capital City Bank, the demo bank (loadSampleReport). Prioritize
 * adds the bank's own reported service-charge income (`revenue`) when that read answered.
 */
export function LandingHamilton({ report, revenue = null }: { report: MarketReport | null; revenue?: RevenueContext | null }) {
  const sample = buildSampleView(report);
  const market = report?.data.market?.places[0] ? placeLabel(report.data.market.places[0]) : null;
  const filing = report?.data.subject.charter_type === "credit_union" ? "NCUA 5300 Call Report" : "FDIC Call Report";
  const slides = sample && sample.rows.length >= MIN_SAMPLE_ROWS ? sampleSlides(sample, market, revenue, filing) : plainSlides();
  return (
    <section id="hamilton" aria-labelledby="hamilton-title" className="scroll-mt-20 bg-paper py-12 sm:py-16 lg:py-20">
      <div className={HOME_WRAP}>
        <HamiltonCarousel
          slides={slides}
          intro={
            <>
              <h2 id="hamilton-title" className="fi-home-h2 !font-medium text-ink" style={SERIF}>
                <span className="block whitespace-nowrap">Defend each fee</span>
                <span className="block whitespace-nowrap">with its source.</span>
              </h2>
              <p className="mt-5 text-[18px] leading-[1.45] text-ink-soft sm:text-[21px]">
                Hamilton is your on-demand fee consultant.
              </p>
              {/* The subscription, with the demo as the alternative (James, Oct 17). */}
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
                <TrackLink
                  event="upgrade_click"
                  eventProps={{ placement: "home_hamilton" }}
                  href={PRO_PLANS_NAV.href}
                  className="fi-btn fi-btn-brick min-h-12 px-6 text-[15px]"
                >
                  Get Hamilton for your institution
                </TrackLink>
                <TrackLink
                  event="contact_sales"
                  eventProps={{ placement: "home_hamilton_demo" }}
                  href={DEMO_REQUEST_NAV.href}
                  className="inline-flex min-h-11 items-center text-[15px] font-medium text-brick underline decoration-brick/40 underline-offset-4 hover:decoration-brick"
                >
                  {DEMO_REQUEST_NAV.label}
                </TrackLink>
              </div>
            </>
          }
        />
      </div>
    </section>
  );
}
