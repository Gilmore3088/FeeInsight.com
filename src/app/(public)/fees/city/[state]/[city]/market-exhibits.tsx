import type { BranchPoint } from "@/lib/data-store";

const MILES_PER_DEGREE_LAT = 69;

/** The branches' extent with the outermost 1% trimmed, so one misplaced branch can't shrink the rest to a dot. */
export function trimmedBounds(points: BranchPoint[]): { lat0: number; lat1: number; lon0: number; lon1: number } {
  const lats = points.map((p) => p.lat).sort((a, b) => a - b);
  const lons = points.map((p) => p.lon).sort((a, b) => a - b);
  const q = (list: number[], f: number) => list[Math.min(list.length - 1, Math.max(0, Math.round((list.length - 1) * f)))];
  return { lat0: q(lats, 0.01), lat1: q(lats, 0.99), lon0: q(lons, 0.01), lon1: q(lons, 0.99) };
}

/**
 * Every branch with a map position as a dot: banks dark, credit unions terracotta. Plotted on
 * its own latitude and longitude, with no base map, so it shows spread and clustering. The
 * fallback when the live map (branch-map-gl.tsx) can't load; the institution table is the list
 * alternative.
 */
export function BranchMap({ points, label }: { points: BranchPoint[]; label: string }) {
  if (points.length < 2) return null;
  const { lat0, lat1, lon0, lon1 } = trimmedBounds(points);
  const kx = Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180);
  const w = Math.max((lon1 - lon0) * kx, 0.01);
  const h = Math.max(lat1 - lat0, 0.01);
  const W = 400;
  const H = Math.min(Math.max((h / w) * W, 220), 420);
  const sx = (W - 24) / w;
  const sy = (H - 24) / h;
  const s = Math.min(sx, sy);
  const x = (lon: number) => 12 + ((lon - lon0) * kx) * s + ((W - 24) - w * s) / 2;
  const y = (lat: number) => 12 + (lat1 - lat) * s + ((H - 24) - h * s) / 2;
  const inside = points.filter((p) => p.lat >= lat0 && p.lat <= lat1 && p.lon >= lon0 && p.lon <= lon1);
  const miles = Math.round(w * MILES_PER_DEGREE_LAT);
  const banks = points.filter((p) => p.charter === "bank").length;
  const cus = points.length - banks;

  return (
    <figure className="rounded-2xl border border-border bg-surface-0 p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${points.length} branch locations in ${label}`}>
        <rect x="0" y="0" width={W} height={H} rx="12" className="fill-paper" />
        {inside.map((p, i) => (
          <circle
            key={i}
            cx={x(p.lon)}
            cy={y(p.lat)}
            r={3}
            className={p.charter === "bank" ? "fill-ink/70" : "fill-brick/80"}
          />
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ink/70" aria-hidden="true" /> {banks} bank branches mapped
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brick/80" aria-hidden="true" /> {cus} credit union branches mapped
        </span>
        {miles > 0 && <span>About {miles} miles across</span>}
      </figcaption>
    </figure>
  );
}

export interface CompareRow {
  label: string;
  /** Plain words for what the row measures and over what years. */
  note: string;
  values: { name: string; value: number | null; text: string }[];
}

/** A few measures, each the area against its state and the U.S., as labelled bars around zero or from zero. */
export function CompareRows({ rows }: { rows: CompareRow[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => {
        const vals = row.values.map((v) => v.value ?? 0);
        const signed = vals.some((v) => v < 0);
        const top = Math.max(...vals.map(Math.abs), 1e-9);
        return (
          <li key={row.label} className="rounded-2xl border border-border bg-surface-0 p-4">
            <p className="text-[14px] font-semibold text-ink">{row.label}</p>
            <p className="text-[12px] text-ink-muted">{row.note}</p>
            <div className="mt-3 space-y-2 text-[12px]">
              {row.values.map((v, i) => {
                const width = v.value == null ? 0 : (Math.abs(v.value) / top) * (signed ? 50 : 100);
                const left = signed ? (v.value != null && v.value < 0 ? 50 - width : 50) : 0;
                return (
                  <div key={v.name} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2">
                    <span className={`truncate ${i === 0 ? "font-semibold text-ink" : "text-ink-soft"}`}>{v.name}</span>
                    <span className="relative h-2.5 rounded-full bg-paper" aria-hidden="true">
                      {signed && <span className="absolute inset-y-[-3px] left-1/2 border-l border-border" />}
                      <span
                        className={`absolute inset-y-0 rounded-full ${i === 0 ? "bg-brick" : "bg-ink/40"}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    </span>
                    <span className="text-right font-mono tabular-nums text-ink">{v.text}</span>
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
