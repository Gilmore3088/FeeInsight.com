import Link from "next/link";
import { ArrowRight, ClipboardCheck, Map, Orbit } from "lucide-react";
import type { AtlasCommandCenter } from "@/lib/admin-command-center";
import type { AtlasStateLaneDispatch } from "@/lib/agents/state-lane-memory";

function number(value: number): string {
  return value.toLocaleString("en-US");
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${number(value)} ${value === 1 ? singular : pluralForm}`;
}

function atlasDestination(center: AtlasCommandCenter): {
  metric: string;
  detail: string;
  href: string;
  action: string;
  tone: "ready" | "attention" | "active";
} {
  if (center.activeJobs.length > 0) {
    return {
      metric: plural(center.activeJobs.length, "active run"),
      detail: "Follow run pickup, step events, blocked reasons, and terminal receipts.",
      href: "#atlas-live-status",
      action: "Open live runs",
      tone: "active",
    };
  }

  if (!center.provider.apiKeyConfigured || center.provider.status === "circuit_open") {
    return {
      metric: center.provider.label,
      detail: center.provider.detail,
      href: "#provider-readiness",
      action: "Provider readiness",
      tone: "attention",
    };
  }

  if (center.automation.unreadable) {
    // A failed lookup holds provider work (fail closed) but is not a stop anyone chose.
    return {
      metric: "Automation status unknown",
      detail: "The safety control could not be read, so provider work is held until it can be.",
      href: "#atlas-safety",
      action: "Review safety control",
      tone: "attention",
    };
  }

  if (!center.automation.enabled) {
    return {
      metric: "Automation stopped",
      detail: center.automation.reason ?? "Provider-backed work is paused by the global safety control.",
      href: "#atlas-safety",
      action: "Review safety stop",
      tone: "attention",
    };
  }

  return {
    metric: "Ready",
    detail: "Queue full cycles intentionally; routine state work should run through state lanes.",
    href: "#atlas-live-status",
    action: "Open live status",
    tone: "ready",
  };
}

function stateLaneDestination(dispatch: AtlasStateLaneDispatch): {
  metric: string;
  detail: string;
  href: string;
  action: string;
  tone: "ready" | "attention" | "active";
} {
  if (!dispatch.schemaReady) {
    return {
      metric: "Schema unavailable",
      detail: "State-lane memory must be available before Atlas can schedule state work.",
      href: "/admin/states",
      action: "Inspect lanes",
      tone: "attention",
    };
  }

  if (dispatch.runningLanes > 0) {
    return {
      metric: `${plural(dispatch.runningLanes, "running lane")} · ${plural(dispatch.dueLanes, "due lane")}`,
      detail: `${plural(dispatch.attentionLanes, "attention lane")} still needs operator follow-up.`,
      href: "/admin/states",
      action: "Open lanes",
      tone: "active",
    };
  }

  if (dispatch.dueLanes > 0) {
    return {
      metric: `${plural(dispatch.dueLanes, "due lane")} · ${plural(dispatch.attentionLanes, "attention lane")}`,
      detail: `${plural(dispatch.totalMissingUrls, "missing URL")} · ${plural(dispatch.totalStaleSources, "stale source")}`,
      href: "#state-lane-dispatch-heading",
      action: "Run due lanes",
      tone: "attention",
    };
  }

  if (dispatch.attentionLanes > 0) {
    return {
      metric: plural(dispatch.attentionLanes, "attention lane"),
      detail: `${plural(dispatch.totalFailures, "source failure")} · ${plural(dispatch.totalCriticalPublicFindings, "critical public finding")}`,
      href: "/admin/states",
      action: "Open lanes",
      tone: "attention",
    };
  }

  return {
    metric: `${plural(dispatch.totalLanes, "state lane")} scheduled`,
    detail: "State partitions are ready for their next scheduled run.",
    href: "/admin/states",
    action: "Open lanes",
    tone: "ready",
  };
}

function trustReviewDestination(center: AtlasCommandCenter): {
  metric: string;
  detail: string;
  href: string;
  action: string;
  tone: "ready" | "attention";
} {
  const { sourceSubmissionsPending, totalPending } = center.trustReview;

  if (sourceSubmissionsPending > 0) {
    return {
      metric: plural(totalPending, "pending item"),
      detail: `${plural(sourceSubmissionsPending, "submitted source")} waiting for acceptance, rejection, or more information.`,
      href: "/admin/quality?submissions=pending&state=submitted_source_pending_review",
      action: "Review sources",
      tone: "attention",
    };
  }

  return {
    metric: "No pending source review",
    detail: "Trust Review is clear; Knox exceptions remain in the Knox lane.",
    href: "/admin/quality",
    action: "Open Trust Review",
    tone: "ready",
  };
}

function toneClass(tone: "ready" | "attention" | "active"): string {
  if (tone === "attention") return "border-amber-200 bg-amber-50/40 dark:border-amber-950/70 dark:bg-amber-950/10";
  if (tone === "active") return "border-blue-200 bg-blue-50/40 dark:border-blue-950/70 dark:bg-blue-950/10";
  return "border-black/[0.06] bg-white dark:border-white/[0.06] dark:bg-[oklch(0.19_0_0)]";
}

function dotClass(tone: "ready" | "attention" | "active"): string {
  if (tone === "attention") return "bg-amber-500";
  if (tone === "active") return "bg-blue-500";
  return "bg-emerald-500";
}

export function AtlasCommandMap({
  center,
  stateLaneDispatch,
}: {
  center: AtlasCommandCenter;
  stateLaneDispatch: AtlasStateLaneDispatch;
}) {
  const destinations = [
    {
      title: "Atlas",
      role: "Run ledger",
      icon: Orbit,
      ...atlasDestination(center),
    },
    {
      title: "State Lanes",
      role: "State queues",
      icon: Map,
      ...stateLaneDestination(stateLaneDispatch),
    },
    {
      title: "Trust Review",
      role: "Source review",
      icon: ClipboardCheck,
      ...trustReviewDestination(center),
    },
  ];

  return (
    <section aria-labelledby="atlas-command-map-heading">
      <div className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Atlas control map</p>
          <h2 id="atlas-command-map-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Command surfaces
          </h2>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {destinations.map((destination) => {
          const Icon = destination.icon;
          return (
            <Link
              key={destination.title}
              href={destination.href}
              className={`group rounded-md border p-4 transition-colors hover:border-blue-200 hover:bg-blue-50/50 dark:hover:border-blue-950 dark:hover:bg-blue-950/20 ${toneClass(destination.tone)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-gray-500 transition-colors group-hover:text-[var(--brand-primary)]" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{destination.title}</p>
                    <p className="admin-meta mt-0.5">{destination.role}</p>
                  </div>
                </div>
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotClass(destination.tone)}`} />
              </div>
              <p className="mt-4 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {destination.metric}
              </p>
              <p className="mt-1 min-h-10 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {destination.detail}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-primary)] group-hover:text-[var(--brand-primary-hover)]">
                {destination.action}<ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
