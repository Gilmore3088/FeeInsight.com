"use client";

import { renderInline } from "./markdown";

interface EvidenceMetric {
  label: string;
  value: string;
  note?: string;
}

interface EvidencePanelProps {
  metrics: EvidenceMetric[];
  isStreaming: boolean;
}

/**
 * EvidencePanel — Shows supporting data metrics for the analysis.
 * Renders the "Evidence" section from the analyze response.
 * Two columns on wide screens (label | value), stacked on phones. Every value
 * renders in one font with inline markdown; a row with no value is a group
 * heading. Notes from older saved analyses run on after the value.
 * Skeleton shimmer while streaming and metrics are empty.
 */
export function EvidencePanel({ metrics, isStreaming }: EvidencePanelProps) {
  const showSkeleton = isStreaming && metrics.length === 0;

  return (
    <div className="hamilton-card p-5">
      <h3
        className="text-xs font-semibold uppercase tracking-wider mb-3"
        style={{ color: "var(--hamilton-text-secondary)" }}
      >
        Evidence
      </h3>

      {showSkeleton ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="skeleton h-4 rounded w-1/3" />
              <div className="skeleton h-4 rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : metrics.length === 0 ? null : (
        <dl className="divide-y" style={{ borderColor: "var(--hamilton-border)" }}>
          {metrics.map((m, i) => {
            const label = m.label.replace(/^\*+|\*+$/g, "").trim();
            const value = m.value.replace(/^\*\*\s*|\s*\*\*$/g, "").trim();
            if (!value && !m.note) {
              return (
                <dt
                  key={i}
                  className="pt-5 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "var(--hamilton-text-tertiary)", borderColor: "var(--hamilton-border)" }}
                >
                  {label}
                </dt>
              );
            }
            return (
              <div
                key={i}
                className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-6"
                style={{ borderColor: "var(--hamilton-border)" }}
              >
                <dt
                  className="text-sm font-medium text-pretty"
                  style={{ color: "var(--hamilton-text-secondary)" }}
                >
                  {label}
                </dt>
                <dd
                  className="text-sm leading-relaxed text-pretty [font-variant-numeric:tabular-nums]"
                  style={{ color: "var(--hamilton-text-primary)" }}
                >
                  {renderInline(value)}
                  {m.note && <> {renderInline(m.note)}</>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
