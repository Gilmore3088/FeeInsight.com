"use client";

import { renderInline } from "./markdown";

interface WhatThisMeansPanelProps {
  content: string;
  isStreaming: boolean;
}

/**
 * WhatThisMeansPanel — Shows the practical implications of Hamilton's analysis.
 * Matches HTML prototype: uppercase label, font-light body text at text-lg.
 * Rendered inside the HamiltonViewPanel card's border-top section.
 */
export function WhatThisMeansPanel({ content, isStreaming }: WhatThisMeansPanelProps) {
  const showSkeleton = isStreaming && !content;

  return (
    <div className="pt-8 mt-8 border-t" style={{ borderColor: "rgba(216,194,184,0.2)" }}>
      <label
        className="text-[10px] uppercase tracking-[0.25em] font-bold block mb-4"
        style={{ color: "var(--hamilton-text-tertiary)" }}
      >
        What This Means
      </label>

      {showSkeleton ? (
        <div className="space-y-3">
          <div className="skeleton h-5 rounded w-full" />
          <div className="skeleton h-5 rounded w-5/6" />
        </div>
      ) : (
        <div className="max-w-[68ch] space-y-4">
          {content.split("\n").map((p) => p.trim()).filter((p) => /\w/.test(p)).map((para, i) => (
            <p
              key={i}
              className="text-[17px] leading-relaxed text-pretty"
              style={{ color: "var(--hamilton-text-secondary)" }}
            >
              {renderInline(para)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
