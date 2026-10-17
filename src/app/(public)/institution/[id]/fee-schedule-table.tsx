import { countsAsPersonal, isAudienceUnstated, type FeeAudience, type FeeTreatment } from "@/lib/fee-audience";
import { isBusinessOnlyLink } from "@/lib/agents/magellan/link-coverage";
import { UnstatedAudienceFootnote, UnstatedAudienceMark } from "@/components/unstated-audience";
import { FEE_FAMILIES, getFeeFamily } from "@/lib/fee-taxonomy";
import { notComparableReason } from "@/lib/fee-comparability";
import { formatFeeAmount } from "@/lib/format";
import { getFrequencyLabel } from "./enum-labels";
import { FeeAudienceTabs, type FeeAudienceTab } from "./fee-audience-tabs";

export interface DisplayFee {
  feeAudience?: FeeAudience;
  feeTreatment?: FeeTreatment;
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
  /** The account product the schedule ties the fee to, when it names one. */
  accountProduct?: string | null;
}

/**
 * Uncertainty in one quiet form: a fee with no stated audience carries the asterisk the list's
 * one footnote explains (#1058), and the tabs carry personal versus business. No per-row scope
 * line repeats it. An eliminated fee says so.
 */
function AudienceLabel({ fee }: { fee: DisplayFee }) {
  if (fee.feeTreatment !== "eliminated") return null;
  return <span className="block text-xs font-normal text-ink-muted">Fee eliminated</span>;
}

function AudienceMark({ fee }: { fee: DisplayFee }) {
  return <UnstatedAudienceMark show={isAudienceUnstated(fee.feeAudience)} />;
}

/** "CD/IRA fee" when the row is a different product's price than its category's median measures. */
function notComparable(fee: DisplayFee): string | null {
  return notComparableReason(fee.feeCategory, fee.feeName, fee.accountProduct ?? null);
}

function NotCompared({ reason }: { reason: string }) {
  return <span className="mt-1 block font-sans text-[12px] font-normal text-ink-muted">Not compared: {reason}</span>;
}

/** Same boundary as the statistics (statsRowFilter): not business, not from a business-only schedule. */
function comparesToPersonal(fee: DisplayFee): boolean {
  return countsAsPersonal(fee.feeAudience) && !(fee.sourceUrl && isBusinessOnlyLink(fee.sourceUrl));
}

/** National 25th / 50th / 75th percentile for one fee category. */
export interface FeeBenchmark {
  p25: number;
  median: number;
  p75: number;
}

export type FeeBenchmarks = Record<string, FeeBenchmark>;

export type Position = "below" | "within" | "above";

/** Fee Insight colours, as in the comparison table: brick above, ink below, ink-soft inside. */
const POSITION_DOT: Record<Position, string> = {
  below: "bg-ink",
  within: "bg-ink-soft",
  above: "bg-brick",
};

const POSITION_TEXT: Record<Position, string> = {
  below: "Below the U.S. middle 50%",
  within: "Inside the U.S. middle 50%",
  above: "Above the U.S. middle 50%",
};

function benchmarkFor(fee: DisplayFee, benchmarks: FeeBenchmarks | undefined): FeeBenchmark | null {
  if (!comparesToPersonal(fee) || notComparable(fee) !== null || !benchmarks || fee.status !== "verified" || fee.amount === null || !fee.feeCategory) return null;
  return benchmarks[fee.feeCategory] ?? null;
}

/** How many benchmarked fees sit below, inside and above the national middle 50%. */
export function countPositions(fees: DisplayFee[], benchmarks: FeeBenchmarks): Record<Position, number> {
  const counts: Record<Position, number> = { below: 0, within: 0, above: 0 };
  const seen = new Set<string>();
  for (const fee of fees) {
    const benchmark = benchmarkFor(fee, benchmarks);
    if (!benchmark || fee.amount === null) continue;
    const key = dedupeKey(fee);
    if (seen.has(key)) continue;
    seen.add(key);
    counts[fee.amount < benchmark.p25 ? "below" : fee.amount > benchmark.p75 ? "above" : "within"] += 1;
  }
  return counts;
}

/**
 * A tiny bar: the shaded band is where most institutions fall nationally, the tick is
 * the national median, the dot is this fee. Dot color says below / within / above.
 */
