/**
 * StatusStrip — Full-width system status banner for the Monitor screen.
 * Server component — no "use client".
 * Confident command-center display: status + metrics + timestamp.
 * Responsive via container queries: metrics wrap to 2-column grid at narrow widths.
 */

import type { MonitorPageData } from "@/lib/hamilton/monitor-data";

interface StatusStripProps {
  status: MonitorPageData["status"];
}

const STATE_CONFIG: Record<
  string,
  { dot: string; label: string; bg: string; border: string }
> = {
  stable: {
    dot: "#16a34a",
    label: "Stable",
    bg: "rgba(22, 163, 74, 0.06)",
    border: "rgba(22, 163, 74, 0.15)",
  },
  watch: {
    dot: "#b45309",
    label: "Watch",
    bg: "rgba(180, 83, 9, 0.06)",
    border: "rgba(180, 83, 9, 0.15)",
  },
  worsening: {
    dot: "#b91c1c",
    label: "Worsening",
    bg: "rgba(185, 28, 28, 0.06)",
    border: "rgba(185, 28, 28, 0.15)",
  },
};

export function StatusStrip({ status }: StatusStripProps) {
  const config = STATE_CONFIG[status.overall] ?? STATE_CONFIG.stable;

  return (
    <div
      className="@container px-4 py-3 @md:px-8"
      style={{
        width: "100%",
        backgroundColor: config.bg,
        borderBottom: `2px solid ${config.border}`,
      }}
    >
      {/* Metrics grid: 2-col narrow, 3-col @xl, horizontal flex @2xl */}
      <div className="grid grid-cols-2 gap-4 @xl:grid-cols-3 @2xl:flex @2xl:flex-wrap @2xl:justify-between @2xl:items-center">

        {/* System status — bold state indicator; wraps under its label on narrow screens */}
        <div className="min-w-0" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem 0.75rem" }}>
          <span
            style={{
              fontFamily: "var(--hamilton-font-sans)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--hamilton-text-tertiary)",
            }}
          >
            System Status
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.25rem 0.75rem",
              borderRadius: "0.25rem",
              backgroundColor: config.border,
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: config.dot,
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: config.dot,
                boxShadow: `0 0 6px ${config.dot}`,
                animation: status.overall === "worsening" ? "pulse 2s ease-in-out infinite" : undefined,
              }}
            />
            {config.label}
          </span>
        </div>

        {/* Divider — hidden at narrow widths, visible in horizontal layout */}
        <span
          className="hidden @2xl:block"
          style={{
            width: "1px",
            height: "1.25rem",
            backgroundColor: "var(--hamilton-border)",
          }}
        />

        {/* Signal count */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem" }}>
          <span
            style={{
              fontFamily: "var(--hamilton-font-serif)",
              fontSize: "1.25rem",
              fontWeight: 400,
              color: "var(--hamilton-on-surface)",
              lineHeight: 1,
            }}
          >
            {status.newSignals}
          </span>
          <span
            style={{
              fontFamily: "var(--hamilton-font-sans)",
              fontSize: "0.6875rem",
              color: "var(--hamilton-text-secondary)",
              letterSpacing: "0.02em",
            }}
          >
            new {status.newSignals === 1 ? "signal" : "signals"} today
          </span>
        </div>

        {/* Alert count — prominent when present */}
        {status.highPriorityAlerts > 0 && (
          <>
            <span
              className="hidden @2xl:block"
              style={{
                width: "1px",
                height: "1.25rem",
                backgroundColor: "var(--hamilton-border)",
              }}
            />
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem" }}>
              <span
                style={{
                  fontFamily: "var(--hamilton-font-serif)",
                  fontSize: "1.25rem",
                  fontWeight: 400,
                  color: "#b91c1c",
                  lineHeight: 1,
                }}
              >
                {status.highPriorityAlerts}
              </span>
              <span
                style={{
                  fontSize: "0.6875rem",
                  color: "#b91c1c",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                high-priority {status.highPriorityAlerts === 1 ? "alert" : "alerts"}
              </span>
            </div>
          </>
        )}

        {/* Live indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: "#16a34a",
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontFamily: "var(--hamilton-font-sans)",
              fontSize: "0.625rem",
              fontWeight: 600,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "var(--hamilton-text-tertiary)",
            }}
          >
            Live Updates
          </span>
        </div>
      </div>
    </div>
  );
}
