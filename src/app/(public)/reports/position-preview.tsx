/**
 * The position map from the committed sample report, drawn as range bars: the shaded
 * band is the peer middle half (P25–P75), the tick is the peer median, the dot is the
 * institution's published fee. Every value comes from the sample report's own § 02
 * table (extractPositionMap); nothing here is illustrative.
 */
import type { PositionStatus, ReportPositionMap } from "@/lib/hosted-reports";

const STATUS_STYLE: Record<PositionStatus, { dot: string; label: string; text: string }> = {
  above: { dot: "#C44B2E", label: "Above market", text: "text-[#A93D25]" },
  inside: { dot: "#1A1815", label: "In range", text: "text-[#6B6255]" },
  below: { dot: "#3E7C5A", label: "Below market", text: "text-[#2F6447]" },
};

function money(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function pct(value: number, max: number): string {
  return `${Math.min(100, Math.max(0, (value / max) * 100)).toFixed(2)}%`;
}

export function PositionPreview({ map }: { map: ReportPositionMap }) {
  const counts = { above: 0, inside: 0, below: 0 };
  for (const row of map.rows) counts[row.status] += 1;

  return (
    <figure className="m-0 overflow-hidden rounded-xl border border-[#E0D7C9] bg-white shadow-[0_1px_0_rgba(26,24,21,0.04),0_12px_32px_-18px_rgba(26,24,21,0.25)]">
      <figcaption className="border-b border-[#EFE8DE] px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
          From the sample report · Position map
        </p>
        <p className="mt-1 text-[14px] leading-snug text-[#3D3830]">
          Sample Community Bank against {map.cohortSize ?? "its"} peer banks
        </p>
      </figcaption>

      <ul className="m-0 list-none px-5 py-3">
        {map.rows.map((row) => {
          const max = Math.max(row.you, row.p75) * 1.2;
          const style = STATUS_STYLE[row.status];
          return (
            <li key={row.category} className="border-b border-[#F3EEE6] py-2.5 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="min-w-0 text-[13px] text-[#1A1815]">{row.category}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-[#6B6255]">
                  <b className={`font-semibold ${style.text}`}>{money(row.you)}</b>
                  <span> vs {money(row.median)} median</span>
                </span>
              </div>
              <div className="relative mt-1.5 h-3" aria-hidden="true">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#E6DED2]" />
                <div
                  className="absolute top-0 h-3 rounded-sm bg-[#EFE6DA]"
                  style={{ left: pct(row.p25, max), width: `max(3px, ${pct(row.p75 - row.p25, max)})` }}
                />
                <div
                  className="absolute top-0 h-3 w-[2px] -translate-x-1/2 bg-[#8A7F70]"
                  style={{ left: pct(row.median, max) }}
                />
                <div
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
                  style={{ left: pct(row.you, max), background: style.dot }}
                />
              </div>
              <span className="sr-only">
                {row.category}: {money(row.you)} against a peer median of {money(row.median)} (middle half{" "}
                {money(row.p25)}–{money(row.p75)}, {row.peers} peers). {style.label}.
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[#EFE8DE] bg-[#FDFBF8] px-5 py-3 text-[11px] text-[#6B6255]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_STYLE.above.dot }} />
          {counts.above} above market
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_STYLE.inside.dot }} />
          {counts.inside} in range
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_STYLE.below.dot }} />
          {counts.below} below
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-[#EFE6DA]" />
          peer middle half
        </span>
      </div>
    </figure>
  );
}
