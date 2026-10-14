/**
 * Engine answers drawn as pictures, not tables (James, 2026-10-07: "I like rich visuals"):
 * every fee on its own peer range (a whole-schedule question, engine 1.10.0+) and a list of
 * sourced findings when there is nothing to draw. Descriptive only: higher, lower or at the
 * median, never ranked by what to do.
 */
import Link from "next/link";
import type { Fact, SchedulePosition } from "@/lib/hamilton/workspace/types";
import { fmtMoney, SERIF } from "@/components/hamilton/memo/memo";

/** Engine 1.12.1 adds each fee's peer middle half; answers saved before it have the median only. */
type PositionRow = SchedulePosition;

const DIRECTION: Record<SchedulePosition["direction"], { text: string; chip: string; tile: string; swatch: string }> = {
  higher: { text: "Higher", chip: "border-terra/40 bg-terra-soft text-terra-text", tile: "text-terra", swatch: "bg-terra" },
  at: { text: "At median", chip: "border-warm-300 bg-white text-warm-800", tile: "text-warm-900", swatch: "bg-warm-900" },
  lower: { text: "Lower", chip: "border-warm-300 bg-warm-100 text-warm-800", tile: "text-warm-700", swatch: "bg-warm-400" },
};

/** The fee's distance from the median as a share of it; 0 when at the median. */
function gapShare(row: PositionRow): number {
  if (row.direction === "at" || row.peerMedian <= 0) return 0;
  return (row.current - row.peerMedian) / row.peerMedian;
}

