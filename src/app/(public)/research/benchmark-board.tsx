import Link from "next/link";
import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { formatCount } from "@/lib/public-stats";
import { PRODUCT_NAME } from "@/lib/constants";
import { HubSection } from "./district/[id]/district-hub";
import { ShowMore } from "./show-more";
import { institutionValues, money, sentenceName, shareLabel } from "./findings";
import { BENCHMARK_KEYS } from "@/lib/research-report/benchmark-keys";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, medianHasUnstatedAudience } from "@/components/unstated-audience";

export { BENCHMARK_KEYS };

/** Fewer institutions than this and a median is too thin to headline. */
const MIN_INSTITUTIONS = 10;

export function pickBenchmarks(summaries: FeeCategorySummary[]): FeeCategorySummary[] {
  return BENCHMARK_KEYS.map((k) => summaries.find((s) => s.fee_category === k)).filter(
    (s): s is FeeCategorySummary =>
      !!s && s.median_amount != null && s.p25_amount != null && s.p75_amount != null && s.institution_count >= MIN_INSTITUTIONS,
  );
}

function pct(value: number, scaleMax: number): number {
  return Math.max(0, Math.min(100, (value / scaleMax) * 100));
}

/** One fee as a compact row; opening it shows the range chart, the bank and credit union split, and the $0 share. */
function BenchmarkRow({ fee }: { fee: FeeCategorySummary }) {
  const median = fee.median_amount!;
  const p25 = fee.p25_amount!;
  const p75 = fee.p75_amount!;
  // Each row has its own $0-based scale wide enough to show the middle half with room.
  const scaleMax = Math.max(p75 * 1.5, median * 2, 1);
  const name = getDisplayName(fee.fee_category);

  return (
    <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-3.5 hover:bg-paper sm:grid-cols-[minmax(0,1fr)_7rem_9rem_8rem_1rem] sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="text-[14px] font-semibold text-ink">{name}</span>
          <span className="text-right text-[15px] font-semibold tabular-nums text-ink">
            {formatAmount(median)}
            <UnstatedAudienceMark show={medianHasUnstatedAudience(fee)} />
            <span className="sr-only"> median</span>
          </span>
          <span className="col-span-2 text-[12px] text-ink-muted sm:col-span-1 sm:tabular-nums sm:text-right sm:text-[13px] sm:text-ink-soft">
            <span className="sm:hidden">Middle 50% </span>
            {formatAmount(p25)} to {formatAmount(p75)}
            <span className="sm:hidden"> · {formatCount(fee.institution_count)} institutions</span>
          </span>
          <span className="hidden text-right text-[13px] tabular-nums text-ink-soft sm:block">{formatCount(fee.institution_count)}</span>
          <span aria-hidden="true" className="hidden text-right text-ink-muted transition-transform group-open:rotate-90 sm:block">&rsaquo;</span>
        </summary>

        <div className="space-y-4 border-t border-surface-200 bg-paper/60 px-4 py-4 sm:px-5">
          {/* Range: track is $0 to the row's scale; band is the middle half; tick is the median. */}
          <div aria-hidden="true">
            <div className="relative h-3 rounded-full bg-surface-200">
              <div
                className="absolute inset-y-0 rounded-full bg-brick/25"
                style={{ left: `${pct(p25, scaleMax)}%`, width: `${Math.max(pct(p75, scaleMax) - pct(p25, scaleMax), 1.5)}%` }}
              />
              <div className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-full bg-brick" style={{ left: `${pct(median, scaleMax)}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-ink-muted">
              <span>$0</span>
              <span>{formatAmount(scaleMax)}</span>
            </div>
          </div>
          <p className="text-[13px] text-ink-soft">
            Median {formatAmount(median)}. Middle 50% of {institutionValues(fee.fee_category)}: {formatAmount(p25)} to {formatAmount(p75)}.
          </p>

          <dl className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-white px-3 py-2.5">
              <dt className="text-ink-muted">Banks</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                {fee.bank_median_amount != null ? `${formatAmount(fee.bank_median_amount)} median` : "Too few for a median"}
              </dd>
              <dd className="text-[11px] text-ink-muted">{formatCount(fee.bank_count)} banks</dd>
            </div>
            <div className="rounded-xl border border-border bg-white px-3 py-2.5">
              <dt className="text-ink-muted">Credit unions</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                {fee.cu_median_amount != null ? `${formatAmount(fee.cu_median_amount)} median` : "Too few for a median"}
              </dd>
              <dd className="text-[11px] text-ink-muted">{formatCount(fee.cu_count)} credit unions</dd>
            </div>
            <div className="col-span-2 rounded-xl border border-border bg-white px-3 py-2.5 sm:col-span-1">
              <dt className="text-ink-muted">Publish only $0</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-ink">{shareLabel(fee.zero_count, fee.institution_count)}</dd>
              <dd className="text-[11px] text-ink-muted">
                {formatCount(fee.zero_count)} {fee.zero_count === 1 ? "institution" : "institutions"} whose every price is $0
              </dd>
            </div>
          </dl>

          <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11px] text-ink-muted">
            <span>
              {formatCount(fee.institution_count)} institutions, {formatCount(fee.total_observations)} published fee entries.
            </span>
            <Link href={`/fees/${fee.fee_category}`} className="text-[12px] font-semibold text-brick hover:underline">
              See every published price &rarr;
            </Link>
          </p>
        </div>
      </details>
  );
}

