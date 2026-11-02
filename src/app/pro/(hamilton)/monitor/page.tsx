import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { fetchMonitorPageData, type MonitorPageData } from "@/lib/hamilton/monitor-data";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { STATE_NAMES } from "@/lib/us-states";
import { COMPETITOR_MOVE_WINDOW_DAYS } from "@/lib/hamilton/workspace/research";
import {
  ALERT_RECENT_DAYS,
  alertWeeks,
  buildAlertFeed,
  daysBefore,
  longDay,
  shortDay,
  watchSuggestions,
} from "@/lib/hamilton/dashboard/alerts-dashboard";
import { readNationalChanges } from "@/lib/hamilton/dashboard/alerts-read";
import { readNewestChangeRecord, readStateChanges } from "@/lib/hamilton/dashboard/command-center-read";
import { DashboardCard } from "@/components/hamilton/dashboard";
import { SignalFeed } from "@/components/hamilton/monitor/SignalFeed";
import { RefreshJobQueue } from "@/components/hamilton/monitor/WatchlistPanel";
import { AlertsDashboard } from "@/components/hamilton/monitor/AlertsDashboard";
import { DecisionLedger } from "@/components/hamilton/monitor/DecisionLedger";
import { decisionsOverview } from "@/lib/hamilton/decision-service";

export const metadata: Metadata = { title: "Alerts and watches" };

// No ISR — fresh signal data on every page load
export const dynamic = "force-dynamic";

/** One plain sentence on today's count, in place of a status dashboard. */
function todaySummary(status: MonitorPageData["status"]): string {
  const changes = status.newSignals === 1 ? "1 new update" : `${status.newSignals} new updates`;
  if (status.highPriorityAlerts === 0) return `${changes} today.`;
  const alerts =
    status.highPriorityAlerts === 1 ? "1 open alert is" : `${status.highPriorityAlerts} open alerts are`;
  return `${changes} today; ${alerts} marked high priority.`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Alerts and watches (Hamilton redesign, Nov 2026): a summary row of real counts, the watch list
 * with on/off and delete, a New watch builder, and the feed of like-for-like fee changes with its
 * filters and weekly chart; then the updates on the institutions in scope, the updates waiting on a
 * change and the team's decisions, as before. Reads are existing ones; the watchlist changes only
 * through this route's server actions.
 */
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

  const selectedId = selectedInstitution ? String(selectedInstitution.id) : null;
  const stateCode = selectedInstitution?.stateCode ?? null;
  const stateLabel = stateCode ? (STATE_NAMES[stateCode] ?? stateCode) : null;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weeks = alertWeeks(now);
  const feedDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${weeks[0].start}T00:00:00Z`)) / DAY_MS);

  // One newest-record read keys both change reads, so the state card and the feed always agree.
  const newestRecord = await readNewestChangeRecord();
  const [data, overview, national, stateChanges] = await Promise.all([
    fetchMonitorPageData(user.id, { selectedInstitutionId: selectedId }),
    // Decisions belong to the selected institution; without one there is nothing to sum.
    selectedId ? decisionsOverview(user, selectedId).catch(() => null) : Promise.resolve(null),
    readNationalChanges(feedDays, newestRecord, now),
    stateCode ? readStateChanges(stateCode, newestRecord) : Promise.resolve(undefined),
  ]);
  const decisionBody = overview?.status === 200 && overview.body && "ledger" in overview.body ? overview.body : null;

  const recentSince = daysBefore(now, ALERT_RECENT_DAYS);
  const feed = national ? buildAlertFeed(national, weeks) : null;
  // Counted on every change, named or not, so a count never undercounts.
  const nationalRecent = national
    ? national
        .filter((c) => c.changed_at >= recentSince)
        .map((c) => ({ direction: c.direction, institutionId: c.institution_id ? String(c.institution_id) : null }))
    : null;
  const watchedIds = new Set(data.watchlist.map((w) => w.institutionId));
  const suggestions = watchSuggestions({
    selected: selectedInstitution ? { id: String(selectedInstitution.id), name: selectedInstitution.name } : null,
    stateChanges: stateChanges ?? null,
    watchedIds,
  });

  const refreshHref = hrefWithInstitutionContext("/pro/monitor", selectedId);
  // Server-rendered snapshot: say when, and offer a refresh (nothing polls).
  const updatedAt = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <div className="flex w-full flex-col gap-4 text-warm-900">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="hd-label" style={{ color: "var(--fi-brick)" }}>
              {selectedInstitution ? `What changed · ${selectedInstitution.name}` : "What changed"}
            </p>
            <h1 className="m-0 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Alerts and watches</h1>
            <p className="m-0 text-sm text-warm-700">Hear first when a fee you care about moves.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={refreshHref} className="fi-btn fi-btn-secondary fi-btn-sm" style={{ minHeight: 40 }}>Refresh</Link>
            <a href="#new-watch" className="fi-btn fi-btn-primary fi-btn-sm" style={{ minHeight: 40 }}>New watch</a>
          </div>
        </header>

        <p className="m-0 text-sm text-warm-600">
          {data.monitoringScope.label} {todaySummary(data.status)} Updated {updatedAt} ET.
        </p>

        <AlertsDashboard
          stateCode={stateCode}
          stateLabel={stateLabel}
          initialWatches={data.watchlist}
          feed={feed}
          nationalRecent={nationalRecent}
          asOf={today}
          weeks={weeks}
          state={
            stateChanges === undefined || !stateLabel
              ? undefined
              : stateChanges === null
                ? null
                : { label: stateLabel, days: COMPETITOR_MOVE_WINDOW_DAYS, changes: stateChanges }
          }
          suggestions={suggestions}
          feedPeriod={`${shortDay(weeks[0].start)} to ${longDay(today)}`}
        />

        <div className="hd-grid">
          <div className="hd-span-8" style={{ display: "flex", minWidth: 0 }}>
            <DashboardCard
              title="Updates on your institution and watches"
              titleId="al-updates"
              className="hd-grow"
            >
              <p className="hd-card-note">Newest first. Each fee change is checked against the price we had on file.</p>
              <SignalFeed signals={data.signalFeed} topAlert={data.topAlert} selectedInstitutionId={selectedId} />
            </DashboardCard>
          </div>
          <aside className="hd-span-4" style={{ display: "flex", minWidth: 0 }} aria-label="Updates waiting">
            <div className="hd-card hd-grow">
              <RefreshJobQueue jobs={data.refreshJobs} watchedCount={data.watchlist.length} />
            </div>
          </aside>
        </div>

        {decisionBody ? (
          <DashboardCard title="Your decisions" titleId="al-decisions">
            <p className="hd-card-note">Each decision your team is working on, and where it stands.</p>
            <DecisionLedger ledger={decisionBody.ledger} institutionId={selectedId} />
          </DashboardCard>
        ) : null}
      </div>
    </div>
  );
}
