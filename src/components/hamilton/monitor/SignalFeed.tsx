/**
 * SignalFeed — every change for the institutions in scope, newest first, as a memo list:
 * what kind of change, the institution, what changed, the detail, and where to look next.
 * Hamilton reports the change; it never recommends a price.
 * Server component — no "use client".
 */

import Link from "next/link";
import { timeAgo } from "@/lib/format";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import type { SignalEntry, AlertEntry } from "@/lib/hamilton/home-data";
import { LinkButton, SERIF } from "@/components/hamilton/memo/memo";

interface SignalFeedProps {
  signals: SignalEntry[];
  topAlert?: AlertEntry | null;
  selectedInstitutionId?: string | null;
}

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-terra",
  medium: "bg-warm-600",
  low: "bg-warm-300",
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

/** Split on sentence ends followed by a space, so amounts like "$2.50" stay whole. */
function sentences(body: string): string[] {
  return body.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
}

/** "What changed": the body's first sentence. */
export function deriveWhatChanged(body: string): string {
  const first = sentences(body)[0];
  if (!first) return body;
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** The rest of the body, if there is more than one sentence. */
function deriveWhyItMatters(body: string): string | null {
  const parts = sentences(body);
  if (parts.length < 2) return null;
  return parts.slice(1).join(" ").trim();
}

const CHANGE_KIND: Record<string, string> = {
  hamilton_fee_movement_detected: "Fee change",
  hamilton_competitor_fee_change: "Competitor fee change",
  hamilton_publication_completed: "Fees published",
  darwin_verification_completed: "Fees verified",
  darwin_verification_needs_review: "Fees need a second look",
  knox_extraction_completed: "New fee schedule read",
  knox_extraction_needs_review: "Fee schedule needs a second look",
  source_accepted: "New fee schedule found",
};

/** A plain label for the kind of change, without internal agent names. */
export function formatChangeKind(signalType: string): string {
  const key = signalType.toLowerCase();
  if (CHANGE_KIND[key]) return CHANGE_KIND[key];
  if (key.startsWith("claim_")) return "Institution profile";
  if (key.startsWith("source_")) return "Fee schedule source";
  const words = key
    .replace(/^(hamilton|darwin|knox|atlas|magellan|rosetta)_/, "")
    .replace(/_/g, " ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Change";
}

function formatEvidencePolicy(policy: SignalEntry["evidencePolicy"]): string | null {
  if (!policy) return null;
  if (policy === "verified-only") return "Verified fees only";
  if (policy === "provisional-first") return "Includes fees not yet verified";
  if (policy === "source-diligence") return "Source still being checked";
  return null;
}

function formatWhen(dateStr: string): { ago: string; full: string } {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return { ago: "", full: "" };
  return {
    ago: timeAgo(dateStr),
    full: d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }) + " ET",
  };
}

