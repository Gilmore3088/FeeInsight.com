import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { FEE_FAMILIES, getFeeFamily } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";
import { getFrequencyLabel } from "./enum-labels";

export interface DisplayFee {
  id: string;
  feeName: string;
  feeCategory: string | null;
  amount: number | null;
  frequency: string | null;
  conditions: string | null;
  status: "verified" | "provisional";
  sourceUrl: string | null;
  /** A fee stated as a rate: "1.1%" and "of the transaction". Its amount is null. */
  rate?: { rate: string; detail: string | null } | null;
}

/** National 25th / 50th / 75th percentile for one fee category. */
export interface FeeBenchmark {
  p25: number;
  median: number;
  p75: number;
}

export type FeeBenchmarks = Record<string, FeeBenchmark>;

type Position = "below" | "within" | "above";

const POSITION_DOT: Record<Position, string> = {
  below: "bg-emerald-600",
  within: "bg-[#8A8072]",
  above: "bg-amber-600",
};

const POSITION_TEXT: Record<Position, string> = {
  below: "Below the typical range",
  within: "Within the typical range",
  above: "Above the typical range",
};

function benchmarkFor(fee: DisplayFee, benchmarks: FeeBenchmarks | undefined): FeeBenchmark | null {
  if (!benchmarks || fee.status !== "verified" || fee.amount === null || !fee.feeCategory) return null;
  return benchmarks[fee.feeCategory] ?? null;
}

/**
 * A tiny bar: the shaded band is where most institutions fall nationally, the tick is
 * the national median, the dot is this fee. Dot color says below / within / above.
 */
function FeePosition({ amount, benchmark }: { amount: number; benchmark: FeeBenchmark }) {
  const position: Position =
    amount < benchmark.p25 ? "below" : amount > benchmark.p75 ? "above" : "within";
  const scaleMax = Math.max(benchmark.p75 * 1.5, amount * 1.1, 1);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / scaleMax) * 100))}%`;
  const description = `${POSITION_TEXT[position]} (${formatFeeAmount(benchmark.p25)}–${formatFeeAmount(benchmark.p75)} nationally)`;

  return (
    <span className="mt-1 inline-flex w-16 flex-col" title={description}>
      <span className="sr-only">{description}</span>
      <span aria-hidden="true" className="relative block h-2.5 w-16">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#E0D7C9]" />
        <span
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#E0D7C9]"
          style={{ left: pct(benchmark.p25), width: `calc(${pct(benchmark.p75)} - ${pct(benchmark.p25)})` }}
        />
        <span
          className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-[#8A8072]"
          style={{ left: pct(benchmark.median) }}
        />
        <span
          className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${POSITION_DOT[position]}`}
          style={{ left: pct(amount) }}
        />
      </span>
    </span>
  );
}

function PositionLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#F0EBE3] px-4 py-2 text-[11px] text-[#6B6255]">
      <span>vs. U.S. typical range:</span>
      {(["below", "within", "above"] as const).map((position) => (
        <span key={position} className="inline-flex items-center gap-1">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${POSITION_DOT[position]}`} />
          {position === "within" ? "Typical" : position === "below" ? "Lower" : "Higher"}
        </span>
      ))}
    </p>
  );
}

interface FeeGroup {
  family: string;
  rows: DisplayFee[];
  verifiedCount: number;
  provisionalCount: number;
}

const OTHER_FAMILY = "Other fees";

export interface MedianDelta {
  text: string;
  tone: "above" | "below" | "at";
}

/**
 * How a verified amount sits against the national median, in words. Null when either
 * side is missing: no comparison is better than a misleading one.
 */
export function describeMedianDelta(
  amount: number | null,
  median: number | null | undefined,
  place = "national",
): MedianDelta | null {
  if (amount === null || median === null || median === undefined) return null;
  if (!Number.isFinite(amount) || !Number.isFinite(median)) return null;
  const diff = Math.round((amount - median) * 100) / 100;
  if (Math.abs(diff) < 0.01) return { text: `At the ${place} median`, tone: "at" };
  const money = formatFeeAmount(Math.abs(diff)) ?? `$${Math.abs(diff).toFixed(2)}`;
  return diff > 0
    ? { text: `${money} above the ${place} median`, tone: "above" }
    : { text: `${money} below the ${place} median`, tone: "below" };
}

/** Home-state medians by fee category, with the state's name for the sentence. */
export interface StateMedians {
  place: string;
  medians: Map<string, number | null>;
}

const DELTA_TONE: Record<MedianDelta["tone"], string> = {
  above: "text-red-700",
  below: "text-emerald-700",
  at: "text-[#6B6255]",
};

/** Verified rows with a known category link to the national picture for that fee. */
function MedianCell({
  fee,
  medians,
  stateMedians,
}: {
  fee: DisplayFee;
  medians: Map<string, number | null>;
  stateMedians?: StateMedians;
}) {
  if (fee.status !== "verified" || !fee.feeCategory) return <span className="text-xs text-[#6B6255]">&mdash;</span>;
  const delta = describeMedianDelta(fee.amount, medians.get(fee.feeCategory));
  const stateDelta = stateMedians
    ? describeMedianDelta(fee.amount, stateMedians.medians.get(fee.feeCategory), stateMedians.place)
    : null;
  if (!delta && !stateDelta) return <span className="text-xs text-[#6B6255]">&mdash;</span>;
  return (
    <>
      {delta && (
        <Link
          href={`/fees/${fee.feeCategory}`}
          className={`text-xs font-medium underline-offset-2 hover:underline ${DELTA_TONE[delta.tone]}`}
        >
          {delta.text}
        </Link>
      )}
      {stateDelta && (
        <span className={`block text-xs ${DELTA_TONE[stateDelta.tone]}`}>{stateDelta.text}</span>
      )}
    </>
  );
}
/** A rate in the amount column, with what it is a share of beneath it. */
function RateValue({ rate }: { rate: NonNullable<DisplayFee["rate"]> }) {
  return (
    <>
      {rate.rate}
      {rate.detail && (
        <span className="block max-w-[180px] whitespace-normal text-right font-sans text-xs text-[#6B6255]">{rate.detail}</span>
      )}
    </>
  );
}

const FAMILY_ORDER = [...Object.keys(FEE_FAMILIES), OTHER_FAMILY];

function familyFor(fee: DisplayFee): string {
  return (fee.feeCategory ? getFeeFamily(fee.feeCategory) : null) ?? OTHER_FAMILY;
}

function dedupeKey(fee: DisplayFee): string {
  return `${fee.feeName.trim().toLowerCase()}|${fee.rate ? `${fee.rate.rate} ${fee.rate.detail ?? ""}` : fee.amount ?? "null"}`;
}

/** Groups fees by family, collapses duplicate name + amount pairs, keeps taxonomy order. */
export function groupFeesByFamily(fees: DisplayFee[]): FeeGroup[] {
  const groups = new Map<string, FeeGroup>();
  const seen = new Set<string>();

  for (const fee of fees) {
    const family = familyFor(fee);
    const key = `${family}|${dedupeKey(fee)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const group = groups.get(family) ?? { family, rows: [], verifiedCount: 0, provisionalCount: 0 };
    group.rows.push(fee);
    if (fee.status === "verified") group.verifiedCount += 1;
    else group.provisionalCount += 1;
    groups.set(family, group);
  }

  return FAMILY_ORDER.filter((family) => groups.has(family)).map((family) => {
    const group = groups.get(family) as FeeGroup;
    return {
      ...group,
      rows: [...group.rows].sort((a, b) => a.feeName.localeCompare(b.feeName)),
    };
  });
}

function GroupBadge({ group }: { group: FeeGroup }) {
  const verified = group.verifiedCount > 0;
  const className = verified
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${className}`}>
        {verified ? "Verified" : "Under review"}
      </span>
      {verified && group.provisionalCount > 0 && (
        <span className="text-[11px] text-[#6B6255]">{group.provisionalCount} under review</span>
      )}
    </span>
  );
}

const HEADER_CELL = "px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6B6255]";
const SERIF_STYLE = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;

const FOCUSED_ROW = "border-l-2 border-l-[#C44B2E] bg-[#C44B2E]/[0.035]";

/**
 * @param focusCategory The fee the reader came to compare (`?fee=`), highlighted and
 *   anchored so the guide → directory → profile handoff lands on the right row.
 */
export function FeeScheduleTable({
  fees,
  disclosureUrl,
  focusCategory = null,
  medians = new Map(),
  stateMedians,
  benchmarks,
}: {
  fees: DisplayFee[];
  disclosureUrl: string | null;
  focusCategory?: string | null;
  /** National medians by fee category, for the "vs national median" column. */
  medians?: Map<string, number | null>;
  /** The institution's home-state medians, shown as a second line under the national one. */
  stateMedians?: StateMedians;
  /** National percentiles by fee category; verified fees with a match get a position bar. */
  benchmarks?: FeeBenchmarks;
}) {
  const groups = groupFeesByFamily(fees);
  const isFocused = (fee: DisplayFee) => focusCategory !== null && fee.feeCategory === focusCategory;
  const anyBenchmarked = fees.some((fee) => benchmarkFor(fee, benchmarks) !== null);

  return (
    <>
      {anyBenchmarked && <PositionLegend />}
      <FeeScheduleStack
        groups={groups}
        disclosureUrl={disclosureUrl}
        isFocused={isFocused}
        medians={medians}
        stateMedians={stateMedians}
        benchmarks={benchmarks}
      />
      <div className="hidden sm:block">
        <p className="border-b border-[#F0EBE3] px-4 py-1.5 text-xs text-[#6B6255] lg:hidden">
          Swipe for source and notes &rarr;
        </p>
        <div className="table-scroll">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#E0D7C9] bg-[#FDFBF8]">
                <th scope="col" className={HEADER_CELL}>Fee</th>
                <th scope="col" className={`${HEADER_CELL} text-right`}>Amount</th>
                <th scope="col" className={HEADER_CELL}>{stateMedians ? "vs medians" : "vs national median"}</th>
                <th scope="col" className={HEADER_CELL}>Basis</th>
                <th scope="col" className={HEADER_CELL}>Note</th>
                <th scope="col" className={`${HEADER_CELL} text-right`}>Source</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.family} className="border-t border-[#E0D7C9]">
                <tr className="bg-[#FAF7F2]">
                  <th scope="rowgroup" colSpan={6} className="px-4 py-2.5 text-left">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#1A1815]">{group.family}</span>
                      <GroupBadge group={group} />
                    </div>
                  </th>
                </tr>
                {group.rows.map((fee) => (
                  <FeeRow
                    key={fee.id}
                    fee={fee}
                    disclosureUrl={disclosureUrl}
                    mixedGroup={group.verifiedCount > 0}
                    focused={isFocused(fee)}
                    medians={medians}
                    stateMedians={stateMedians}
                    benchmark={benchmarkFor(fee, benchmarks)}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </>
  );
}

function UnderReviewChip() {
  return (
    <span className="ml-2 inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
      Under review
    </span>
  );
}

/**
 * A fee's own source document, or, when the fee has none of its own, the institution's
 * general schedule, labelled as such so it never reads as the fee's exact source.
 */
function SourceLink({ href, fallback = false }: { href: string | null; fallback?: boolean }) {
  if (!href) return <span className="text-xs text-[#6B6255]">&mdash;</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold text-[#A93D25] hover:text-[#A93D25]"
    >
      {fallback ? "Institution\u2019s schedule" : "Source"}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function FeeRow({
  fee,
  disclosureUrl,
  mixedGroup,
  focused = false,
  medians,
  stateMedians,
  benchmark,
}: {
  fee: DisplayFee;
  disclosureUrl: string | null;
  mixedGroup: boolean;
  focused?: boolean;
  medians: Map<string, number | null>;
  stateMedians?: StateMedians;
  benchmark: FeeBenchmark | null;
}) {
  const sourceUrl = fee.sourceUrl ?? disclosureUrl;
  const amount = formatFeeAmount(fee.amount);
  const basis = getFrequencyLabel(fee.frequency);
  const showUnderReview = mixedGroup && fee.status === "provisional";

  return (
    <tr
      id={focused && fee.feeCategory ? `fee-${fee.feeCategory}` : undefined}
      data-fee-anchor={focused ? fee.feeCategory ?? undefined : undefined}
      className={`fi-row-interaction scroll-mt-24 border-b border-[#F0EBE3] last:border-0 ${focused ? FOCUSED_ROW : ""}`}
    >
      <td className="max-w-[320px] px-4 py-2.5 align-top">
        <span className="break-words font-medium text-[#1A1815]">{fee.feeName}</span>
        {showUnderReview && <UnderReviewChip />}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right align-top text-base tabular-nums text-[#1A1815]" style={SERIF_STYLE}>
        {fee.rate ? <RateValue rate={fee.rate} /> : amount ?? "\u2014"}
        {benchmark && fee.amount !== null && (
          <span className="flex justify-end">
            <FeePosition amount={fee.amount} benchmark={benchmark} />
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 align-top">
        <MedianCell fee={fee} medians={medians} stateMedians={stateMedians} />
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 align-top text-[#5A5347]">{basis || "\u2014"}</td>
      <td className="max-w-[280px] px-4 py-2.5 align-top text-xs leading-relaxed text-[#6B6255]">
        {fee.conditions ? <span className="break-words">{fee.conditions}</span> : "\u2014"}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right align-top">
        <SourceLink href={sourceUrl} fallback={!fee.sourceUrl} />
      </td>
    </tr>
  );
}

/** Below 640px: stacked rows — fee + amount on one line; basis, note and source beneath. */
function FeeScheduleStack({
  groups,
  disclosureUrl,
  isFocused,
  medians,
  stateMedians,
  benchmarks,
}: {
  groups: FeeGroup[];
  disclosureUrl: string | null;
  isFocused: (fee: DisplayFee) => boolean;
  medians: Map<string, number | null>;
  stateMedians?: StateMedians;
  benchmarks?: FeeBenchmarks;
}) {
  return (
    <div className="sm:hidden">
      {groups.map((group) => (
        <section key={group.family} className="border-t border-[#E0D7C9]">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#FAF7F2] px-4 py-2.5">
            <span className="text-sm font-semibold text-[#1A1815]">{group.family}</span>
            <GroupBadge group={group} />
          </div>
          <ul>
            {group.rows.map((fee) => {
              const sourceUrl = fee.sourceUrl ?? disclosureUrl;
              const basis = getFrequencyLabel(fee.frequency);
              const showUnderReview = group.verifiedCount > 0 && fee.status === "provisional";
              const focused = isFocused(fee);
              const benchmark = benchmarkFor(fee, benchmarks);
              return (
                <li
                  key={fee.id}
                  data-fee-anchor={focused ? fee.feeCategory ?? undefined : undefined}
                  className={`scroll-mt-24 border-b border-[#F0EBE3] px-4 py-2.5 last:border-0 ${focused ? FOCUSED_ROW : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-sm font-medium text-[#1A1815]">
                      {fee.feeName}
                      {showUnderReview && <UnderReviewChip />}
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="text-base tabular-nums text-[#1A1815]" style={SERIF_STYLE}>
                        {fee.rate ? <RateValue rate={fee.rate} /> : formatFeeAmount(fee.amount) ?? "\u2014"}
                      </span>
                      {benchmark && fee.amount !== null && (
                        <FeePosition amount={fee.amount} benchmark={benchmark} />
                      )}
                    </span>
                  </div>
                  {fee.status === "verified" && fee.feeCategory && (medians.has(fee.feeCategory) || stateMedians?.medians.has(fee.feeCategory)) && (
                    <p className="mt-0.5">
                      <MedianCell fee={fee} medians={medians} stateMedians={stateMedians} />
                    </p>
                  )}
                  <p className="mt-1 text-xs leading-relaxed text-[#6B6255]">
                    {[basis || null, fee.conditions].filter(Boolean).join(" \u00b7 ")}
                    {(basis || fee.conditions) && sourceUrl ? " \u00b7 " : null}
                    {sourceUrl && <SourceLink href={sourceUrl} fallback={!fee.sourceUrl} />}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
