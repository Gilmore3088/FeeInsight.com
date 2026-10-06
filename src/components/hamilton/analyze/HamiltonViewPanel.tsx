"use client";

import { renderInline } from "./markdown";

interface HamiltonViewPanelProps {
  content: string;
  confidence: { level: string; basis: string[] } | null;
  isStreaming: boolean;
}

/**
 * HamiltonViewPanel — Hamilton's core analytical finding (inner content only).
 * The card wrapper with left accent border lives in AnalyzeWorkspace.
 * Matches HTML prototype: HAMILTON'S VIEW label, green confidence dot, large serif thesis.
 * Skeleton shimmer while streaming and content is empty.
 */
export function HamiltonViewPanel({ content, confidence, isStreaming }: HamiltonViewPanelProps) {
  const showSkeleton = isStreaming && !content;
  const confidenceLevel = confidence?.level?.toLowerCase();

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <label
          className="text-[10px] uppercase tracking-[0.25em] font-bold italic"
          style={{ color: "var(--hamilton-primary)" }}
        >
          Hamilton&apos;s View
        </label>

        {/* Confidence badge — only rendered when a confidence level was actually
            derived. Avoids a dishonest "high confidence" default on info-request
            responses where no analytical confidence exists. */}
        {confidenceLevel && (
          <div
            className="flex items-center gap-2 px-2.5 py-1 rounded text-[9px] font-bold uppercase tracking-widest border"
            style={{
              backgroundColor: "var(--hamilton-surface-container-high)",
              color: "var(--hamilton-text-secondary)",
              borderColor: "rgba(216,194,184,0.3)",
            }}
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{
                backgroundColor:
                  confidenceLevel === "high"
                    ? "#16a34a"
                    : confidenceLevel === "medium"
                    ? "#d97706"
                    : "#dc2626",
              }}
              aria-hidden="true"
            />
            {confidenceLevel === "high"
              ? "High confidence"
              : confidenceLevel === "medium"
              ? "Medium confidence"
              : "Low confidence"}
            {confidence?.basis?.length ? ` — ${confidence.basis.join("; ")}` : ""}
          </div>
        )}
      </div>

      {/* Thesis — large serif */}
      {showSkeleton ? (
        <div className="space-y-3">
          <div className="skeleton h-8 rounded w-full" />
          <div className="skeleton h-8 rounded w-5/6" />
          <div className="skeleton h-8 rounded w-4/6" />
        </div>
      ) : (
        <h2
          className="text-3xl leading-[1.15]"
          style={{
            fontFamily: "var(--hamilton-font-serif)",
            color: "var(--hamilton-text-primary)",
          }}
        >
          {renderInline(content)}
        </h2>
      )}
    </div>
  );
}
