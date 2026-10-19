import Link from "next/link";
import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { formatCount } from "@/lib/public-stats";
import { PRODUCT_NAME } from "@/lib/constants";
import { HubSection } from "./district/[id]/district-hub";
import { ZERO_PRICE_CAVEAT, institutionValues, money, sentenceName, shareLabel } from "./findings";
import { BENCHMARK_KEYS } from "@/lib/research-report/benchmark-keys";

export { BENCHMARK_KEYS };

/** Fewer institutions than this and a median is too thin to headline. */
const MIN_INSTITUTIONS = 10;

export function pickBenchmarks(summaries: FeeCategorySummary[]): FeeCategorySummary[] {
  return BENCHMARK_KEYS.map((k) => summaries.find((s) => s.fee_category === k)).filter(
    (s): s is FeeCategorySummary =>
      !!s && s.median_amount != null && s.p25_amount != null && s.p75_amount != null && s.institution_count >= MIN_INSTITUTIONS,
  );
}

/** One grid for the header and every row: Fee · Bank median · CU median · Sample size. */
const ROW_GRID =
  "sm:grid-cols-[minmax(0,1fr)_8rem_8rem_8rem_1rem] lg:grid-cols-[minmax(0,22rem)_9rem_9rem_9rem_minmax(1rem,1fr)]";

function pct(value: number, scaleMax: number): number {
  return Math.max(0, Math.min(100, (value / scaleMax) * 100));
}

/** Which charter has the lower median, so the table can say so in words as well as figures. */
function lowerSide(fee: FeeCategorySummary): "bank" | "cu" | null {
  if (fee.bank_median_amount == null || fee.cu_median_amount == null) return null;
  if (fee.bank_median_amount === fee.cu_median_amount) return null;
  return fee.bank_median_amount < fee.cu_median_amount ? "bank" : "cu";
}

