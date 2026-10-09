import { formatAmount } from "@/lib/format";

const DISPLAY = { fontFamily: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif" };

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

/** Under this many like-for-like fees, the preview says the data is limited. */
const LIMITED_BELOW = 3;

function pct(amount: number, max: number): string {
  return `${Math.max(0, Math.min(100, (amount / max) * 100)).toFixed(1)}%`;
}

function RangeBar({ row }: { row: BenchmarkRow }) {
  const max = Math.max(row.p75 ?? row.median, row.value ?? 0, row.median) * 1.25 || 1;
  return (
    <div aria-hidden className="relative h-2.5 rounded-full bg-[#E8E1D6]">
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
  const compared = rows.filter((r) => r.value !== null).length;
  return (
    <figure className="flex h-full flex-col overflow-hidden rounded-2xl bg-white/70 backdrop-blur-xl ring-1 ring-[#E8E1D6]/80 shadow-[0_8px_32px_-12px_rgba(26,24,21,0.22),inset_0_1px_0_rgba(255,255,255,0.7)]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-[#E8E1D6]/80 bg-white/50 px-4 py-2.5 sm:px-5">
        <span className="flex items-center gap-2 text-sm font-semibold text-[#1A1815]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[#C44B2E]" />
          Hamilton · Competitive fee position
        </span>
        <span className="hidden text-xs text-[#6B6255] sm:inline">{mine ? "vs national median" : "Live data"}</span>
      </figcaption>

      <div className="px-4 pb-2 pt-4 sm:px-5">
        <p className="text-lg leading-snug text-[#1A1815] font-semibold tracking-tight" style={DISPLAY}>
          {mine ? institution : "National fee benchmark"}
        </p>
        {!mine && <p className="mt-0.5 text-sm text-[#6B6255]">Pick your institution to see its own fees here.</p>}
        {mine && compared === 0 && (
          <p role="status" className="mt-1.5 rounded-md bg-[#FBF6EC] px-3 py-2 text-sm text-[#3D3833] ring-1 ring-[#D6CBBB]">
            Limited data: none of its verified published fees compare like for like yet, so this shows national
            medians only.
          </p>
        )}
        {mine && compared > 0 && compared < LIMITED_BELOW && (
          <p className="mt-0.5 text-sm text-[#6B6255]">
            Limited data: {compared} of its verified published fees {compared === 1 ? "compares" : "compare"} like for like.
          </p>
        )}
        {mine && compared >= LIMITED_BELOW && (
          <p className="mt-0.5 text-sm text-[#6B6255]">Its verified published fees, compared like for like.</p>
        )}
      </div>

      <ul className="divide-y divide-[#E8E1D6]">
        {rows.map((row, i) => (
          <li
            key={row.category}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_9.5rem] sm:px-5 ${
              i >= 3 ? "hidden sm:grid" : ""
            }`}
          >
            <div>
              <p className="text-[15px] font-semibold text-[#1A1815]">{row.label}</p>
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
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-auto border-t border-[#E8E1D6]/80 bg-white/50 px-4 py-2.5 text-xs leading-relaxed text-[#6B6255] sm:px-5">
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
          Source-backed fee data from {Math.min(...rows.map((r) => r.institutions)).toLocaleString("en-US")}+ institutions. In
          Pro, pick your own peers.
        </p>
      </div>
    </figure>
  );
}
