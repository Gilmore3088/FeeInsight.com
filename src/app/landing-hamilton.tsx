import { ArrowLeftRight, ArrowUpRight, Check, Files, Landmark, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { HAMILTON_PAGE_NAV } from "@/components/nav-items";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { placeLabel } from "./market-report/report-body";
import { HamiltonCarousel, type HamiltonSlide } from "./landing-hamilton-carousel";
import { cardMoney } from "./landing-index-view";
import { HOME_WRAP, SAMPLE_REPORT_HREF, SANS, buildSampleView, type SampleRow, type SampleView } from "./landing-shared";

/** Benchmark rows shown, in report order. */
const BENCHMARK_ROWS = 3;
/** Fees the Analyze answer names. */
const ANALYZE_ROWS = 2;

const QUESTION = "border-b border-border pb-3 text-[22px] font-semibold leading-[1.12] tracking-[-0.025em] text-ink sm:text-[25px]";
const NOTE = "mt-4 text-[13px] leading-relaxed text-ink-soft";
const LABEL = "mb-2 text-[12px] text-ink-muted";

function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-brick underline decoration-brick/40 underline-offset-4 hover:decoration-brick">
      {children}
      <ArrowUpRight aria-hidden="true" className="size-3.5" />
    </a>
  );
}

/**
 * The fees the Analyze answer starts with: those above the local middle half first, then the
 * furthest from the local median relative to it. It names where a fee sits; it never says what
 * a fee should be (editorial policy §3).
 */
export function analyzePicks(rows: SampleRow[]): SampleRow[] {
  const gap = (r: SampleRow) => (r.median > 0 ? Math.abs(r.amount - r.median) / r.median : 0);
  return [...rows]
    .sort((a, b) => Number(b.position === "above_market") - Number(a.position === "above_market") || gap(b) - gap(a))
    .slice(0, ANALYZE_ROWS);
}

/** "Start with your outgoing international wire and stop payment fees." */
export function analyzeAnswer(picks: SampleRow[]): string {
  const names = picks.map((p) => p.label.toLowerCase());
  if (names.length === 0) return "Start where your fees sit furthest from the market.";
  return `Start with your ${names.join(" and ")} ${names.length === 1 ? "fee" : "fees"}.`;
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
    <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)] items-center gap-3 border-b border-border py-2.5 text-[13px]">
      <span className="text-ink">{row.label}</span>
      <strong className="text-[19px] font-semibold leading-none tabular-nums text-ink">{cardMoney(row.amount)}</strong>
      <span className="text-right text-[12px] text-ink-muted">Local median {cardMoney(row.median)}</span>
    </div>
  );
}

function sampleSlides(sample: SampleView, market: string | null): HamiltonSlide[] {
  const rows = sample.rows;
  const picks = analyzePicks(rows);
  const counts = positionCounts(rows);
  const name = sample.institutionName;
  return [
    {
      key: "benchmark",
      name: "Benchmark",
      line: "Compare local, state and national fees.",
      heading: "Benchmark your market",
      body: (
        <>
          <p className={LABEL}>Published sample · {name}</p>
          <p className={QUESTION}>How do our fees compare locally?</p>
          <p className="mt-3 text-[12px] text-ink-muted">{market ? `${market} · ` : ""}Published fee schedules</p>
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
          <p className={NOTE}>See the market around you, with the schedule behind each number.</p>
          <SourceLink href={SAMPLE_REPORT_HREF}>View the published sample</SourceLink>
        </>
      ),
    },
    {
      key: "analyze",
      name: "Analyze",
      line: "Decide what deserves a closer look.",
      heading: "Analyze your options",
      body: (
        <>
          <p className={LABEL}>Illustrative analysis · {name}</p>
          <p className={QUESTION}>Which fees should we review next?</p>
          <p className="mb-1 mt-3 text-[12px] text-ink-muted">Answer:</p>
          <p className="mb-3 text-[24px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[28px]">{analyzeAnswer(picks)}</p>
          {picks.map((row) => (
            <FeeRow key={row.key} row={row} />
          ))}
          <p className={NOTE}>Review service costs and waiver policies before you settle on a price.</p>
          <SourceLink href={SAMPLE_REPORT_HREF}>View supporting evidence</SourceLink>
          <p className="mt-2 text-[11px] text-ink-muted">Based on the published sample report.</p>
        </>
      ),
    },
    {
      key: "monitor",
      name: "Monitor",
      line: "Follow competitor fee changes.",
      heading: "Monitor what matters",
      body: (
        <>
          <p className={LABEL}>Illustrative monitoring workspace</p>
          <p className={QUESTION}>Keep your market in view.</p>
          <p className={NOTE}>Follow the institutions and fees that matter to your next decision.</p>
          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              { icon: Landmark, title: "Local competitors", line: `${sample.competitors} with published fees` },
              { icon: Files, title: "Fee schedules", line: "Published source documents" },
              ...picks.map((p) => ({ icon: p.key.startsWith("wire") ? ArrowLeftRight : ReceiptText, title: p.label, line: `Published by ${p.competitors} local competitors` })),
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
          <p className={NOTE}>See a schedule change, check its source, and bring it into your analysis.</p>
          <SourceLink href={HAMILTON_PAGE_NAV.href}>Explore Hamilton</SourceLink>
        </>
      ),
    },
    {
      key: "report",
      name: "Report",
      line: "Bring clear evidence to your board.",
      heading: "Report with confidence",
      body: (
        <>
          <p className="mb-2 flex justify-between text-[11px] uppercase tracking-[0.08em] text-ink-muted">
            <span>Competitive fee position</span>
            <span>Published sample</span>
          </p>
          <p className="text-[24px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[27px]">{name} against its local market</p>
          {market ? <p className="mt-1 text-[12px] text-ink-muted">{market}</p> : null}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { n: counts.above, line: "above the local middle half" },
              { n: counts.inside, line: "inside the local middle half" },
              { n: counts.below, line: "below the local middle half" },
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
              {rows.length} fees compared with {sample.competitors} local competitors
            </li>
            <li className="flex items-center gap-2 border-b border-border py-2">
              <Check aria-hidden="true" className="size-3.5 text-brick" />
              The source schedule behind every figure
            </li>
          </ul>
          <SourceLink href={SAMPLE_REPORT_HREF}>Read the sample report</SourceLink>
        </>
      ),
    },
  ];
}