function actionForSignal(signal: SignalEntry): { href: string; label: string } {
  const institutionId = signal.institutionId?.trim();
  const hasInstitutionId = !!institutionId && /^[1-9]\d*$/.test(institutionId);
  const signalType = signal.signalType.toLowerCase();

  if (signalType === "source_accepted") {
    const params = new URLSearchParams({ intent: "source-refresh" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/reports?${params.toString()}`, label: "Build a report" };
  }

  if (signalType === "hamilton_publication_completed") {
    const params = new URLSearchParams({ intent: "report-refresh" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/reports?${params.toString()}`, label: "Refresh the report" };
  }

  if (signalType === "hamilton_fee_movement_detected") {
    const params = new URLSearchParams({ intent: "fee-movement" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/reports?${params.toString()}`, label: "Rerun the brief" };
  }

  if (signalType === "hamilton_competitor_fee_change") {
    return { href: "/pro/market", label: "Compare your market" };
  }

  if (signalType === "darwin_verification_completed") {
    const params = new URLSearchParams({ intent: "verification-refresh" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/analyze?${params.toString()}`, label: "See the evidence" };
  }

  if (signalType === "darwin_verification_needs_review") {
    const params = new URLSearchParams({ intent: "verification-review" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/analyze?${params.toString()}`, label: "See the evidence" };
  }

  if (signalType === "knox_extraction_completed") {
    const params = new URLSearchParams({ intent: "extraction-review" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/analyze?${params.toString()}`, label: "See the evidence" };
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
    return { href: `/submit-fees?${params.toString()}`, label: "Check the source" };
  }

  if (signalType.startsWith("claim_")) {
    const params = new URLSearchParams();
    if (hasInstitutionId) params.set("instId", institutionId);
    const query = params.toString();
    return { href: query ? `/pro/settings?${query}` : "/pro/settings", label: "Open settings" };
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
    return { href: `/submit-fees?${params.toString()}`, label: "Send us the schedule" };
  }

  if (signalType.includes("scenario")) {
    const params = new URLSearchParams({ intent: "watch-signal" });
    if (hasInstitutionId) params.set("instId", institutionId);
    return { href: `/pro/simulate?${params.toString()}`, label: "Try a price" };
  }

  const params = new URLSearchParams({ intent: "watch-signal" });
  if (institutionId && /^[1-9]\d*$/.test(institutionId)) {
    params.set("instId", institutionId);
  }
  return { href: `/pro/analyze?${params.toString()}`, label: "Ask about this" };
}

function ChangeItem({ signal, isAlert }: { signal: SignalEntry; isAlert: boolean }) {
  const severity = signal.severity.toLowerCase();
  const institutionName = deriveInstitutionName(signal);
  const whatChanged = deriveWhatChanged(signal.body);
  const detail = deriveWhyItMatters(signal.body);
  const when = formatWhen(signal.createdAt);
  const action = actionForSignal(signal);
  const evidence = formatEvidencePolicy(signal.evidencePolicy);

  return (
    <li className="flex items-start gap-3 px-5 py-4">
      <span
        className={"mt-2 inline-block h-2 w-2 shrink-0 rounded-full " + (SEVERITY_DOT[severity] ?? SEVERITY_DOT.low)}
        aria-hidden="true"
      />
      <article className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm text-warm-600">
            {isAlert ? <span className="mr-1 font-semibold text-terra-text">Alert:</span> : null}
            {formatChangeKind(signal.signalType)}
            {severity === "high" && !isAlert ? <span className="text-terra-text"> · High priority</span> : null}
          </p>
          {when.ago ? (
            <time dateTime={signal.createdAt} title={when.full} className="shrink-0 text-xs text-warm-600">
              {when.ago}
            </time>
          ) : null}
        </div>
        <h3 className="mt-1 text-lg leading-snug text-warm-900" style={SERIF}>
          {institutionName}
        </h3>
        <p className="mt-1 text-pretty text-sm leading-relaxed text-warm-800">{whatChanged}</p>
        {detail ? <p className="mt-1 text-pretty text-sm leading-relaxed text-warm-700">{detail}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Link href={action.href} className="text-terra-text underline">
            {action.label}
          </Link>
          {evidence ? <span className="text-xs text-warm-600">{evidence}</span> : null}
        </div>
      </article>
    </li>
  );
}

function EmptyState({ selectedInstitutionId }: { selectedInstitutionId?: string | null }) {
  const settingsHref = hrefWithInstitutionContext("/pro/settings", selectedInstitutionId);

  return (
    <div className="rounded-lg border border-warm-300 bg-warm-50 px-5 py-6">
      <h3 className="text-lg text-warm-900" style={SERIF}>
        No changes to show yet
      </h3>
      <p className="mt-1 max-w-prose text-pretty text-sm leading-relaxed text-warm-700">
        Changes appear here when a fee moves, a fee schedule is newly verified or a competitor you watch
        changes a price. Choose your institution, or add institutions to your watch list, to start.
      </p>
      <div className="mt-4">
        <LinkButton href={settingsHref}>Choose your institution</LinkButton>
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
    <ul className="flex flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-warm-50">
      {allSignals.map((signal) => (
        <ChangeItem key={signal.id} signal={signal} isAlert={topAlert?.signalId === signal.id} />
      ))}
    </ul>
  );
}