function FeePosition({ amount, benchmark, wide = false }: { amount: number; benchmark: FeeBenchmark; wide?: boolean }) {
  const position: Position =
    amount < benchmark.p25 ? "below" : amount > benchmark.p75 ? "above" : "within";
  const scaleMax = Math.max(benchmark.p75 * 1.5, amount * 1.1, 1);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / scaleMax) * 100))}%`;
  const description = `${POSITION_TEXT[position]} (${formatFeeAmount(benchmark.p25)} to ${formatFeeAmount(benchmark.p75)} nationally)`;

  return (
    <span className={`mt-1.5 flex flex-col ${wide ? "w-full" : "w-36"}`} title={description}>
      <span className="sr-only">{description}</span>
      <span aria-hidden="true" className="relative block h-3 w-full">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        <span
          className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[2px] bg-brick-tint"
          style={{ left: pct(benchmark.p25), width: `calc(${pct(benchmark.p75)} - ${pct(benchmark.p25)})` }}
        />
        <span
          className="absolute top-1/2 h-3.5 w-[2px] -translate-y-1/2 bg-ink"
          style={{ left: pct(benchmark.median) }}
        />
        <span
          className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 ${POSITION_DOT[position]}`}
          style={{ left: pct(amount) }}
        />
      </span>
    </span>
  );
}

function PositionLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-surface-200 px-4 py-2 text-[11px] text-ink-muted">
      <span>vs. the U.S. middle 50%:</span>
      {(["below", "within", "above"] as const).map((position) => (
        <span key={position} className="inline-flex items-center gap-1">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${POSITION_DOT[position]}`} />
          {position === "within" ? "Inside" : position === "below" ? "Below" : "Above"}
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

/** A rate in the amount column, with what it is a share of beneath it. */
function RateValue({ rate }: { rate: NonNullable<DisplayFee["rate"]> }) {
  return (
    <>
      {rate.rate}
      {rate.detail && (
        <span className="block max-w-[180px] whitespace-normal text-right font-sans text-xs text-ink-muted">{rate.detail}</span>
      )}
    </>
  );
}

const FAMILY_ORDER = [...Object.keys(FEE_FAMILIES), OTHER_FAMILY];

// Within a family, the taxonomy lists the fees people look up most first (monthly
// maintenance before account research, overdraft before daily caps). Alphabetical order
// put "Account Research" at the top of every bank page.
const CATEGORY_RANK = new Map(Object.values(FEE_FAMILIES).flatMap((cats) => cats.map((cat, i) => [cat, i] as const)));

function categoryRank(fee: DisplayFee): number {
  return (fee.feeCategory ? CATEGORY_RANK.get(fee.feeCategory) : undefined) ?? Number.MAX_SAFE_INTEGER;
}

function familyFor(fee: DisplayFee): string {
  return (fee.feeCategory ? getFeeFamily(fee.feeCategory) : null) ?? OTHER_FAMILY;
}

function dedupeKey(fee: DisplayFee): string {
  return `${fee.feeName.trim().toLowerCase()}|${fee.rate ? `${fee.rate.rate} ${fee.rate.detail ?? ""}` : fee.amount ?? "null"}`;
}

/** Groups fees by family, collapses duplicate name + amount pairs, keeps taxonomy order for families and rows. */
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
      rows: [...group.rows].sort((a, b) => categoryRank(a) - categoryRank(b) || a.feeName.localeCompare(b.feeName)),
    };
  });
}

function GroupBadge({ group }: { group: FeeGroup }) {
  const verified = group.verifiedCount > 0;
  const className = verified ? "border-border bg-surface-0 text-ink-soft" : "border-brick/30 bg-brick-tint text-ink";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${className}`}>
        {verified ? "Verified" : "Under review"}
      </span>
      {verified && group.provisionalCount > 0 && (
        <span className="text-[11px] text-ink-muted">{group.provisionalCount} under review</span>
      )}
    </span>
  );
}

const HEADER_CELL = "px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted";
const MONO_FIGURE = { fontFamily: "var(--fi-font-mono)" } as const;

const FOCUSED_ROW = "border-l-2 border-l-brick bg-brick/[0.035]";

/**
 * Rows past the list's limit carry this class: hidden until the ShowAll wrapper around the
 * table sets data-all, so the first rows show and the rest open on one tap.
 */
const EXTRA_ROW = "hidden group-data-[all=true]/fees:table-row";
const EXTRA_ITEM = "hidden group-data-[all=true]/fees:block";

/** The fee list split for the Personal / Business tabs (#1062). */
export interface AudienceSplit {
  personal: DisplayFee[];
  business: DisplayFee[];
}

/**
 * Tabs only when the bank labels at least one fee business: otherwise null and the list shows
 * as one. A fee labeled both sits in both tabs; an unlabeled fee is treated as personal, the
 * same rule as its asterisk. An empty side gets no tab.
 */
export function splitFeesByAudience(fees: DisplayFee[]): AudienceSplit | null {
  if (!fees.some((fee) => fee.feeAudience === "business")) return null;
  return {
    personal: fees.filter((fee) => countsAsPersonal(fee.feeAudience)),
    business: fees.filter((fee) => fee.feeAudience === "business" || fee.feeAudience === "both"),
  };
}