/**
 * The section's one finding: which of these fees has the highest median and which the lowest.
 * Null with fewer than two fees, so a thin board never forces a headline.
 */
export function benchmarkFinding(benchmarks: FeeCategorySummary[]): string | null {
  if (benchmarks.length < 2) return null;
  const sorted = [...benchmarks].sort((a, b) => b.median_amount! - a.median_amount!);
  const high = sorted[0];
  const low = sorted[sorted.length - 1];
  if (high.median_amount === low.median_amount) return null;
  return `Of these ${benchmarks.length} fees, ${sentenceName(high.fee_category)} has the highest median (${money(high.median_amount)}) and ${sentenceName(low.fee_category)} the lowest (${money(low.median_amount)}).`;
}

export function BenchmarkBoard({ benchmarks, asOf }: { benchmarks: FeeCategorySummary[]; asOf: string | null }) {
  return (
    <HubSection
      id="benchmarks"
      title="National benchmarks"
      line={benchmarkFinding(benchmarks) ?? undefined}
      source={
        <>
          {PRODUCT_NAME}, verified published fee schedules, one value per institution; a fee is shown only when at least {MIN_INSTITUTIONS}{" "}
          institutions publish it.{asOf ? ` Data as of ${asOf}.` : ""}
          <UnstatedAudienceFootnote show={benchmarks.some(medianHasUnstatedAudience)} className="mt-2 sm:mx-0 sm:text-left" />
        </>
      }
    >
      {benchmarks.length > 0 ? (
        <div>
          <p className="text-[13px] font-semibold text-ink">Median published price, U.S. banks and credit unions</p>
          <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-white">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[minmax(0,1fr)_7rem_9rem_8rem_1rem] gap-x-4 border-b border-border px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted sm:grid"
            >
              <span>Fee</span>
              <span className="text-right">Median</span>
              <span className="text-right">Middle 50%</span>
              <span className="text-right">Institutions</span>
              <span />
            </div>
            <ShowMore
              noun="fees"
              ariaLabel="National benchmark fees"
              className="divide-y divide-surface-200"
              items={benchmarks.map((fee) => ({ key: fee.fee_category, node: <BenchmarkRow fee={fee} /> }))}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <details className="group">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-brick [&::-webkit-details-marker]:hidden">
                How these are calculated
                <span aria-hidden="true" className="transition-transform group-open:rotate-90">&rsaquo;</span>
              </summary>
              <p className="max-w-3xl text-[13px] leading-relaxed text-ink-muted sm:mx-0 sm:text-left">
                Each institution counts once, at the median of its published prices for the fee (overdraft: its highest). The
                median and the middle 50% (25th to 75th percentile) are taken across those values. Open a fee for its range,
                banks and credit unions side by side, and the share of institutions that publish only $0.
              </p>
            </details>
            <Link href="/fees" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
              All fee categories &rarr;
            </Link>
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-[13px] text-ink-muted">
          Benchmarks are refreshing. Check back shortly.
        </p>
      )}
    </HubSection>
  );
}
