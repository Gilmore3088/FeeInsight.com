interface StatCalloutBoxProps {
  label: string;
  current: string;
  proposed: string;
}

/**
 * Current → Proposed callout. Values wrap inside their own column (min-w-0,
 * break-words) and step down in size on narrow cards, so a long value can
 * never spill out of the box.
 */
export function StatCalloutBox({ label, current, proposed }: StatCalloutBoxProps) {
  return (
    <div
      className="hamilton-card min-w-0 p-4"
      style={{ backgroundColor: "var(--hamilton-surface-elevated)" }}
    >
      <div
        className="text-[11px] font-semibold uppercase tracking-wider mb-3 text-pretty"
        style={{ color: "var(--hamilton-text-secondary)" }}
      >
        {label}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
        <StatValue caption="Current" value={current} color="var(--hamilton-text-primary)" />
        <div
          aria-hidden="true"
          className="pb-1"
          style={{ color: "var(--hamilton-text-tertiary)", fontSize: "20px" }}
        >
          →
        </div>
        <StatValue caption="Proposed" value={proposed} color="var(--hamilton-accent)" />
      </div>
    </div>
  );
}

function StatValue({ caption, value, color }: { caption: string; value: string; color: string }) {
  return (
    <div className="min-w-0">
      <div
        className="text-[10px] uppercase tracking-wider mb-1"
        style={{ color: "var(--hamilton-text-tertiary)" }}
      >
        {caption}
      </div>
      <div
        className={`${value.length > 10 ? "text-xl" : "text-2xl sm:text-3xl"} font-bold leading-tight break-words [font-variant-numeric:tabular-nums]`}
        style={{ fontFamily: "var(--hamilton-font-serif)", color }}
      >
        {value}
      </div>
    </div>
  );
}
