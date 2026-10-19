import { ArrowLeftRight, ArrowUpRight, Check, Landmark, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { incomeLabel, quarterLabel, type RevenueContext } from "@/lib/custom-report/revenue-context";
import type { ReportPeerFinancial } from "@/lib/custom-report/peer-context";
import { placeLabel } from "./market-report/report-body";
import { HamiltonCarousel, type HamiltonSlide } from "./landing-hamilton-carousel";
import { cardMoney } from "./landing-index-view";
import { HOME_WRAP, SAMPLE_REPORT_HREF, SERIF, buildSampleView, type SampleRow, type SampleView } from "./landing-shared";

/** Fees the Monitor example names. */
const ANALYZE_ROWS = 2;

const QUESTION = "border-b border-border pb-3 text-[22px] font-semibold leading-[1.12] tracking-[-0.025em] text-ink sm:text-[25px]";

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
/** Service charges as a share of revenue beside the median for its size, when the Call Report read has it. */
export function feeShareOf(financial: ReportPeerFinancial | null | undefined): { own: string; median: string } | null {
  const row = financial?.rows.find((r) => r.key === "fee_income_ratio");
  return row ? { own: `${row.own.toFixed(1)}%`, median: `${row.median.toFixed(1)}%` } : null;
}

function PrioritizeContext({ revenue, filing, financial, peerNoun }: { revenue: RevenueContext | null; filing: string; financial: ReportPeerFinancial | null; peerNoun: string }) {
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
  const share = feeShareOf(financial);
  if (share) items.push({ line: `Share of revenue, its own / median for ${peerNoun} its size`, value: `${share.own} / ${share.median}` });
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

/** "Q2 2026" figures, oldest quarter first, each bar against the largest of them. */
function IncomeTrend({ revenue }: { revenue: RevenueContext }) {
  const quarters = [...revenue.quarters].reverse();
  const top = Math.max(...quarters.map((q) => q.thousands), revenue.peer?.medianThousands ?? 0);
  return (
    <dl className="mt-3 text-[12px]" data-benchmark-income>
      {quarters.map((q) => (
        <div key={q.quarter} className="grid grid-cols-[4.25rem_minmax(0,1fr)_6.5rem] items-center gap-3 py-1">
          <dt className="text-ink-soft tabular-nums">{quarterLabel(q.quarter)}</dt>
          <span aria-hidden="true" className="h-2 rounded-full bg-brick/70" style={{ width: `${Math.max(4, (q.thousands / top) * 100)}%` }} />
          <dd className="text-right font-semibold tabular-nums text-ink">{incomeLabel(q.thousands)}</dd>
        </div>
      ))}
      {revenue.peer ? (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_6.5rem] items-baseline gap-3 border-t border-border pt-2" data-benchmark-peer>
          <dt className="min-w-0 text-ink-soft">
            Median for its size ({revenue.peer.tierLabel}), {quarterLabel(revenue.quarters[0].quarter)}
          </dt>
          <dd className="text-right font-semibold tabular-nums text-ink">{incomeLabel(revenue.peer.medianThousands)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * One investigation of the sample bank, start to finish (James's landing critique, Oct 18, §4-5):
 * its reported service-charge income against institutions of its size (Benchmark), the benchmark
 * difference selected for review with that income beside it (Prioritize), the local competitors that
 * publish the same fees (Monitor), and the question the evidence puts to management (Report). Every
 * figure is the sample report's or the revenue read's; a read that is missing hides its figures.
 * Nothing here works out a fee's revenue or says what a fee should be (editorial policy §3).
 */
function sampleSlides(sample: SampleView, revenue: RevenueContext | null, filing: string, financial: ReportPeerFinancial | null, peerNoun: string): HamiltonSlide[] {
  const share = feeShareOf(financial);
  const rows = sample.rows;
  const picks = analyzePicks(rows);
  const counts = positionCounts(rows);
  const first = picks[0];
  const local = `${sample.competitors} local ${sample.competitors === 1 ? "competitor" : "competitors"}`;
  return [
    {
      key: "benchmark",
      name: "Benchmark",
      body: (
        <>
          <p className={QUESTION}>Where does our fee income stand?</p>
          {revenue ? (
            <>
              <p className="mt-3 text-[12px] font-semibold text-ink">Deposit service charges by quarter</p>
              <IncomeTrend revenue={revenue} />
              {revenue.peer ? (
                <p className="mt-2 text-[12px] text-ink-soft" data-benchmark-rank>
                  Ranks {revenue.peer.rank.toLocaleString("en-US")} of {revenue.peer.count.toLocaleString("en-US")} banks and credit unions its size, where 1 is the highest
                </p>
              ) : null}
              {share ? (
                <p className="mt-1 text-[12px] text-ink-soft" data-benchmark-share>
                  {share.own} of its revenue, against a {share.median} median for {peerNoun} its size
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-ink-muted">Source: {filing}</p>
            </>
          ) : (
            <p className="mt-3 text-[12px] leading-snug text-ink-muted">
              Service-charge income from each quarter&rsquo;s {filing}, against institutions of its size
            </p>
          )}
        </>
      ),
    },
    {
      key: "analyze",
      name: "Prioritize",
      body: (
        <>
          <p className={QUESTION}>Which fees should we review next?</p>
          <ol className="mt-2">
            <Step n={1} name="Observation">
              <p className="mt-0.5 text-[12px] text-ink-muted">Benchmark difference selected for review</p>
              <FeeRow row={first} />
            </Step>
            <Step n={2} name="Context">
              <PrioritizeContext revenue={revenue} filing={filing} financial={financial} peerNoun={peerNoun} />
            </Step>
            <Step n={3} name="Next research step">
              <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">See which local competitors publish this fee, then prepare a documented assessment.</p>
            </Step>
          </ol>
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
        </>
      ),
    },
    {
      key: "report",
      name: "Report",
      body: (
        <>
          <p className={QUESTION}>What do we take to management?</p>
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
              <Check aria-hidden="true" className="size-3.5 shrink-0 text-brick" />
              {rows.length} {rows.length === 1 ? "fee" : "fees"} against {local}
            </li>
            {revenue ? (
              <li className="flex items-center gap-2 border-b border-border py-2" data-report-income>
                <Check aria-hidden="true" className="size-3.5 shrink-0 text-brick" />
                {incomeLabel(revenue.quarters[0].thousands)} in deposit service charges, {quarterLabel(revenue.quarters[0].quarter)}
              </li>
            ) : null}
          </ul>
          <div className="mt-3 rounded-[5px] border-l-2 border-brick bg-paper px-3 py-2.5" data-report-question>
            <p className="text-[12px] font-semibold text-ink">Question for management</p>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">
              {first.label} is {cardMoney(first.amount)} against a {cardMoney(first.median)} local median. What volume and fee income sit behind it?
            </p>
          </div>
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
<p className={QUESTION}>{question}</p>
    ),
  });
  return [
    plain("benchmark", "Benchmark", "Where does our fee income stand?"),
    plain("analyze", "Prioritize", "Which fees should we review next?"),
    plain("monitor", "Monitor", "Which local competitors can we watch?"),
    plain("report", "Report", "What do we take to management?"),
  ];
}

/** Rows the sample must compare for its examples to read as examples. */
const MIN_SAMPLE_ROWS = 3;

/**
 * The Hamilton band (James's example, Oct 17; the investigation, James's landing critique, Oct 18):
 * "Defend each fee with its source." with one investigation of Capital City Bank, the demo bank, from
 * the live sample report (loadSampleReport) and the bank's own reported service-charge income
 * (`revenue`, getRevenueContextCached). One primary action, the subscription, and one quiet link to
 * the sample report (critique §7: one primary action per section).
 */
export function LandingHamilton({
  report,
  revenue = null,
  financial = null,
}: {
  report: MarketReport | null;
  revenue?: RevenueContext | null;
  /** Call Report figures beside peers of its size; the share-of-revenue lines are left out when null. */
  financial?: ReportPeerFinancial | null;
}) {
  const sample = buildSampleView(report);
  const market = report?.data.market?.places[0] ? placeLabel(report.data.market.places[0]) : null;
  const filing = report?.data.subject.charter_type === "credit_union" ? "NCUA 5300 Call Report" : "FDIC Call Report";
  const ready = sample !== null && sample.rows.length >= MIN_SAMPLE_ROWS;
  const slides = ready ? sampleSlides(sample, revenue, filing, financial, report?.data.subject.charter_type === "credit_union" ? "credit unions" : "banks") : plainSlides();
  return (
    <section id="hamilton" aria-labelledby="hamilton-title" className="scroll-mt-20 bg-paper py-12 sm:py-16 lg:py-20">
      <div className={HOME_WRAP}>
        <HamiltonCarousel
          slides={slides}
          subject={ready ? `Sample: ${sample.institutionName}${market ? ` · ${market}` : ""}` : null}
          intro={
            <>
              <h2 id="hamilton-title" className="fi-home-h2 !font-medium text-ink" style={SERIF}>
                {/* No nowrap: the longer first line could overflow a 320px phone; balance keeps both words paired. */}
                <span className="block">Make fee decisions</span> <span className="block">you can defend.</span>
              </h2>
              <p className="mt-5 text-[18px] leading-[1.45] text-ink-soft sm:text-[21px]">
                Hamilton connects your financial performance, competitive position and published evidence, so your team
                knows what to investigate next.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
                <TrackLink
                  event="upgrade_click"
                  eventProps={{ placement: "home_hamilton" }}
                  href={PRO_PLANS_NAV.href}
                  className="fi-btn fi-btn-brick min-h-12 px-6 text-[15px]"
                >
                  Get Hamilton for your institution
                </TrackLink>
                {ready ? (
                  <a
                    href={SAMPLE_REPORT_HREF}
                    className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-ink-soft underline decoration-ink-muted/40 underline-offset-4 hover:text-ink"
                    data-sample-link
                  >
                    See the sample report
                    <ArrowUpRight aria-hidden="true" className="size-3.5" />
                  </a>
                ) : null}
              </div>
            </>
          }
        />
      </div>
    </section>
  );
}
