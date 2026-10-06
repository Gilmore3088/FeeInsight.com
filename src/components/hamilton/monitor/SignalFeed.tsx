/**
 * SignalFeed — Prototype-matched signal timeline.
 * Renders signal cards matching the HTML prototype structure:
 * - border-l-4 accent, signal type label, large serif institution name
 * - WHAT CHANGED / WHY IT MATTERS / RECOMMENDED NEXT MOVE sections
 * - EXECUTE burnished CTA button
 * Server component — no "use client".
 */

import Link from "next/link";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import type { SignalEntry, AlertEntry } from "@/lib/hamilton/home-data";

interface SignalFeedProps {
  signals: SignalEntry[];
  topAlert?: AlertEntry | null;
  selectedInstitutionId?: string | null;
}

const SEVERITY_BORDER: Record<string, string> = {
  high: "var(--hamilton-primary)",
  medium: "#b45309",
  low: "var(--hamilton-outline)",
};

/** Derive a display institution name from signalType + title for seeded demo data */
function deriveInstitutionName(signal: SignalEntry): string {
  const titleInstitutionName = titlePrefixInstitutionName(signal.title);
  if (titleInstitutionName) return titleInstitutionName;

  const titleWords = signal.title.split(/\s+/);
  // Otherwise use the first 3–4 title words as institution proxy
  return titleWords.slice(0, Math.min(4, titleWords.length)).join(" ");
}

function titlePrefixInstitutionName(title: string): string | null {
  const separators = [" - ", "\u2014"];
  for (const separator of separators) {
    const index = title.indexOf(separator);
    if (index > 0) return title.slice(0, index).trim();
  }
  return null;
}

/** Derive "what changed" from body (first sentence) */
function deriveWhatChanged(body: string): string {
  const firstSentence = body.split(/[.!?]/)[0];
  return firstSentence ? firstSentence.trim() + "." : body;
}

/** Derive "why it matters" from body (second sentence, if present) */
function deriveWhyItMatters(body: string): string | null {
  const sentences = body.split(/(?<=[.!?])\s+/);
  if (sentences.length < 2) return null;
  return sentences.slice(1).join(" ").trim();
}

/** Format signal type label from snake_case */
function formatSignalType(signalType: string): string {
  return signalType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatEvidencePolicy(policy: SignalEntry["evidencePolicy"]): string | null {
  if (!policy) return null;
  if (policy === "verified-only") return "Verified-only";
  if (policy === "provisional-first") return "Provisional-first";
  if (policy === "source-diligence") return "Source diligence";
  return null;
}

/** Format createdAt as short time string */
function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return "";
  }
}

