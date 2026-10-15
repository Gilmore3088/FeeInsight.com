import { FeeRange, FeeRangeAxis } from "@/brand/components";
import { HAMILTON_MODES } from "@/lib/constants";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { STATE_NAMES } from "@/lib/us-states";

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
  feeLabel: string;
  value: number;
  rows: LadderRow[];
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
 * out rather than guessed. Null when the sample has no comparable headline fee.
 */
export function buildMarketLadder({
  sample,
  stateIndex,
  charterIndex,
  national,
}: {
  sample: MarketReport;
  stateIndex: IndexEntry[];
  charterIndex: IndexEntry[];
  national: FeeCategorySummary[];
}): MarketLadderData | null {
  const line = LADDER_KEYS.map((key) => sample.analysis.lines.find((l) => l.key === key)).find(
    (l) => l && l.comparable && l.own && l.peers,
  );
  if (!line || !line.own || !line.peers) return null;
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
  return { institutionName: subject.institution_name, feeLabel: line.label, value: line.own.amount, rows };
}

/** The Hamilton frame, My fees: the ladder drawn with the house box plot, every row on one axis. */
export function MarketLadder({ data }: { data: MarketLadderData }) {
  const top = Math.max(10, Math.ceil(Math.max(data.value, ...data.rows.map((r) => r.max)) / 10) * 10);
  const domain: [number, number] = [0, top];
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-surface-0 shadow-fi-1">
      <figcaption className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden className="h-2 w-2 rounded-full bg-brick" />
          Hamilton
        </span>
        <span className="text-xs text-ink-muted">Illustration, live figures</span>
      </figcaption>
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
      <div className="px-4 py-4 sm:px-5">
        <p className="flex items-baseline justify-between gap-3 text-[15px] font-semibold text-ink">
          <span>
            {data.institutionName}: {data.feeLabel.toLowerCase()}
          </span>
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">Its fee</span>
        </p>
        <div className="mt-3 space-y-1">
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
            />
          ))}
          <FeeRangeAxis ticks={[0, top / 2, top]} domain={domain} />
        </div>
      </div>
      <p className="border-t border-border px-4 py-2.5 text-[12px] text-ink-muted sm:px-5">
        Dot: its own published fee. Box: the middle half of each market.
      </p>
    </figure>
  );
}
