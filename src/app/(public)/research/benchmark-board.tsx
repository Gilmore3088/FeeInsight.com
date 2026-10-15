import Link from "next/link";
import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { formatCount } from "@/lib/public-stats";
import { SectionHeading } from "./research-hero";
import { ExhibitSource } from "./exhibits";
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

const MONO_FIGURE = { fontFamily: "var(--fi-font-mono)" } as const;

function pct(value: number, scaleMax: number): number {
  return Math.max(0, Math.min(100, (value / scaleMax) * 100));
}

function BenchmarkCard({ fee }: { fee: FeeCategorySummary }) {
  const median = fee.median_amount!;
  const p25 = fee.p25_amount!;
  const p75 = fee.p75_amount!;
  // Each card has its own $0-based scale wide enough to show the middle half with room.
  const scaleMax = Math.max(p75 * 1.5, median * 2, 1);
  const zeroShare = fee.institution_count > 0 ? fee.zero_count / fee.institution_count : 0;
  const charterTotal = fee.bank_count + fee.cu_count;
  const bankShare = charterTotal > 0 ? fee.bank_count / charterTotal : 0;

  return (
    <Link
      href={`/fees/${fee.fee_category}`}
      className="group flex flex-col rounded-2xl border border-border bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-brick/30 hover:shadow-lg hover:shadow-[#b23a32]/5"
    >
      <p className="text-[12px] font-semibold text-ink-soft group-hover:text-brick">{getDisplayName(fee.fee_category)}</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[2.25rem] font-semibold leading-none tabular-nums text-ink" style={MONO_FIGURE}>
          {formatAmount(median)}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">median</span>
      </p>

      {/* Range: track is $0 to the card's scale; box is the middle half; tick is the median. */}
      <div className="mt-5" aria-hidden="true">
        <div className="relative h-3 rounded-full bg-surface-200">
          <div
            className="absolute inset-y-0 rounded-full bg-brick/25"
            style={{ left: `${pct(p25, scaleMax)}%`, width: `${Math.max(pct(p75, scaleMax) - pct(p25, scaleMax), 1.5)}%` }}
          />
          <div
            className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-full bg-brick"
            style={{ left: `${pct(median, scaleMax)}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-ink-muted">
          <span>$0</span>
          <span>{formatAmount(scaleMax)}</span>
        </div>
      </div>
      <p className="mt-1 text-[12px] text-ink-soft">
        Middle half pay <span className="font-semibold tabular-nums text-ink">{formatAmount(p25)}</span> to{" "}
        <span className="font-semibold tabular-nums text-ink">{formatAmount(p75)}</span>
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-surface-200 pt-3 text-[11px] text-ink-muted">
        <div>
          <p className="font-semibold tabular-nums text-ink">{formatCount(fee.institution_count)}</p>
          <p>institutions</p>
          <p className="text-[10px] text-ink-muted">{formatCount(fee.total_observations)} published fee entries</p>
          {/* Bank vs credit union mix behind this median. */}
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-below-market/50" title="Banks vs credit unions">
            <div className="bg-ink" style={{ width: `${bankShare * 100}%` }} />
          </div>
          <p className="mt-1 text-[10px] text-ink-muted">
            <span aria-hidden="true" className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-ink" />
            {formatCount(fee.bank_count)} banks{" "}
            <span aria-hidden="true" className="ml-1 mr-1 inline-block h-1.5 w-1.5 rounded-full bg-below-market/70" />
            {formatCount(fee.cu_count)} CUs
          </p>
        </div>
        <div>
          <p className="font-semibold tabular-nums text-ink">{Math.round(zeroShare * 100)}%</p>
          <p>list it at $0</p>
          <p className="mt-1 text-[10px] text-ink-muted">{formatCount(fee.zero_count)} institutions</p>
        </div>
      </div>
    </Link>
  );
}

export function BenchmarkBoard({ benchmarks, institutionsLabel, asOf }: { benchmarks: FeeCategorySummary[]; institutionsLabel: string; asOf: string | null }) {
  return (
    <section id="benchmarks" className="scroll-mt-28 print:break-inside-avoid">
      <SectionHeading
        eyebrow="Exhibit 1 · National benchmarks"
        title="The everyday fees, at a glance"
        action={
          <Link href="/fees" className="rounded-full border border-ink px-4 py-2 text-[12px] font-semibold text-ink transition-colors hover:bg-ink hover:text-white">
            All fee categories &rarr;
          </Link>
        }
      >
        Medians and the middle half of prices from {institutionsLabel} institutions with published fees. Each card
        shows how many institutions its median covers. The tick marks the median; the shaded band is where the
        middle 50% of institutions land.
      </SectionHeading>

      {benchmarks.length > 0 ? (
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {benchmarks.map((fee) => (
            <BenchmarkCard key={fee.fee_category} fee={fee} />
          ))}
        </div>
      ) : (
        <p className="mt-7 rounded-2xl border border-dashed border-border px-5 py-8 text-center text-[13px] text-ink-muted">
          Benchmarks are refreshing. Check back shortly.
        </p>
      )}
      <ExhibitSource asOf={asOf}>
        Median and 25th to 75th percentile of one value per institution. Fees shown only with at least 10 institutions.
      </ExhibitSource>
    </section>
  );
}
