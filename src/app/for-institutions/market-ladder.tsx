import { FeeRange, FeeRangeAxis } from "@/brand/components";
import { HAMILTON_MODES } from "@/lib/constants";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getPeerIndexCached } from "@/lib/data-store/public-cached-reads";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { ReportLine } from "@/lib/custom-report/analysis";
import { STATE_NAMES } from "@/lib/us-states";
import { money } from "@/app/landing-shared";
import { latestReadOn, lineName } from "./board-math";
import { SourceFooter } from "./workspace-exhibits";

/** The fees the ladder can show, in order of preference: the first the sample publishes and can compare. */
const LADDER_KEYS = ["overdraft", "monthly_maintenance", "nsf"] as const;

export interface LadderRow {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  institutions: number;
}

export interface MarketLadderData {
  institutionName: string;
  /** The fee's taxonomy key, e.g. "overdraft". */
  feeKey: string;
  /** The sample report's own line name ("Outgoing international wire"), as the other exhibits show it. */
  feeLabel: string;
  value: number;
  rows: LadderRow[];
  /** The newest day a schedule behind the local row was read (YYYY-MM-DD), or null. */
  readOn?: string | null;
}

type Spread = Pick<IndexEntry, "min_amount" | "p25_amount" | "median_amount" | "p75_amount" | "max_amount" | "institution_count">;

function indexRow(label: string, entry: Spread | null | undefined): LadderRow | null {
  if (!entry) return null;
  const { min_amount, p25_amount, median_amount, p75_amount, max_amount } = entry;
  if (min_amount === null || p25_amount === null || median_amount === null || p75_amount === null || max_amount === null) {
    return null;
  }
  return {
    label,
    min: Number(min_amount),
    q1: Number(p25_amount),
    median: Number(median_amount),
    q3: Number(p75_amount),
    max: Number(max_amount),
    institutions: entry.institution_count,
  };
}


const CHARTER_PEERS: Record<string, string> = { bank: "Banks nationwide", credit_union: "Credit unions nationwide" };

/**
 * One fee from the live sample report, placed in each market layer we can read for it: the
 * report's own local competitors, the state, the charter nationwide and the nation. Layers
 * below the minimum sample (`maturity_tier` insufficient) or without a full spread are left
 * out rather than guessed. Null when the sample has no comparable headline fee. `preferKey`
 * (the page's lead line) is tried first and kept when it can be placed in two layers or more.
 */
export function buildMarketLadder({
  sample,
  stateIndex,
  charterIndex,
  national,
  preferKey = null,
}: {
  sample: MarketReport;
  stateIndex: IndexEntry[];
  charterIndex: IndexEntry[];
  national: FeeCategorySummary[];
  /** A fee to try first (the page's lead line), before the usual LADDER_KEYS order. */
  preferKey?: string | null;
}): MarketLadderData | null {
  const comparable = (key: string) =>
    sample.analysis.lines.find((l) => l.key === key && l.comparable && l.own && l.peers) ?? null;
  // The preferred fee wins when it can be placed in at least two layers; otherwise the usual order.
  if (preferKey) {
    const preferred = comparable(preferKey);
    const ladder = preferred ? ladderFor(preferred, { sample, stateIndex, charterIndex, national }) : null;
    if (ladder) return ladder;
  }
  const line = LADDER_KEYS.map(comparable).find((l) => l !== null) ?? null;
  return line ? ladderFor(line, { sample, stateIndex, charterIndex, national }) : null;
}