function MedianCell({ value, lower, label }: { value: number | null; lower: boolean; label: string }) {
  if (value == null) return <span className="text-[12px] text-ink-muted">Too few</span>;
  return (
    <>
      <span className="font-semibold text-ink">{formatAmount(value)}</span>
      <span className="sr-only"> {label} median</span>
      {lower && <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">lower</span>}
    </>
  );
}

/** One fee as a compact row; opening it shows the distribution, the $0 share, the audience note, sources and method. */
function BenchmarkRow({ fee }: { fee: FeeCategorySummary }) {
  const median = fee.median_amount!;
  const p25 = fee.p25_amount!;
  const p75 = fee.p75_amount!;
  // Each row has its own $0-based scale wide enough to show the middle half with room.
  const scaleMax = Math.max(p75 * 1.5, median * 2, 1);
  const name = getDisplayName(fee.fee_category);
  const lower = lowerSide(fee);
  const unstated = fee.unstated_audience_institution_count ?? 0;

  return (
    <details className="group">
      <summary
        className={`grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-3.5 hover:bg-paper ${ROW_GRID} sm:px-5 [&::-webkit-details-marker]:hidden`}
      >
        <span className="text-[14px] font-semibold text-ink">{name}</span>
        <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-90 sm:hidden">&rsaquo;</span>
        <span className="col-span-2 text-[13px] tabular-nums sm:col-span-1 sm:text-right">
          <span className="text-ink-muted sm:hidden">Banks </span>
          <MedianCell value={fee.bank_median_amount} lower={lower === "bank"} label="bank" />
        </span>
        <span className="col-span-2 text-[13px] tabular-nums sm:col-span-1 sm:text-right">
          <span className="text-ink-muted sm:hidden">Credit unions </span>
          <MedianCell value={fee.cu_median_amount} lower={lower === "cu"} label="credit union" />
        </span>
        <span className="col-span-2 text-[12px] tabular-nums text-ink-muted sm:col-span-1 sm:text-right sm:text-[13px] sm:text-ink-soft">
          {formatCount(fee.institution_count)}
          <span className="sm:sr-only"> institutions</span>
        </span>
        <span aria-hidden="true" className="hidden text-right text-ink-muted transition-transform group-open:rotate-90 sm:block">&rsaquo;</span>
      </summary>

      <div className="space-y-4 border-t border-surface-200 bg-paper/60 px-4 py-4 sm:px-5">
        <div>
          <p className="text-[12px] font-semibold text-ink">Distribution, all {formatCount(fee.institution_count)} institutions</p>
          {/* Range: track is $0 to the row's scale; band is the middle half; tick is the median. */}
          <div aria-hidden="true" className="mt-2">
            <div className="relative h-3 rounded-full bg-surface-200">
              <div
                className="absolute inset-y-0 rounded-full bg-ink/20"
                style={{ left: `${pct(p25, scaleMax)}%`, width: `${Math.max(pct(p75, scaleMax) - pct(p25, scaleMax), 1.5)}%` }}
              />
              <div className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${pct(median, scaleMax)}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-ink-muted">
              <span>$0</span>
              <span>{formatAmount(scaleMax)}</span>
            </div>
          </div>
          <p className="mt-2 text-[13px] tabular-nums text-ink-soft">
            Median {formatAmount(median)}. Middle 50% of {institutionValues(fee.fee_category)}: {formatAmount(p25)} to {formatAmount(p75)}.
            {" "}{formatCount(fee.bank_count)} banks, {formatCount(fee.cu_count)} credit unions.
          </p>
        </div>

        <dl className="grid gap-3 text-[12px] sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-white px-3 py-2.5">
            <dt className="text-ink-muted">All observed prices are $0</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ink">
              {shareLabel(fee.zero_count, fee.institution_count)}
              <span className="font-normal text-ink-muted">
                {" "}({formatCount(fee.zero_count)} of {formatCount(fee.institution_count)} institutions)
              </span>
            </dd>
            <dd className="mt-1 text-[11px] leading-relaxed text-ink-muted">{ZERO_PRICE_CAVEAT}</dd>
          </div>
          <div className="rounded-xl border border-border bg-white px-3 py-2.5">
            <dt className="text-ink-muted">Audience not stated</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ink">
              {formatCount(unstated)} of {formatCount(fee.institution_count)} institutions
            </dd>
            <dd className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              {unstated > 0
                ? "Their schedules don't say personal or business, so these fees are counted as personal. A median without them isn't published yet."
                : "Every schedule in this benchmark states the audience."}
            </dd>
          </div>
        </dl>

        <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11px] leading-relaxed text-ink-muted">
          <span className="max-w-2xl">
            Source: {PRODUCT_NAME}, {formatCount(fee.total_observations)} verified entries from the institutions&apos; own published fee
            schedules. Each institution counts once, at the median of its prices (overdraft: its highest).
          </span>
          <Link href={`/fees/${fee.fee_category}`} className="inline-flex min-h-11 items-center text-[12px] font-semibold text-brick hover:underline">
            Every published price &rarr;
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
        </>
      }
    >
      {benchmarks.length > 0 ? (
        <div>
          <p className="text-[13px] font-semibold text-ink">Median published price, U.S. banks and credit unions. Open a fee for its detail.</p>
          <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-white">
            <div
              aria-hidden="true"
              className={`hidden ${ROW_GRID} gap-x-4 border-b border-border px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted sm:grid`}
            >
              <span>Fee</span>
              <span className="text-right">Bank median</span>
              <span className="text-right">CU median</span>
              <span className="text-right">Sample size</span>
              <span />
            </div>
            <ul aria-label="National benchmark fees" className="divide-y divide-surface-200">
              {benchmarks.map((fee) => (
                <li key={fee.fee_category}>
                  <BenchmarkRow fee={fee} />
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <p className="text-[12px] text-ink-muted">Sample size: institutions with a published price for the fee.</p>
            <Link href="/fees" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
              All fee categories &rarr;
            </Link>
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-[13px] text-ink-muted">
          Benchmarks are refreshing.
        </p>
      )}
    </HubSection>
  );
}
