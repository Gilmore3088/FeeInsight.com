interface StatCalloutBoxProps {
  label: string;
  current: string;
  proposed: string;
}

export function StatCalloutBox({ label, current, proposed }: StatCalloutBoxProps) {
  return (
    <div
      className="hamilton-card p-4"
      style={{ backgroundColor: "var(--hamilton-surface-elevated)" }}
    >
      <div
        className="text-[11px] font-semibold uppercase tracking-wider mb-3"
        style={{ color: "var(--hamilton-text-secondary)" }}
      >
        {label}
      </div>
      <div className="flex items-center gap-3">
        <div>
          <div
            className="text-[10px] uppercase tracking-wider mb-1"
            style={{ color: "var(--hamilton-text-tertiary)" }}
          >
            Current
          </div>
          <div
            className="text-4xl font-bold tabular-nums leading-none"
            style={{
              fontFamily: "var(--hamilton-font-serif)",
              color: "var(--hamilton-text-primary)",
            }}
          >
            {current}
          </div>
        </div>
        <div style={{ color: "var(--hamilton-text-tertiary)", fontSize: "20px" }}>→</div>
        <div>
          <div
            className="text-[10px] uppercase tracking-wider mb-1"
            style={{ color: "var(--hamilton-text-tertiary)" }}
          >
            Benchmark
          </div>
          <div
            className="text-4xl font-bold tabular-nums leading-none"
            style={{
              fontFamily: "var(--hamilton-font-serif)",
              color: "var(--hamilton-accent)",
            }}
          >
            {proposed}
          </div>
        </div>
      </div>
    </div>
  );
}
