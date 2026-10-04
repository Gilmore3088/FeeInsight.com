/**
 * HamiltonViewCard — Hamilton's View section for the Executive Briefing home screen.
 * Large serif italic thesis, ASSESSMENT badge, recommended action block, action buttons.
 * Server component — no "use client".
 */

import Link from "next/link";
import type { ThesisOutput } from "@/lib/hamilton/types";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";

interface HamiltonViewCardProps {
  thesis: ThesisOutput | null;
  confidence: "high" | "medium" | "low";
  /** From the size of the selected institution's largest fee gap; null hides the badge. */
  priority?: "high" | "medium" | "low" | null;
  selectedInstitutionId?: string | null;
}

function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  if (priority === "high") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          fontSize: "0.625rem",
          fontWeight: 700,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "var(--hamilton-error)",
          backgroundColor: "rgba(186, 26, 26, 0.1)",
          borderRadius: "0.25rem",
          padding: "0.25rem 0.5rem",
        }}
      >
        <span
          style={{
            width: "0.375rem",
            height: "0.375rem",
            borderRadius: "50%",
            backgroundColor: "var(--hamilton-error)",
            flexShrink: 0,
          }}
        />
        High Priority
      </span>
    );
  }

  if (priority === "medium") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          fontSize: "0.625rem",
          fontWeight: 700,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "#b45309",
          backgroundColor: "#fffbeb",
          borderRadius: "0.25rem",
          padding: "0.25rem 0.5rem",
        }}
      >
        <span
          style={{
            width: "0.375rem",
            height: "0.375rem",
            borderRadius: "50%",
            backgroundColor: "#d97706",
            flexShrink: 0,
          }}
        />
        Medium Priority
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        fontSize: "0.625rem",
        fontWeight: 700,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        color: "var(--hamilton-on-surface-variant)",
        backgroundColor: "var(--hamilton-surface-container)",
        borderRadius: "0.25rem",
        padding: "0.25rem 0.5rem",
      }}
    >
      <span
        style={{
          width: "0.375rem",
          height: "0.375rem",
          borderRadius: "50%",
          backgroundColor: "var(--hamilton-on-surface-variant)",
          flexShrink: 0,
        }}
      />
      Low Priority
    </span>
  );
}

export function HamiltonViewCard({
  thesis,
  confidence,
  priority = null,
  selectedInstitutionId,
}: HamiltonViewCardProps) {
  const thesisText = thesis?.core_thesis ?? null;
  const recommendedText = thesis?.narrative_summary ?? null;
  const simulateHref = hrefWithInstitutionContext("/pro/simulate", selectedInstitutionId);
  const reportsHref = hrefWithInstitutionContext(
    "/pro/reports?intent=executive-briefing",
    selectedInstitutionId,
  );
  const analyzeHref = hrefWithInstitutionContext("/pro/analyze", selectedInstitutionId);

  const confidenceLabel =
    confidence === "high"
      ? "High confidence -- based on strong fee data coverage"
      : confidence === "medium"
        ? "Moderate confidence -- some fee categories have limited data"
        : "Low confidence -- several fee categories have insufficient data";

  return (
    <section
      className="editorial-shadow"
      style={{
        backgroundColor: "var(--hamilton-surface-container-lowest)",
        padding: "3rem",
        borderRadius: "var(--hamilton-radius-lg)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Header row: "Hamilton's View" + priority badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "2.5rem",
        }}
      >
        <h2
          className="font-headline"
          style={{
            fontSize: "1.875rem",
            fontWeight: 400,
            color: "var(--hamilton-primary)",
            margin: 0,
          }}
        >
          Hamilton&apos;s View
        </h2>
        {priority && <PriorityBadge priority={priority} />}
      </div>

      {/* Core thesis — large italic serif */}
      {thesis === null ? (
        <div style={{ padding: "2rem 0" }}>
          <p
            style={{
              fontSize: "0.875rem",
              fontStyle: "italic",
              color: "var(--hamilton-on-surface-variant)",
              lineHeight: 1.6,
            }}
          >
            Hamilton analysis is temporarily unavailable. Positioning data below is current.
          </p>
        </div>
      ) : (
        <div style={{ marginBottom: "2.5rem" }}>
          <p
            className="font-headline"
            style={{
              fontSize: "2.25rem",
              fontStyle: "italic",
              lineHeight: 1.4,
              color: "var(--hamilton-on-surface)",
              maxWidth: "42rem",
              margin: "0 0 1.5rem 0",
            }}
          >
            {thesisText}
          </p>
          <p
            style={{
              fontSize: "0.75rem",
              color: "var(--hamilton-on-surface-variant)",
              fontStyle: "italic",
              borderBottom: "1px solid rgba(216, 194, 184, 0.2)",
              paddingBottom: "0.5rem",
              display: "inline-block",
            }}
          >
            {confidenceLabel}
          </p>
        </div>
      )}

      {/* Recommended Action block — only when thesis exists */}
      {thesis !== null && recommendedText && (
        <div
          style={{
            marginBottom: "2.5rem",
            padding: "2rem",
            backgroundColor: "rgba(138, 76, 39, 0.05)",
            borderLeft: "4px solid var(--hamilton-primary)",
            borderRadius: "0 0.25rem 0.25rem 0",
          }}
        >
          <p
            className="font-label"
            style={{
              fontSize: "0.625rem",
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--hamilton-primary)",
              marginBottom: "0.5rem",
            }}
          >
            Recommended Action
          </p>
          <p
            className="font-headline"
            style={{
              fontSize: "1.25rem",
              fontStyle: "italic",
              lineHeight: 1.5,
              color: "var(--hamilton-on-surface)",
              margin: 0,
            }}
          >
            {recommendedText}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          paddingTop: "2rem",
          borderTop: "1px solid rgba(216, 194, 184, 0.2)",
        }}
      >
        <Link
          href={simulateHref}
          className="burnished-cta editorial-shadow no-underline"
          style={{
            padding: "0.75rem 2rem",
            color: "var(--hamilton-on-primary)",
            fontSize: "0.875rem",
            fontWeight: 700,
            borderRadius: "var(--hamilton-radius-lg)",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          Simulate Change
        </Link>
        <Link
          href={reportsHref}
          className="no-underline"
          style={{
            padding: "0.75rem 2rem",
            backgroundColor: "var(--hamilton-surface-container-low)",
            color: "var(--hamilton-on-surface)",
            fontSize: "0.875rem",
            fontWeight: 700,
            borderRadius: "var(--hamilton-radius-lg)",
          }}
        >
          Generate Board Brief
        </Link>
        <Link
          href={analyzeHref}
          className="no-underline"
          style={{
            padding: "0.75rem 2rem",
            backgroundColor: "transparent",
            color: "var(--hamilton-primary)",
            fontSize: "0.875rem",
            fontWeight: 700,
            borderRadius: "var(--hamilton-radius-lg)",
            border: "2px solid rgba(138, 76, 39, 0.2)",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          Ask Hamilton
        </Link>
      </div>
    </section>
  );
}