function ladderFor(
  line: ReportLine,
  {
    sample,
    stateIndex,
    charterIndex,
    national,
  }: { sample: MarketReport; stateIndex: IndexEntry[]; charterIndex: IndexEntry[]; national: FeeCategorySummary[] },
): MarketLadderData | null {
  if (!line.own || !line.peers) return null;
  const usable = (entries: IndexEntry[]) => entries.find((e) => e.fee_category === line.key && e.maturity_tier !== "insufficient");
  const subject = sample.data.subject;
  const state = subject.state_code ? STATE_NAMES[subject.state_code] ?? null : null;
  const charter = subject.charter_type ? CHARTER_PEERS[subject.charter_type] ?? null : null;
  const rows = [
    {
      label: "Local competitors",
      min: line.peers.min,
      q1: line.peers.p25,
      median: line.peers.median,
      q3: line.peers.p75,
      max: line.peers.max,
      institutions: line.peers.n,
    },
    state ? indexRow(state, usable(stateIndex)) : null,
    charter ? indexRow(charter, usable(charterIndex)) : null,
    indexRow("The nation", national.find((c) => c.fee_category === line.key)),
  ].filter((row): row is LadderRow => row !== null);
  if (rows.length < 2) return null;
  return {
    institutionName: subject.institution_name,
    feeKey: line.key,
    feeLabel: lineName(line.label),
    value: line.own.amount,
    rows,
    readOn: latestReadOn([line.own.schedule_read_on, ...(line.peerFigures ?? []).map((figure) => figure.schedule_read_on)]),
  };
}

/**
 * The live sample's ladder: its state and charter benchmarks read beside the report. A failed
 * read drops that row; null when the sample has no comparable headline fee.
 */
export async function loadSampleLadder(
  sample: MarketReport,
  national: FeeCategorySummary[],
  preferKey: string | null = null,
): Promise<MarketLadderData | null> {
  const { state_code, charter_type } = sample.data.subject;
  const none: IndexEntry[] = [];
  const [stateIndex, charterIndex] = await Promise.all([
    state_code ? getPeerIndexCached({ state_code }).catch(() => none) : none,
    charter_type ? getPeerIndexCached({ charter_type }).catch(() => none) : none,
  ]);
  return buildMarketLadder({ sample, stateIndex, charterIndex, national, preferKey });
}

/**
 * The Hamilton frame, My fees: the ladder drawn with the house box plot, every row on one axis.
 * `bare` drops its own window, for a page that already draws one around it.
 */
export function MarketLadder({ data, bare = false }: { data: MarketLadderData; bare?: boolean }) {
  const top = Math.max(10, Math.ceil(Math.max(data.value, ...data.rows.map((r) => r.max)) / 10) * 10);
  const domain: [number, number] = [0, top];
  return (
    <figure className={bare ? "min-w-0" : "overflow-hidden rounded-xl border border-border bg-surface-0 shadow-fi-1"}>
      {bare ? null : (
        <figcaption className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span aria-hidden className="h-2 w-2 rounded-full bg-ink" />
            Hamilton
          </span>
        </figcaption>
      )}
      <div role="presentation" className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-2 text-[13px]">
        {HAMILTON_MODES.map((mode) => (
          <span
            key={mode}
            className={
              mode === "My fees"
                ? "whitespace-nowrap border-b-2 border-ink px-2.5 pb-2 font-semibold text-ink"
                : "whitespace-nowrap px-2.5 pb-2 text-ink-muted"
            }
          >
            {mode}
          </span>
        ))}
      </div>
      <div className="px-4 py-4 sm:px-6 sm:py-5">
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{data.feeLabel}</p>
        <p className="max-w-[none] mt-1 flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[17px] font-semibold text-ink sm:text-[19px]">{data.institutionName}</span>
          <span className="shrink-0 font-mono text-[26px] font-semibold tabular-nums tracking-tight text-ink sm:text-[30px]">
            {money(data.value)}
          </span>
        </p>
        <div className="fi-range-stack mt-3 space-y-1">
          {data.rows.map((row) => (
            <FeeRange
              key={row.label}
              label={row.label}
              min={row.min}
              q1={row.q1}
              median={row.median}
              q3={row.q3}
              max={row.max}
              value={data.value}
              domain={domain}
              figure="median"
            />
          ))}
          <FeeRangeAxis ticks={[0, top / 2, top]} domain={domain} />
        </div>
      </div>
      <p className="max-w-[none] border-t border-border px-4 py-2.5 text-[12px] text-ink-muted sm:px-6">
        Dot: its own published fee. Box: the middle half of each market. Right: each market&apos;s median.
      </p>
      {/* The date covers the local row only: the state, charter and nation rows come from the index. */}
      {bare ? null : <SourceFooter readOn={data.readOn ?? null} readLabel="local figures read" />}
    </figure>
  );
}