function actionForSignal(signal: SignalEntry): { href: string; label: string } {
  const institutionId = signal.institutionId?.trim();
  const hasInstitutionId = !!institutionId && /^[1-9]\d*$/.test(institutionId);
  const signalType = signal.signalType.toLowerCase();

  if (signalType === "source_accepted") {
    const params = new URLSearchParams({ intent: "source-refresh" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/reports?${params.toString()}`, label: "Build Report" };
  }

  if (signalType === "hamilton_publication_completed") {
    const params = new URLSearchParams({ intent: "report-refresh" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/reports?${params.toString()}`, label: "Refresh Report" };
  }

  if (signalType === "hamilton_fee_movement_detected") {
    const params = new URLSearchParams({ intent: "fee-movement" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/reports?${params.toString()}`, label: "Rerun Brief" };
  }

  if (signalType === "darwin_verification_completed") {
    const params = new URLSearchParams({ intent: "verification-refresh" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/analyze?${params.toString()}`, label: "Review Evidence" };
  }

  if (signalType === "darwin_verification_needs_review") {
    const params = new URLSearchParams({ intent: "verification-review" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/analyze?${params.toString()}`, label: "Review Evidence" };
  }

  if (signalType === "knox_extraction_completed") {
    const params = new URLSearchParams({ intent: "extraction-review" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/analyze?${params.toString()}`, label: "Review Evidence" };
  }

  if (signalType === "knox_extraction_needs_review") {
    const params = new URLSearchParams({
      source: "monitor",
      submitterRole: "institution_employee",
      notes: "Follow up from Hamilton Monitor extraction-review signal.",
    });
    const institutionName = titlePrefixInstitutionName(signal.title);
    if (hasInstitutionId) params.set("institutionId", institutionId);
    if (institutionName) params.set("institutionName", institutionName);
    return { href: `/submit-fees?${params.toString()}`, label: "Review Source" };
  }

  if (signalType.startsWith("claim_")) {
    const params = new URLSearchParams();
    if (hasInstitutionId) params.set("instId", institutionId);
    const query = params.toString();
    return { href: query ? `/pro/settings?${query}` : "/pro/settings", label: "Open Settings" };
  }

  if (signalType.startsWith("source_")) {
    const params = new URLSearchParams({
      source: "monitor",
      submitterRole: "institution_employee",
      notes: "Follow up from Hamilton Monitor source-status signal.",
    });
    const institutionName = titlePrefixInstitutionName(signal.title);
    if (hasInstitutionId) params.set("institutionId", institutionId);
    if (institutionName) params.set("institutionName", institutionName);
    return { href: `/submit-fees?${params.toString()}`, label: "Submit Source" };
  }

  if (signalType.includes("scenario")) {
    const params = new URLSearchParams({ intent: "watch-signal" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/simulate?${params.toString()}`, label: "Run Scenario" };
  }

  const params = new URLSearchParams({ intent: "watch-signal" });
  if (institutionId && /^[1-9]\d*$/.test(institutionId)) {
    params.set("instId", institutionId);
  }
  return { href: `/pro/analyze?${params.toString()}`, label: "Analyze" };
}

function SignalCard({ signal, isPriority }: { signal: SignalEntry; isPriority?: boolean }) {
  const borderColor = SEVERITY_BORDER[signal.severity.toLowerCase()] ?? SEVERITY_BORDER.low;
  const isHighSeverity = signal.severity.toLowerCase() === "high";
  const institutionName = deriveInstitutionName(signal);
  const whatChanged = deriveWhatChanged(signal.body);
  const whyItMatters = deriveWhyItMatters(signal.body);
  const timeLabel = formatTime(signal.createdAt);
  const action = actionForSignal(signal);
  const evidencePolicyLabel = formatEvidencePolicy(signal.evidencePolicy);

  return (
    <article
      style={{
        backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
        padding: "2rem",
        borderLeft: `4px solid ${borderColor}`,
        transition: "transform 0.15s ease",
      }}
      className="signal-card-hover"
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          {/* Signal type label */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.375rem",
            }}
          >
            <span
              className="font-label"
              style={{
                display: "block",
                fontFamily: "var(--hamilton-font-sans)",
                fontSize: "0.625rem",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: isHighSeverity
                  ? "var(--hamilton-primary)"
                  : "var(--hamilton-text-tertiary)",
              }}
            >
              {isPriority ? formatSignalType(signal.signalType) : formatSignalType(signal.signalType)}
            </span>
            {evidencePolicyLabel && (
              <span
                className="font-label"
                style={{
                  border: "1px solid var(--hamilton-outline-variant, rgba(216,194,184,0.45))",
                  borderRadius: "999px",
                  color: "var(--hamilton-text-tertiary)",
                  fontFamily: "var(--hamilton-font-sans)",
                  fontSize: "0.5625rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  padding: "0.125rem 0.375rem",
                  textTransform: "uppercase",
                }}
              >
                {evidencePolicyLabel}
              </span>
            )}
          </div>

          {/* Institution name — large serif */}
          <h3
            className="font-headline"
            style={{
              fontFamily: "var(--hamilton-font-serif)",
              fontSize: "1.5rem",
              fontWeight: 400,
              color: "var(--hamilton-on-surface)",
              lineHeight: 1.2,
            }}
          >
            {institutionName}
          </h3>
        </div>

        <time
          className="font-label"
          style={{
            fontFamily: "var(--hamilton-font-sans)",
            fontSize: "0.625rem",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--hamilton-text-tertiary)",
            flexShrink: 0,
            marginLeft: "1rem",
          }}
        >
          {timeLabel}
        </time>
      </div>

      {/* Body sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {/* What Changed */}
        <div>
          <p
            className="font-label"
            style={{
              fontFamily: "var(--hamilton-font-sans)",
              fontSize: "0.625rem",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--hamilton-text-tertiary)",
              marginBottom: "0.25rem",
              fontWeight: 600,
            }}
          >
            What Changed
          </p>
          <p
            style={{
              fontFamily: "var(--hamilton-font-sans)",
              fontSize: "0.9375rem",
              color: "var(--hamilton-on-surface)",
              lineHeight: 1.6,
            }}
          >
            {whatChanged}
          </p>
        </div>

        {/* Why It Matters — only if we have content */}
        {whyItMatters && (
          <div
            style={{
              backgroundColor: "var(--hamilton-surface-container-low, #f5f3ee)",
              padding: "1rem",
            }}
          >
            <p
              className="font-label"
              style={{
                fontFamily: "var(--hamilton-font-sans)",
                fontSize: "0.625rem",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--hamilton-text-tertiary)",
                marginBottom: "0.25rem",
                fontWeight: 600,
              }}
            >
              Why It Matters
            </p>
            <p
              style={{
                fontFamily: "var(--hamilton-font-sans)",
                fontSize: "0.875rem",
                color: "var(--hamilton-on-surface)",
                fontStyle: "italic",
                lineHeight: 1.6,
              }}
            >
              {whyItMatters}
            </p>
          </div>
        )}

        {/* Recommended Next Move + Execute CTA */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            paddingTop: "1rem",
          }}
        >
          <div>
            <p
              className="font-label"
              style={{
                fontFamily: "var(--hamilton-font-sans)",
                fontSize: "0.625rem",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--hamilton-text-tertiary)",
                marginBottom: "0.25rem",
                fontWeight: 600,
              }}
            >
              Recommended Next Move
            </p>
            <p
              style={{
                fontFamily: "var(--hamilton-font-sans)",
                fontSize: "0.875rem",
                color: "var(--hamilton-primary)",
                fontWeight: 600,
              }}
            >
              Review competitive position in{" "}
              {signal.signalType.replace(/_/g, " ").toLowerCase()}.
            </p>
          </div>

          <Link
            href={action.href}
            className="burnished-cta"
            style={{
              padding: "0.5rem 1.5rem",
              background:
                "linear-gradient(to bottom right, var(--hamilton-primary), var(--hamilton-primary-container))",
              color: "#ffffff",
              borderRadius: "var(--hamilton-radius-lg, 0.5rem)",
              fontFamily: "var(--hamilton-font-sans)",
              fontSize: "0.75rem",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              border: "none",
              cursor: "pointer",
              flexShrink: 0,
              marginLeft: "1.5rem",
              textDecoration: "none",
            }}
          >
            {action.label}
          </Link>
        </div>
      </div>
    </article>
  );
}

function formatSeverity(severity: string): string {
  const value = severity.trim().toLowerCase();
  return value ? value[0].toUpperCase() + value.slice(1) : "Unrated";
}

function ComplaintRiskCard({ signal }: { signal: SignalEntry }) {
  const whatChanged = deriveWhatChanged(signal.body);
  const institutionName = deriveInstitutionName(signal);
  const timeLabel = formatTime(signal.createdAt);

  return (
    <article
      style={{
        backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
        padding: "2rem",
        borderLeft: "4px solid var(--hamilton-outline-variant, #d8c2b8)",
        transition: "transform 0.15s ease",
      }}
      className="signal-card-hover"
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <span
            className="font-label"
            style={{
              display: "block",
              fontFamily: "var(--hamilton-font-sans)",
              fontSize: "0.625rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--hamilton-text-tertiary)",
              marginBottom: "0.375rem",
            }}
          >
            {formatSignalType(signal.signalType)}
          </span>
          <h3
            className="font-headline"
            style={{
              fontFamily: "var(--hamilton-font-serif)",
              fontSize: "1.5rem",
              fontWeight: 400,
              color: "var(--hamilton-on-surface)",
              lineHeight: 1.2,
            }}
          >
            {institutionName}
          </h3>
        </div>
        <time
          className="font-label"
          style={{
            fontFamily: "var(--hamilton-font-sans)",
            fontSize: "0.625rem",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--hamilton-text-tertiary)",
            flexShrink: 0,
            marginLeft: "1rem",
          }}
        >
          {timeLabel}
        </time>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {/* What Changed + the signal's own severity side-by-side */}
        <div style={{ display: "flex", gap: "1rem" }}>
          <div style={{ flex: 1 }}>
            <p
              className="font-label"
              style={{
                fontFamily: "var(--hamilton-font-sans)",
                fontSize: "0.625rem",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--hamilton-text-tertiary)",
                marginBottom: "0.25rem",
                fontWeight: 600,
              }}
            >
              What Changed
            </p>
            <p
              style={{
                fontFamily: "var(--hamilton-font-sans)",
                fontSize: "0.9375rem",
                color: "var(--hamilton-on-surface)",
                lineHeight: 1.6,
              }}
            >
              {whatChanged}
            </p>
          </div>

          {/* Severity badge: the signal's stored severity, not a computed score */}
          <div
            style={{
              width: "33%",
              backgroundColor: "var(--hamilton-tertiary-fixed, #f6decd)",
              color: "var(--hamilton-on-tertiary-fixed, #25190f)",
              padding: "1rem",
              textAlign: "center",
              borderRadius: "var(--hamilton-radius-md, 0.25rem)",
              flexShrink: 0,
            }}
          >
            <div
              className="font-label"
              style={{
                fontFamily: "var(--hamilton-font-sans)",
                fontSize: "0.6875rem",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "0.25rem",
              }}
            >
              Severity
            </div>
            <div
              className="font-headline"
              style={{
                fontFamily: "var(--hamilton-font-serif)",
                fontSize: "1.75rem",
                fontStyle: "italic",
                lineHeight: 1,
              }}
            >
              {formatSeverity(signal.severity)}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyState({
  selectedInstitutionId,
}: {
  selectedInstitutionId?: string | null;
}) {
  const settingsHref = hrefWithInstitutionContext("/pro/settings", selectedInstitutionId);

  return (
    <div
      style={{
        backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
        padding: "2.5rem",
        borderLeft: "4px solid var(--hamilton-outline-variant, #d8c2b8)",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        borderRadius: "0.5rem",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: "28rem", margin: "0 auto" }}>
        <div style={{
          width: "3rem",
          height: "3rem",
          borderRadius: "50%",
          backgroundColor: "var(--hamilton-surface-container-high)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 1.25rem",
          fontSize: "1.25rem",
        }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--hamilton-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <h3
          className="font-headline"
          style={{
            fontFamily: "var(--hamilton-font-serif)",
            fontSize: "1.25rem",
            fontStyle: "italic",
            fontWeight: 400,
            color: "var(--hamilton-on-surface)",
            margin: "0 0 0.75rem",
          }}
        >
          Your signal feed is ready.
        </h3>
        <p
          style={{
            fontFamily: "var(--hamilton-font-sans)",
            fontSize: "0.875rem",
            color: "var(--hamilton-text-secondary)",
            lineHeight: 1.6,
            margin: "0 0 1.5rem",
          }}
        >
          Hamilton monitors fee movements, regulatory shifts, and competitive signals
          across your watchlist. Add institutions to start receiving intelligence.
        </p>
        <Link
          href={settingsHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.625rem 1.25rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "var(--hamilton-on-primary)",
            borderRadius: "0.375rem",
            textDecoration: "none",
            letterSpacing: "0.05em",
          }}
          className="burnished-cta"
        >
          Configure Your Institution
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

export function SignalFeed({
  signals,
  topAlert,
  selectedInstitutionId = null,
}: SignalFeedProps) {
  // Merge topAlert into feed if present and not already included
  const allSignals: SignalEntry[] = [...signals];
  if (topAlert && !allSignals.find((s) => s.id === topAlert.signalId)) {
    allSignals.unshift({
      id: topAlert.signalId,
      institutionId: topAlert.institutionId ?? null,
      signalType: topAlert.signalType,
      severity: topAlert.severity,
      title: topAlert.title,
      body: topAlert.body,
      createdAt: topAlert.createdAt,
      evidencePolicy: topAlert.evidencePolicy ?? null,
      providerCallQueued: topAlert.providerCallQueued ?? false,
    });
  }

  if (allSignals.length === 0) {
    return <EmptyState selectedInstitutionId={selectedInstitutionId} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {allSignals.map((signal, index) => {
        const signalTypeLower = signal.signalType.toLowerCase();
        const isComplaintRisk =
          signalTypeLower.includes("complaint") ||
          signalTypeLower.includes("risk") ||
          signalTypeLower.includes("regulatory");

        if (isComplaintRisk && index > 0) {
          return <ComplaintRiskCard key={signal.id} signal={signal} />;
        }

        return (
          <SignalCard
            key={signal.id}
            signal={signal}
            isPriority={index === 0}
          />
        );
      })}
    </div>
  );
}
