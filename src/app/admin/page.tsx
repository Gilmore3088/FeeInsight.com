export const dynamic = "force-dynamic";

import Link from "next/link";
import { unstable_cache } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import {
  ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG,
  ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
} from "@/lib/admin-dashboard-cache";
import { getAtlasCommandCenter } from "@/lib/admin-command-center";
import { getCrewFeed, getCrewStatus } from "@/lib/agents/crew";
import { getFailureAlerts } from "@/lib/agents/failure-alerts";
import { getFeedFreshness } from "@/lib/data-store/feed-freshness";
import { EMPTY_PIPELINE_FUNNEL, getPipelineFunnel } from "@/lib/data-store/pipeline-funnel";
import { pipelineHealthProblems } from "@/lib/job-health";
import { getPipelineHealth } from "@/lib/pipeline-health";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AtlasEmergencyControl } from "./atlas-emergency-control";
import { AtlasOverview } from "./atlas-overview";
import { CrewCommandBar } from "./crew-command-bar";
import { CrewLive } from "./crew-live";
import { DataFeedsPanel } from "./data-feeds-panel";

const getCachedAtlasCommandCenter = unstable_cache(
  getAtlasCommandCenter,
  ["admin", "atlas-command-center"],
  {
    revalidate: ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
    tags: [ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG],
  },
);

const getCachedPipelineFunnel = unstable_cache(
  getPipelineFunnel,
  ["admin", "atlas-pipeline-funnel"],
  {
    revalidate: ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
    tags: [ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG],
  },
);

// Feed and report dates move a few times a day; the call-report scan is the
// slowest read on this page, so it refreshes every five minutes.
const getCachedFeedFreshness = unstable_cache(getFeedFreshness, ["admin", "feed-freshness"], {
  revalidate: 300,
});

function dateTime(value: string | null): string {
  return value ? formatAdminDateTime(value) : "—";
}

/**
 * The crew home: what each Fee Insight worker is doing, a plain-English log of
 * what they did, and a command bar to direct them. The full command center lives
 * at /admin/atlas/details.
 */
export default async function CrewPage() {
  await requireAuth("view");
  const [center, health, funnel, crew, feed, failureAlerts, freshness] = await Promise.all([
    getCachedAtlasCommandCenter(),
    getPipelineHealth().catch((error) => {
      console.error("Crew pipeline health query failed", error);
      return null;
    }),
    getCachedPipelineFunnel().catch((error) => {
      console.error("Crew pipeline funnel query failed", error);
      return EMPTY_PIPELINE_FUNNEL;
    }),
    getCrewStatus().catch((error) => {
      console.error("Crew status query failed", error);
      return [];
    }),
    getCrewFeed({ limit: 40 }).catch((error) => {
      console.error("Crew feed query failed", error);
      return [];
    }),
    getFailureAlerts(),
    getCachedFeedFreshness().catch((error) => {
      console.error("Crew feed freshness query failed", error);
      return null;
    }),
  ]);
  const problems = health
    ? pipelineHealthProblems(health)
    : ["Pipeline health could not be read; check the database connection."];

  return (
    <div className="space-y-8 pb-10">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <Breadcrumbs items={[{ label: "Crew" }]} />
          <h1 className="admin-display-title mt-2">The crew</h1>
          <p className="admin-lede mt-1">
            Six workers keep the Bank Fee Index growing. They run on their own every five minutes; tell them what to do any time.
          </p>
        </div>
        <Link href="/admin/atlas/details" className="text-xs font-semibold text-[var(--brand-primary)]">
          All run controls and history
        </Link>
      </header>

      {failureAlerts.length > 0 ? (
        <section
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
          role="alert"
          aria-label="Failing agent work"
        >
          <p className="font-semibold">Something in the pipeline is failing</p>
          <ul className="mt-2 space-y-2">
            {failureAlerts.map((alert) => (
              <li key={alert.key}>
                <span className="font-semibold">{alert.title}.</span> {alert.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <CrewCommandBar />

      {health ? (
        <AtlasOverview health={health} problems={problems} funnel={funnel} attention={center.attention} />
      ) : (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200" role="status">
          {problems[0]}
        </p>
      )}

      <CrewLive initialCrew={crew} initialFeed={feed} />

      {freshness ? (
        <DataFeedsPanel freshness={freshness} />
      ) : (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200" role="status">
          Data feed and report dates could not be read; check the database connection.
        </p>
      )}

      <AtlasEmergencyControl
        enabled={center.automation.enabled}
        reason={center.automation.reason}
        changedBy={center.automation.changedBy}
        changedAtLabel={dateTime(center.automation.changedAt)}
        activeJobCount={center.activeJobs.length}
        pipelineEnabled={center.pipeline.enabled}
        pipelineReason={center.pipeline.reason}
        pipelineChangedBy={center.pipeline.changedBy}
        pipelineChangedAtLabel={dateTime(center.pipeline.changedAt)}
      />
    </div>
  );
}
