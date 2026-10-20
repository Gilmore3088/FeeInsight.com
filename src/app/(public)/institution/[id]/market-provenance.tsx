/**
 * The "Details" drill-down on each market position chart: source, reporting date, coverage and
 * calculation. Same shape as the overview's provenance drawer (PR 1864), kept local to this
 * section until the two are unified. A row with no value is left out, never filled in.
 */
export interface ProvenanceRow {
  label: string;
  value: string | null | undefined;
}

export function MarketProvenance({ rows, label = "Details" }: { rows: ProvenanceRow[]; label?: string }) {
  const shown = rows.filter((row): row is { label: string; value: string } => Boolean(row.value));
  if (shown.length === 0) return null;
  return (
    <details className="group/prov mt-1">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-[9px] transition-transform group-open/prov:rotate-90">
          &#9654;
        </span>
        {label}
      </summary>
      <dl className="mb-2 grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border border-border bg-paper p-3 text-[12px] leading-snug">
        {shown.map((row) => (
          <div key={row.label} className="contents">
            <dt className="font-medium text-ink-soft">{row.label}</dt>
            <dd className="min-w-0 break-words text-ink-muted [font-variant-numeric:tabular-nums]">{row.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
