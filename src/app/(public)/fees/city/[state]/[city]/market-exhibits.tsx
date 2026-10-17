import type { BranchPoint } from "@/lib/data-store";

/** The branches' extent with the outermost 1% trimmed, so one misplaced branch can't shrink the rest to a dot. */
export function trimmedBounds(points: BranchPoint[]): { lat0: number; lat1: number; lon0: number; lon1: number } {
  const lats = points.map((p) => p.lat).sort((a, b) => a - b);
  const lons = points.map((p) => p.lon).sort((a, b) => a - b);
  const q = (list: number[], f: number) => list[Math.min(list.length - 1, Math.max(0, Math.round((list.length - 1) * f)))];
  return { lat0: q(lats, 0.01), lat1: q(lats, 0.99), lon0: q(lons, 0.01), lon1: q(lons, 0.99) };
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
