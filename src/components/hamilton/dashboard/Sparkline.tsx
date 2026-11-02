import "./dashboard.css";

/** The points of a sparkline in a width x height box; a null quarter breaks the line. */
export function sparkSegments(values: (number | null)[], width: number, height: number, pad = 2): string[] {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (known.length < 2) return [];
  const lo = Math.min(...known);
  const span = Math.max(...known) - lo || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    const x = pad + i * step;
    const y = height - pad - ((v - lo) / span) * (height - pad * 2);
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));
  return segments;
}

/** A decorative trend line; the figure it belongs to carries the words. */
export function Sparkline({ values, emphasis = false, width = 100, height = 34 }: { values: (number | null)[]; emphasis?: boolean; width?: number; height?: number }) {
  const segments = sparkSegments(values, width, height);
  if (segments.length === 0) return null;
  return (
    <svg className="hd-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      {segments.map((points, i) => (
        <polyline key={i} points={points} fill="none" stroke={emphasis ? "var(--fi-brick)" : "var(--fi-ink)"} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}
