/**
 * HamiltonCommentary — Hamilton's written read of the national fee picture (the AI
 * briefing thesis) when it exists, and a plain statement of why it doesn't when it
 * doesn't. Never shows placeholder or sample text.
 * Server component — no "use client".
 */

import Link from "next/link";
import type { ThesisOutput } from "@/lib/hamilton/types";

interface HamiltonCommentaryProps {
  thesis: ThesisOutput | null;
  /** Budget policies blocking the AI call, when known. */
  blockingPolicies: string[];
  isAdmin: boolean;
  analyzeHref: string;
}

export function HamiltonCommentary({ thesis, blockingPolicies, isAdmin, analyzeHref }: HamiltonCommentaryProps) {
  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-low)" }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: "var(--hamilton-gradient-cta)" }}
          aria-hidden="true"
        >
          H
        </span>
        <h2 className="text-sm font-semibold" style={{ color: "var(--hamilton-on-surface)", fontFamily: "var(--hamilton-font-sans)" }}>
          Hamilton&apos;s read
        </h2>
      </div>

      {thesis ? (
        <>
          <p className="mt-3 text-[15px] font-medium leading-relaxed" style={{ color: "var(--hamilton-on-surface)" }}>
            {thesis.core_thesis}
          </p>
          {thesis.narrative_summary && (
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--hamilton-text-secondary)" }}>
              {thesis.narrative_summary}
            </p>
          )}
          <Link href={analyzeHref} className="mt-3 inline-block text-xs font-medium no-underline hover:underline" style={{ color: "var(--hamilton-primary)" }}>
            Ask a follow-up in Analyze →
          </Link>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--hamilton-text-secondary)" }}>
            Hamilton&apos;s written commentary is paused right now. Every number on this page still comes
            straight from published fee data.
          </p>
          {isAdmin && blockingPolicies.length > 0 && (
            <p className="mt-2 rounded-md px-3 py-2 text-xs" style={{ backgroundColor: "#fff7ed", color: "#9a3412" }}>
              Admin only: AI spending is switched off for{" "}
              {blockingPolicies.map((key, i) => (
                <span key={key}>
                  {i > 0 && ", "}
                  <code>{key}</code>
                </span>
              ))}
              . Turn these on with spending caps to bring the commentary back.
            </p>
          )}
        </>
      )}
    </section>
  );
}