/**
 * @param focusCategory The fee the reader came to compare (`?fee=`), highlighted and
 *   anchored so the guide → directory → profile handoff lands on the right row.
 */
export function FeeScheduleTable({
  fees,
  disclosureUrl,
  focusCategory = null,
  benchmarks,
  limit = Number.POSITIVE_INFINITY,
}: {
  fees: DisplayFee[];
  disclosureUrl: string | null;
  focusCategory?: string | null;
  /** National percentiles by fee category; verified fees with a match get a position bar. */
  benchmarks?: FeeBenchmarks;
  /** Rows each list shows before the rest wait for a ShowAll wrapper's "Show all". */
  limit?: number;
}) {
  const split = splitFeesByAudience(fees);
  const listFor = (list: DisplayFee[], rowIds = true) => (
    <FeeList
      fees={list}
      rowIds={rowIds}
      disclosureUrl={disclosureUrl}
      focusCategory={focusCategory}
      benchmarks={benchmarks}
      limit={limit}
    />
  );
  // A reader sent to a fee the bank lists only for business lands on the Business tab.
  const focusIsBusinessOnly =
    split !== null &&
    focusCategory !== null &&
    split.business.some((fee) => fee.feeCategory === focusCategory) &&
    !split.personal.some((fee) => fee.feeCategory === focusCategory);
  // Only the tab that opens first carries the focused row's #fee- id, so it stays unique.
  const tabs: FeeAudienceTab[] = split
    ? [
        ...(split.personal.length > 0 ? [{ key: "personal" as const, label: "Personal", panel: listFor(split.personal, !focusIsBusinessOnly) }] : []),
        ...(split.business.length > 0
          ? [{ key: "business" as const, label: "Business", panel: listFor(split.business, focusIsBusinessOnly || split.personal.length === 0) }]
          : []),
      ]
    : [];

  // Unlabeled fees sit only under Personal, so with tabs the footnote ends that list alone.
  return split ? <FeeAudienceTabs tabs={tabs} initial={focusIsBusinessOnly ? "business" : "personal"} /> : listFor(fees);
}

/** One fee list: the position legend, phone rows and the wide table. */
function FeeList({
  fees,
  rowIds,
  disclosureUrl,
  focusCategory,
  benchmarks,
  limit,
}: {
  fees: DisplayFee[];
  /** Whether the focused table row carries its `#fee-` id. */
  rowIds: boolean;
  disclosureUrl: string | null;
  focusCategory: string | null;
  benchmarks?: FeeBenchmarks;
  limit: number;
}) {
  const groups = groupFeesByFamily(fees);
  // The first rows in list order show; the rest are marked extra.
  const extra = new Set(groups.flatMap((g) => g.rows).slice(limit).map((fee) => fee.id));
  const groupExtra = (group: FeeGroup) => group.rows.every((fee) => extra.has(fee.id));
  const isFocused = (fee: DisplayFee) => focusCategory !== null && fee.feeCategory === focusCategory;
  const anyBenchmarked = fees.some((fee) => benchmarkFor(fee, benchmarks) !== null);

  return (
    <>
      {anyBenchmarked && <PositionLegend />}
      <FeeScheduleStack
        groups={groups}
        disclosureUrl={disclosureUrl}
        isFocused={isFocused}
        benchmarks={benchmarks}
        extra={extra}
      />
      <div className="hidden sm:block">
        <div className="table-scroll">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-0">
                <th scope="col" className={HEADER_CELL}>Fee</th>
                <th scope="col" className={`${HEADER_CELL} text-right`}>Amount</th>
                <th scope="col" className={HEADER_CELL}>Basis</th>
                <th scope="col" className={HEADER_CELL}>Note</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.family} className="border-t border-border">
                <tr className={`bg-paper ${groupExtra(group) ? EXTRA_ROW : ""}`}>
                  <th scope="rowgroup" colSpan={4} className="px-4 py-2.5 text-left">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{group.family}</span>
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
                    rowId={rowIds}
                    extra={extra.has(fee.id)}
                    benchmark={benchmarkFor(fee, benchmarks)}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
      <UnstatedAudienceFootnote show={fees.some((fee) => isAudienceUnstated(fee.feeAudience))} className="border-t border-surface-200 px-4 py-2" />
    </>
  );
}

function UnderReviewChip() {
  return (
    <span className="ml-2 inline-flex items-center rounded-md border border-brick/30 bg-brick-tint px-1.5 py-0.5 text-[10px] font-semibold text-ink">
      Under review
    </span>
  );
}

/**
 * The amount, linked to the fee's own source document, or, when the fee has none of its own,
 * to the institution's general schedule, titled as such so it never reads as the exact source.
 */
