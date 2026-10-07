/**
 * Engine answers drawn as pictures, not tables (James, 2026-10-07: "I like rich visuals"):
 * every fee on its own peer range (a whole-schedule question, engine 1.10.0+) and a list of
 * sourced findings when there is nothing to draw. Descriptive only: higher, lower or at the
 * median, never ranked by what to do.
 */
import Link from "next/link";
import type { Fact, SchedulePosition } from "@/lib/hamilton/workspace/types";
import { fmtMoney } from "@/components/hamilton/memo/memo";

/** Engine 1.12.1 adds each fee's peer middle half; answers saved before it have the median only. */
type PositionRow = SchedulePosition;

const DIRECTION: Record<SchedulePosition["direction"], { text: string; chip: string; dot: string; reach: string }> = {
  higher: { text: "Higher", chip: "border-terra/40 bg-terra-soft text-terra-text", dot: "bg-terra", reach: "bg-terra/60" },
  at: { text: "At median", chip: "border-warm-300 bg-white text-warm-800", dot: "bg-warm-900", reach: "bg-transparent" },
  lower: { text: "Lower", chip: "border-warm-400 bg-warm-100 text-warm-800", dot: "bg-warm-800", reach: "bg-warm-600/60" },
};

/** How far the fee sits from the median, as a share of it: "+8%", "−31%". */
function gapPct(row: PositionRow): string | null {
  if (row.direction === "at" || row.peerMedian <= 0) return null;
  const pct = Math.round(((row.current - row.peerMedian) / row.peerMedian) * 100);
  return pct === 0 ? null : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

/**
 * One fee: the peer middle half as a shaded band (when known), the median as a tick, the bank's
 * fee as a labelled dot, and a bar from the median to the dot so the distance reads at a glance.
 */
function RangeStrip({ row }: { row: PositionRow }) {
  const band = row.band ?? null;
  const values = [row.current, row.peerMedian, ...(band ? [band.p25, band.p75] : [])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.18, row.peerMedian * 0.1, 1);
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const at = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const label = band
    ? `${fmtMoney(row.current)} against a peer middle half of ${fmtMoney(band.p25)} to ${fmtMoney(band.p75)}, median ${fmtMoney(row.peerMedian)}`
    : `${fmtMoney(row.current)} against a peer median of ${fmtMoney(row.peerMedian)}`;
  const dir = DIRECTION[row.direction];
  const from = Math.min(at(row.current), at(row.peerMedian));
  const to = Math.max(at(row.current), at(row.peerMedian));
  // Keep the labels inside the strip near either edge.
  const anchor = (x: number) => (x > 85 ? "-translate-x-full" : x < 15 ? "" : "-translate-x-1/2");
  return (
    <div className="relative h-14 [font-variant-numeric:tabular-nums]" role="img" aria-label={label}>
      <span
        className={`absolute top-0 whitespace-nowrap text-xs font-semibold text-warm-900 ${anchor(at(row.current))}`}
        style={{ left: `${at(row.current)}%` }}
      >
        {fmtMoney(row.current)}
      </span>
      <span className="absolute inset-x-0 top-[26px] h-1.5 rounded-full bg-warm-200" />
      {band ? (
        <span
          className="absolute top-[21px] h-4 rounded bg-warm-300/80"
          style={{ left: `${at(band.p25)}%`, width: `${Math.max(at(band.p75) - at(band.p25), 1)}%` }}
        />
      ) : null}
      <span className={`absolute top-[26px] h-1.5 ${dir.reach}`} style={{ left: `${from}%`, width: `${to - from}%` }} />
      <span className="absolute top-[17px] h-6 w-0.5 -translate-x-1/2 bg-warm-900" style={{ left: `${at(row.peerMedian)}%` }} />
      <span
        className={`absolute top-[21px] h-4 w-4 -translate-x-1/2 rounded-full ring-2 ring-white ${dir.dot}`}
        style={{ left: `${at(row.current)}%` }}
      />
      <span
        className={`absolute top-[42px] whitespace-nowrap text-[11px] text-warm-600 ${anchor(at(row.peerMedian))}`}
        style={{ left: `${at(row.peerMedian)}%` }}
      >
        median {fmtMoney(row.peerMedian)}
      </span>
    </div>
  );
}

export function SchedulePositionsChart({
  rows,
  hrefFor,
}: {
  rows: PositionRow[];
  /** My fees for one fee, when the page can link there. */
  hrefFor?: (feeCategory: string) => string;
}) {
  if (rows.length === 0) return null;
  const count = (d: SchedulePosition["direction"]) => rows.filter((r) => r.direction === d).length;
  const labels = [...new Set(rows.map((r) => r.peerLabel))];
  const anyBand = rows.some((r) => r.band);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg text-warm-900">Every fee against its peers</h3>
        <p className="text-sm text-warm-700 [font-variant-numeric:tabular-nums]">
          {count("lower")} lower · {count("at")} at median · {count("higher")} higher
        </p>
      </div>
      <ul className="divide-y divide-warm-100 rounded-lg border border-warm-300 bg-white">
        {rows.map((r) => (
          <li
            key={r.feeCategory}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_8rem]"
          >
            <span className="min-w-0 truncate text-sm text-warm-900">
              {hrefFor ? (
                <Link href={hrefFor(r.feeCategory)} className="hover:text-terra-text hover:underline">
                  {r.displayName}
                </Link>
              ) : (
                r.displayName
              )}
            </span>
            <span className="order-last col-span-2 sm:order-none sm:col-span-1">
              <RangeStrip row={r} />
              <span className="mt-0.5 block text-[11px] text-warm-600 [font-variant-numeric:tabular-nums]">
                {r.band ? `Middle half ${fmtMoney(r.band.p25)} to ${fmtMoney(r.band.p75)} · ` : ""}
                {r.peerCount} peers
              </span>
            </span>
            <span className="justify-self-end sm:justify-self-start">
              <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium [font-variant-numeric:tabular-nums] ${DIRECTION[r.direction].chip}`}>
                {DIRECTION[r.direction].text}
                {gapPct(r) ? ` ${gapPct(r)}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-warm-600">
        Dot: your fee. Tick: peer median.{anyBand ? " Grey band: the middle half of what peers charge." : ""} Furthest from the median first. Peers:{" "}
        {labels.join("; ")}.
      </p>
    </section>
  );
}

/** Sourced findings, one per line, with where each figure comes from. */
export function FactList({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <ul className="flex max-w-[68ch] flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-white">
      {facts.map((f, i) => (
        <li key={i} className="flex flex-col gap-1 px-4 py-3">
          <span className="text-[15px] leading-relaxed text-warm-900 [font-variant-numeric:tabular-nums]">{f.text}</span>
          <span className="text-xs text-warm-600">
            {f.source.label}
            {f.source.asOf ? `, ${f.source.asOf}` : ""}
            {f.sampleSize != null ? ` · ${f.sampleSize} institutions` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
