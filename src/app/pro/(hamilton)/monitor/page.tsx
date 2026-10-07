import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { fetchMonitorPageData, type MonitorPageData } from "@/lib/hamilton/monitor-data";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { SignalFeed } from "@/components/hamilton/monitor/SignalFeed";
import { WatchlistPanel } from "@/components/hamilton/monitor/WatchlistPanel";
import { DecisionLedger } from "@/components/hamilton/monitor/DecisionLedger";
import { decisionsOverview } from "@/lib/hamilton/decision-service";
import { LinkButton, MemoHeader, MemoPage, MemoSection } from "@/components/hamilton/memo/memo";

export const metadata: Metadata = { title: "All changes" };

// No ISR — fresh signal data on every page load
export const dynamic = "force-dynamic";

/** One plain sentence on today's count, in place of a status dashboard. */
function todaySummary(status: MonitorPageData["status"]): string {
  const changes = status.newSignals === 1 ? "1 new change" : `${status.newSignals} new changes`;
  if (status.highPriorityAlerts === 0) return `${changes} today.`;
  const alerts =
    status.highPriorityAlerts === 1 ? "1 open alert is" : `${status.highPriorityAlerts} open alerts are`;
  return `${changes} today; ${alerts} marked high priority.`;
}

export default async function MonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ instId?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    const returnPath = params.instId
      ? `/pro/monitor?instId=${encodeURIComponent(params.instId)}`
      : "/pro/monitor";
    redirect(`/login?from=${encodeURIComponent(returnPath)}`);
  }

  const { institution: selectedInstitution } = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: params.instId,
    intent: "monitor",
  });

  const data = await fetchMonitorPageData(user.id, {
    selectedInstitutionId: selectedInstitution?.id ?? null,
  });

  const selectedId = selectedInstitution ? String(selectedInstitution.id) : null;
  // Decisions belong to the selected institution; without one there is nothing to sum.
  const overview = selectedId ? await decisionsOverview(user, selectedId).catch(() => null) : null;
  const decisionBody = overview?.status === 200 && overview.body && "ledger" in overview.body ? overview.body : null;
  const refreshHref = hrefWithInstitutionContext("/pro/monitor", selectedId);
  // Server-rendered snapshot: say when, and offer a refresh (nothing polls).
  const updatedAt = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  return (
    <MemoPage>
      <MemoHeader
        kicker={selectedInstitution ? `What changed · ${selectedInstitution.name}` : "What changed"}
        title="All changes"
        dek="Fee moves at the institutions you watch, as they reach the index."
        actions={<LinkButton href={refreshHref}>Refresh</LinkButton>}
      />

      <p className="-mt-4 text-sm text-warm-600">
        {data.monitoringScope.label} {todaySummary(data.status)} Updated {updatedAt} ET.
      </p>

      {decisionBody ? (
        <MemoSection
          title="Your decisions"
          note="What your team chose, and what Hamilton is watching."
        >
          <DecisionLedger ledger={decisionBody.ledger} decisions={decisionBody.decisions} institutionId={selectedId} />
        </MemoSection>
      ) : null}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <MemoSection title="Newest first">
          <SignalFeed
            signals={data.signalFeed}
            topAlert={data.topAlert}
            selectedInstitutionId={selectedId}
          />
        </MemoSection>

        <aside aria-label="Institutions you watch">
          <WatchlistPanel
            entries={data.watchlist}
            refreshJobs={data.refreshJobs}
            selectedInstitution={selectedInstitution}
          />
        </aside>
      </div>
    </MemoPage>
  );
}
