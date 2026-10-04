/**
 * PriorityAlertsCard — Right sidebar: "Priority Alerts" section.
 * Matches HTML prototype aside structure exactly.
 * Server component — no "use client".
 */

import type { AlertEntry } from "@/lib/hamilton/home-data";

interface PriorityAlertsCardProps {
  alerts: AlertEntry[];
}

export function PriorityAlertsCard({ alerts }: PriorityAlertsCardProps) {
  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Priority Alerts */}
      <div
        style={{
          padding: "2rem",
          backgroundColor: "var(--hamilton-surface-container-low)",
          borderRadius: "var(--hamilton-radius-lg)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
          }}
        >
          <h3
            className="font-label"
            style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--hamilton-on-surface-variant)",
              margin: 0,
            }}
          >
            Priority Alerts
          </h3>
          <span
            style={{
              width: "0.5rem",
              height: "0.5rem",
              borderRadius: "50%",
              backgroundColor: "var(--hamilton-primary)",
              flexShrink: 0,
            }}
          />
        </div>

        {alerts.length === 0 ? (
          <p
            style={{
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "var(--hamilton-on-surface-variant)",
              padding: "2rem 0",
              textAlign: "center",
              margin: 0,
            }}
          >
            No active alerts. Hamilton will flag high-priority changes.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {alerts.map((alert) => {
              const isError = alert.severity === "high";
              return (
                <div key={alert.id} style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                  <div
                    style={{
                      padding: "0.5rem",
                      borderRadius: "0.25rem",
                      backgroundColor: isError ? "var(--hamilton-error-container)" : "rgba(138, 76, 39, 0.1)",
                      color: isError ? "var(--hamilton-error)" : "var(--hamilton-primary)",
                      flexShrink: 0,
                    }}
                  >
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <div>
                    <p style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--hamilton-on-surface)", margin: "0 0 0.25rem 0" }}>
                      {alert.title}
                    </p>
                    <p style={{ fontSize: "0.75rem", color: "var(--hamilton-on-surface-variant)", margin: 0 }}>
                      {alert.body}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