/** "+8%", "−31%". */
function gapPct(row: PositionRow): string | null {
  const pct = Math.round(gapShare(row) * 100);
  return pct === 0 ? null : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

/**
 * One fee on its peer range: the middle half as a tinted band (when known), the median as a
 * tick, the bank's fee as a ringed terra dot, labelled directly.
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
  const from = Math.min(at(row.current), at(row.peerMedian));
  const to = Math.max(at(row.current), at(row.peerMedian));
  // Keep the labels inside the strip near either edge.
  const anchor = (x: number) => (x > 85 ? "-translate-x-full" : x < 15 ? "" : "-translate-x-1/2");
  return (
    <div className="relative h-12 [font-variant-numeric:tabular-nums]" role="img" aria-label={label}>
      <span className="absolute inset-x-0 top-[18px] h-1 rounded-full bg-warm-200" />
      {band ? (
        <span
          className="absolute top-[12px] h-4 rounded-full bg-terra/[0.18] ring-1 ring-inset ring-terra/40"
          style={{ left: `${at(band.p25)}%`, width: `${Math.max(at(band.p75) - at(band.p25), 1)}%` }}
        />
      ) : null}
      <span className="absolute top-[18px] h-1 bg-terra/60" style={{ left: `${from}%`, width: `${to - from}%` }} />
      <span className="absolute top-[8px] h-6 w-0.5 -translate-x-1/2 rounded bg-warm-900" style={{ left: `${at(row.peerMedian)}%` }} />
      <span
        className="absolute top-[11px] h-[18px] w-[18px] -translate-x-1/2 rounded-full bg-terra shadow-sm ring-[3px] ring-white"
        style={{ left: `${at(row.current)}%` }}
      />
      <span
        className={`absolute top-[34px] whitespace-nowrap text-[11px] text-warm-600 ${anchor(at(row.peerMedian))}`}
        style={{ left: `${at(row.peerMedian)}%` }}
      >
        median {fmtMoney(row.peerMedian)}
      </span>
    </div>
  );
}

/** How far each fee sits from its median, as bars either side of a centre line. */
function DistanceBars({ rows }: { rows: PositionRow[] }) {
  const reach = Math.max(0.1, ...rows.map((r) => Math.abs(gapShare(r))));
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="grid grid-cols-1 gap-x-3 text-[11px] uppercase tracking-[0.08em] text-warm-600 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <span className="hidden sm:block">Distance from the median</span>
        <span className="grid grid-cols-2">
          <span className="pr-2 text-right">Lower</span>
          <span className="pl-2">Higher</span>
        </span>
      </div>
      {rows.map((r) => {
        const g = gapShare(r);
        const w = (Math.abs(g) / reach) * 100;
        const inside = w > 60;
        return (
          <div key={r.feeCategory} className="grid grid-cols-1 items-center gap-x-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
            <span className="truncate text-sm text-warm-800">{r.displayName}</span>
            <span className="relative grid h-7 grid-cols-2">
              <span className="absolute inset-y-0 left-1/2 w-px bg-warm-900" />
              <span className="relative">
                {g < 0 ? (
                  <span className="absolute inset-y-1 right-0 flex items-center justify-start rounded-l-md bg-terra/45" style={{ width: `${Math.max(w, 2)}%` }}>
                    <span className={`whitespace-nowrap text-xs font-semibold text-warm-900 [font-variant-numeric:tabular-nums] ${inside ? "pl-2" : "-translate-x-full pr-1.5"}`}>{gapPct(r)}</span>
                  </span>
                ) : null}
              </span>
              <span className="relative">
                {g > 0 ? (
                  <span className="absolute inset-y-1 left-0 flex items-center justify-end rounded-r-md bg-terra" style={{ width: `${Math.max(w, 2)}%` }}>
                    <span className={`whitespace-nowrap text-xs font-semibold [font-variant-numeric:tabular-nums] ${inside ? "pr-2 text-white" : "translate-x-full pl-1.5 text-warm-900"}`}>{gapPct(r)}</span>
                  </span>
                ) : g === 0 ? (
                  <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-xs text-warm-600">at median</span>
                ) : null}
              </span>
            </span>
          </div>
        );
      })}
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
  const tiles: { d: SchedulePosition["direction"]; label: string }[] = [
    { d: "higher", label: "above the median" },
    { d: "at", label: "at the median" },
    { d: "lower", label: "below the median" },
  ];
  return (
    <section className="overflow-hidden rounded-xl border border-warm-300 bg-white shadow-[0_1px_2px_rgba(26,24,21,0.04)] print:overflow-visible print:shadow-none">
      {/* Printed, the header and the distance bars stay on one page, and no fee card splits. */}
      <div className="break-inside-avoid">
        <div className="flex flex-col gap-4 border-b border-warm-200 bg-warm-100/70 px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-terra-text">Fee scorecard</p>
            <h3 className="text-xl text-warm-900" style={SERIF}>
              Every fee against its peers
            </h3>
            <p className="sr-only">
              {count("lower")} lower · {count("at")} at median · {count("higher")} higher
            </p>
            <div className="flex flex-wrap gap-1" aria-hidden>
              {rows.map((r) => (
                <span key={r.feeCategory} title={r.displayName} className={`h-3 w-5 rounded-sm ${DIRECTION[r.direction].swatch}`} />
              ))}
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {tiles.map((t) => (
              <div key={t.d} className="flex min-w-[5.5rem] flex-col rounded-lg border border-warm-200 bg-white px-3 py-2">
                <dt className="order-2 text-[11px] leading-tight text-warm-600">{t.label}</dt>
                <dd className={`order-1 text-3xl leading-none [font-variant-numeric:tabular-nums] ${DIRECTION[t.d].tile}`} style={SERIF}>
                  {count(t.d)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="px-5 py-5">
          <DistanceBars rows={rows} />
        </div>
      </div>
      <ul className="grid gap-px border-t border-warm-200 bg-warm-200 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.feeCategory} className="flex break-inside-avoid flex-col gap-1 bg-white px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-sm text-warm-800">
                {hrefFor ? (
                  <Link href={hrefFor(r.feeCategory)} className="hover:text-terra-text hover:underline">
                    {r.displayName}
                  </Link>
                ) : (
                  r.displayName
                )}
              </span>
              <span className={`inline-block shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium [font-variant-numeric:tabular-nums] ${DIRECTION[r.direction].chip}`}>
                {DIRECTION[r.direction].text}
                {gapPct(r) ? ` ${gapPct(r)}` : ""}
              </span>
            </div>
            <p className="text-3xl leading-none text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
              {fmtMoney(r.current)}
            </p>
            <RangeStrip row={r} />
            <span className="text-[11px] text-warm-600 [font-variant-numeric:tabular-nums]">
              {r.band ? `Middle half ${fmtMoney(r.band.p25)} to ${fmtMoney(r.band.p75)} · ` : ""}
              {r.peerCount} peers
            </span>
          </li>
        ))}
        {rows.length % 2 === 1 ? <li aria-hidden className="hidden bg-warm-100/50 sm:block" /> : null}
      </ul>
      <p className="border-t border-warm-200 px-5 py-3 text-xs text-warm-600">
        Dot: research institution fee. Tick: peer median.{anyBand ? " Tinted band: the middle half of what peers charge." : ""} Furthest from the median first. Peers:{" "}
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
