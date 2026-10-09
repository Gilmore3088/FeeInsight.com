import { formatAmount } from "@/lib/format";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

/** One fee in the preview: the national spread, and the chosen institution's own fee when known. */
export interface BenchmarkRow {
  category: string;
  label: string;
  median: number;
  p25: number | null;
  p75: number | null;
  institutions: number;
  /** The institution's published fee, compared on the peers' charge basis; null before a pick. */
  value: number | null;
  position: "above" | "below" | "at" | null;
}

const POSITION_WORDS: Record<NonNullable<BenchmarkRow["position"]>, string> = {
  above: "Above the median",
  below: "Below the median",
  at: "At the median",
};

function pct(amount: number, max: number): string {
  return `${Math.max(0, Math.min(100, (amount / max) * 100)).toFixed(1)}%`;
}

function RangeBar({ row }: { row: BenchmarkRow }) {
  const max = Math.max(row.p75 ?? row.median, row.value ?? 0, row.median) * 1.25 || 1;
  return (
    <div aria-hidden className="relative h-2.5 rounded-full bg-[#EDE6DB]">
      {row.p25 !== null && row.p75 !== null && (
        <div
          className="absolute inset-y-0 rounded-full bg-[#D6CBBB]"
          style={{ left: pct(row.p25, max), width: `calc(${pct(row.p75, max)} - ${pct(row.p25, max)})` }}
        />
      )}
      <div className="absolute -inset-y-1 w-0.5 rounded bg-[#1A1815]" style={{ left: pct(row.median, max) }} />
      {row.value !== null && (
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C44B2E] ring-2 ring-white"
          style={{ left: pct(row.value, max) }}
        />
      )}
    </div>
  );
}

/**
 * Hamilton's core view on /subscribe (James, 9 Oct 2026: lead with fee intelligence, not the
 * Wire). Every figure is read live: the national index (published_fee_catalog under the
 * statistics contract) and, once a buyer picks an institution in the purchase card, that
 * institution's own published fees compared like for like. Positions are facts about the
 * market, never advice on what to charge.
 */
export function BenchmarkPreview({ institution, rows }: { institution: string | null; rows: BenchmarkRow[] }) {
  const mine = institution !== null;
  return (
    <figure className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(26,24,21,0.06),0_12px_32px_-16px_rgba(26,24,21,0.2)] ring-1 ring-[#E8E1D6]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-[#EDE6DB] bg-[#FBF9F5] px-4 py-2.5 sm:px-5">
        <span className="flex items-center gap-2 text-sm font-semibold text-[#1A1815]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[#C44B2E]" />
          Hamilton · Competitive fee position
        </span>
        <span className="hidden text-xs text-[#6B6255] sm:inline">{mine ? "Against the national median" : "National index"}</span>
      </figcaption>

      <div className="px-4 pb-2 pt-4 sm:px-5">
        <p className="text-lg leading-snug text-[#1A1815]" style={SERIF}>
          {mine ? institution : "Where published fees sit across the market"}
        </p>
        <p className="mt-0.5 text-sm text-[#6B6255]">
          {mine
            ? "Its own published fees, each compared on the same charge basis."
            : "Pick your institution in the card to place its own fees here."}
        </p>
      </div>

      <ul className="divide-y divide-[#EDE6DB]">
        {rows.map((row, i) => (
          <li
            key={row.category}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_9.5rem] sm:px-5 ${
              i >= 3 ? "hidden sm:grid" : ""
            }`}
          >
            <div>
              <p className="text-[15px] font-semibold text-[#1A1815]">{row.label}</p>
              <p className="text-xs text-[#6B6255] tabular-nums">{row.institutions.toLocaleString("en-US")} institutions</p>
            </div>
            <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
              <RangeBar row={row} />
            </div>
            <div className="text-right tabular-nums sm:col-start-3">
              {mine && row.value !== null ? (
                <>
                  <p className="text-[15px] font-semibold text-[#1A1815]">
                    {formatAmount(row.value)} <span className="font-normal text-[#6B6255]">vs {formatAmount(row.median)}</span>
                  </p>
                  {row.position && <p className="text-xs text-[#3D3833]">{POSITION_WORDS[row.position]}</p>}
                </>
              ) : (
                <>
                  <p className="text-[15px] font-semibold text-[#1A1815]">{formatAmount(row.median)} median</p>
                  {row.p25 !== null && row.p75 !== null && (
                    <p className="text-xs text-[#6B6255]">
                      Middle half {formatAmount(row.p25)} to {formatAmount(row.p75)}
                    </p>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-[#EDE6DB] bg-[#FBF9F5] px-4 py-2.5 text-xs leading-relaxed text-[#6B6255] sm:px-5">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-5 rounded-full bg-[#D6CBBB]" /> Middle half of institutions
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-0.5 bg-[#1A1815]" /> Median
          </span>
          {mine && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-[#C44B2E]" /> This institution
            </span>
          )}
        </p>
        <p className="mt-1.5">
          From published fee schedules in the Bank Fee Index. In Pro you set the peer group: state, asset size, charter,
          Fed district, or your own list.
        </p>
      </div>
    </figure>
  );
}