function AmountLink({ href, fallback = false, children }: { href: string | null; fallback?: boolean; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={fallback ? "Open the institution\u2019s fee schedule" : "Open the fee schedule it was read from"}
      className="underline decoration-border underline-offset-2 hover:decoration-brick"
    >
      {children}
    </a>
  );
}

function FeeRow({
  fee,
  disclosureUrl,
  mixedGroup,
  focused = false,
  rowId = true,
  extra = false,
  benchmark,
}: {
  fee: DisplayFee;
  disclosureUrl: string | null;
  mixedGroup: boolean;
  focused?: boolean;
  rowId?: boolean;
  /** Past the list's limit: hidden until "Show all". */
  extra?: boolean;
  benchmark: FeeBenchmark | null;
}) {
  const sourceUrl = fee.sourceUrl ?? disclosureUrl;
  const amount = formatFeeAmount(fee.amount);
  const basis = getFrequencyLabel(fee.frequency);
  const showUnderReview = mixedGroup && fee.status === "provisional";

  return (
    <tr
      id={focused && rowId && fee.feeCategory ? `fee-${fee.feeCategory}` : undefined}
      data-fee-anchor={focused ? fee.feeCategory ?? undefined : undefined}
      className={`fi-row-interaction scroll-mt-24 border-b border-surface-200 last:border-0 ${focused ? FOCUSED_ROW : ""} ${extra ? EXTRA_ROW : ""}`}
    >
      <td className="max-w-[320px] px-4 py-2.5 align-top">
        <span className="break-words font-medium text-ink">
          {fee.feeName}
          <AudienceMark fee={fee} />
        </span>
        <AudienceLabel fee={fee} />
        {showUnderReview && <UnderReviewChip />}
      </td>
      <td className="font-semibold whitespace-nowrap px-4 py-2.5 text-right align-top text-base tabular-nums text-ink" style={MONO_FIGURE}>
        <AmountLink href={sourceUrl} fallback={!fee.sourceUrl}>
          {fee.rate ? <RateValue rate={fee.rate} /> : amount ?? "Not stated"}
        </AmountLink>
        {benchmark && fee.amount !== null && (
          <span className="flex justify-end">
            <FeePosition amount={fee.amount} benchmark={benchmark} />
          </span>
        )}
        {!benchmark && fee.amount !== null && notComparable(fee) && <NotCompared reason={notComparable(fee) as string} />}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 align-top text-ink-soft">{basis || <span className="sr-only">Not stated</span>}</td>
      <td className="max-w-[280px] px-4 py-2.5 align-top text-xs leading-relaxed text-ink-muted">
        {fee.conditions ? <span className="break-words">{fee.conditions}</span> : <span className="sr-only">None</span>}
      </td>
    </tr>
  );
}

/** Below 640px: stacked rows: fee and amount, its position bar, then basis and note. */
function FeeScheduleStack({
  groups,
  disclosureUrl,
  isFocused,
  benchmarks,
  extra,
}: {
  groups: FeeGroup[];
  disclosureUrl: string | null;
  isFocused: (fee: DisplayFee) => boolean;
  benchmarks?: FeeBenchmarks;
  /** Rows past the list's limit, hidden until "Show all". */
  extra: Set<string>;
}) {
  return (
    <div className="sm:hidden">
      {groups.map((group) => (
        <section key={group.family} className={`border-t border-border ${group.rows.every((fee) => extra.has(fee.id)) ? EXTRA_ITEM : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 bg-paper px-4 py-2.5">
            <span className="text-sm font-semibold text-ink">{group.family}</span>
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
                  className={`scroll-mt-24 border-b border-surface-200 px-4 py-3 last:border-0 ${focused ? FOCUSED_ROW : ""} ${
                    extra.has(fee.id) ? EXTRA_ITEM : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-sm font-medium text-ink">
                      {fee.feeName}
                      <AudienceMark fee={fee} />
                      <AudienceLabel fee={fee} />
                      {showUnderReview && <UnderReviewChip />}
                    </span>
                    <span className="shrink-0 font-semibold text-base tabular-nums text-ink" style={MONO_FIGURE}>
                      <AmountLink href={sourceUrl} fallback={!fee.sourceUrl}>
                        {fee.rate ? <RateValue rate={fee.rate} /> : formatFeeAmount(fee.amount) ?? "Not stated"}
                      </AmountLink>
                    </span>
                  </div>
                  {benchmark && fee.amount !== null && <FeePosition amount={fee.amount} benchmark={benchmark} wide />}
                  {!benchmark && fee.amount !== null && notComparable(fee) && <NotCompared reason={notComparable(fee) as string} />}
                  {(basis || fee.conditions) && (
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                      {[basis || null, fee.conditions].filter(Boolean).join(" \u00b7 ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