/** Without a ready sample, each example says what it does and links on; no stand-in figures. */
function plainSlides(): HamiltonSlide[] {
  const plain = (key: HamiltonSlide["key"], name: string, line: string, heading: string, question: string, note: string): HamiltonSlide => ({
    key,
    name,
    line,
    heading,
    body: (
      <>
        <p className={QUESTION}>{question}</p>
        <p className={NOTE}>{note}</p>
        <SourceLink href={HAMILTON_PAGE_NAV.href}>Explore Hamilton</SourceLink>
      </>
    ),
  });
  return [
    plain("benchmark", "Benchmark", "Compare local, state and national fees.", "Benchmark your market", "How do our fees compare locally?", "See the market around you, with the schedule behind each number."),
    plain("analyze", "Analyze", "Decide what deserves a closer look.", "Analyze your options", "Which fees should we review next?", "Find where your fees sit furthest from your market, with the evidence."),
    plain("monitor", "Monitor", "Follow competitor fee changes.", "Monitor what matters", "Keep your market in view.", "Follow the institutions and fees that matter to your next decision."),
    plain("report", "Report", "Bring clear evidence to your board.", "Report with confidence", "Bring the evidence to your board.", "Every figure in the report traces to a published schedule."),
  ];
}

/** Rows the sample must compare for its examples to read as examples. */
const MIN_SAMPLE_ROWS = 3;

/**
 * The Hamilton band (James's example, Oct 17): "From market data to your next move." with four
 * examples from the live sample report for Capital City Bank, the demo bank (loadSampleReport).
 */
export function LandingHamilton({ report }: { report: MarketReport | null }) {
  const sample = buildSampleView(report);
  const market = report?.data.market?.places[0] ? placeLabel(report.data.market.places[0]) : null;
  const slides = sample && sample.rows.length >= MIN_SAMPLE_ROWS ? sampleSlides(sample, market) : plainSlides();
  return (
    <section id="hamilton" aria-labelledby="hamilton-title" className="scroll-mt-20 bg-paper py-12 sm:py-16 lg:py-20">
      <div className={HOME_WRAP}>
        <HamiltonCarousel
          slides={slides}
          intro={
            <>
              <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-brick">
                <span aria-hidden="true" className="h-0.5 w-9 bg-brick" />
                Hamilton
              </p>
              <h2 id="hamilton-title" className="fi-home-h2 mt-5 !font-semibold text-ink" style={SANS}>
                <span className="block whitespace-nowrap">From market data</span>
                <span className="block whitespace-nowrap">to your next move.</span>
              </h2>
              <p className="mt-5 text-[18px] leading-[1.45] text-ink-soft sm:text-[21px]">
                Your on-demand fee consultant.
                <br />
                Built around your institution.
              </p>
            </>
          }
        />
      </div>
    </section>
  );
}
