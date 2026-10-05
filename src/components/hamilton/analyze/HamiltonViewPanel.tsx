"use client";

import { renderInline } from "./markdown";
import { shapeHamiltonView } from "./parse-response";

interface HamiltonViewPanelProps {
  content: string;
  confidence: { level: string; basis: string[] } | null;
  isStreaming: boolean;
}

/**
 * HamiltonViewPanel — Hamilton's core analytical finding (inner content only).
 * The card wrapper with left accent border lives in AnalyzeWorkspace.
 * The first sentence is the lead, set in serif; the rest reads as short body
 * paragraphs so a long answer never becomes one wall of display type.
 * Skeleton shimmer while streaming and content is empty.
 */
export function HamiltonViewPanel({ content, confidence, isStreaming }: HamiltonViewPanelProps) {
  const showSkeleton = isStreaming && !content;
  const confidenceLevel = confidence?.level?.toLowerCase();
  const { lead, paragraphs } = shapeHamiltonView(content);

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
              ? "High confidence — based on fee data, peer movement, and complaint trends"
              : confidenceLevel === "medium"
              ? "Medium confidence — limited peer data"
              : "Low confidence — insufficient data"}
          </div>
        )}
      </div>

      {/* Lead sentence in serif, then readable body paragraphs */}
      {showSkeleton ? (
        <div className="space-y-3">
          <div className="skeleton h-7 rounded w-full" />
          <div className="skeleton h-7 rounded w-4/6" />
          <div className="skeleton h-4 rounded w-full mt-5" />
          <div className="skeleton h-4 rounded w-5/6" />
        </div>
      ) : (
        <div className="max-w-[68ch] space-y-4">
          <h2
            className="text-xl leading-snug text-balance md:text-2xl"
            style={{
              fontFamily: "var(--hamilton-font-serif)",
              color: "var(--hamilton-text-primary)",
            }}
          >
            {renderInline(lead)}
          </h2>
          {paragraphs.map((para, i) => (
            <p
              key={i}
              className="text-[17px] leading-relaxed text-pretty [font-variant-numeric:tabular-nums]"
              style={{ color: "var(--hamilton-text-primary)" }}
            >
              {renderInline(para)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
