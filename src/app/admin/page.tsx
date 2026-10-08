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
import { getLeads } from "@/lib/admin-queries";
import { buildNeedsYou, needsYouHeadline } from "@/lib/console/needs-you";
import { getSpendSummary } from "@/lib/data-store/console-spend";
import { AtlasEmergencyControl } from "./atlas-emergency-control";
import { AtlasOverview } from "./atlas-overview";
import { CrewCommandBar } from "./crew-command-bar";
import { CrewLive } from "./crew-live";
import { DataFeedsPanel } from "./data-feeds-panel";
import { NeedsYouList, VitalsRow, spendVitals, type Vital } from "./today-panels";

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

// Spend moves with every paid call; a minute old is fresh enough for the home screen.
const getCachedSpendSummary = unstable_cache(getSpendSummary, ["admin", "console-spend"], { revalidate: 60 });

function dateTime(value: string | null): string {
  return value ? formatAdminDateTime(value) : "—";
}

/**
 * Today: the console's home. What needs a person first, then the vitals, then the
 * crew at work. Every item and number is read from a table; a value that could not
 * be read says so. The full run controls live at /admin/atlas/details.
 */
export default async function TodayPage() {
  await requireAuth("view");
  const [center, health, funnel, crew, feed, failureAlerts, freshness, spend, leads] = await Promise.all([
    getCachedAtlasCommandCenter(),
    getPipelineHealth().catch((error) => {
      console.error("Today pipeline health query failed", error);
      return null;
    }),
    getCachedPipelineFunnel().catch((error) => {
      console.error("Today pipeline funnel query failed", error);
      return null;
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
    getCachedSpendSummary().catch((error) => {
      console.error("Today spend query failed", error);
      return null;
    }),
    getLeads(),
  ]);
  const problems = health
    ? pipelineHealthProblems(health)
    : ["Pipeline health could not be read; check the database connection."];
  const needsYou = buildNeedsYou({ attention: center.attention, failureAlerts, leads });
  const vitals: Vital[] = [
    {
      label: "Live fees",
      value: funnel ? funnel.publishedRows.toLocaleString("en-US") : null,
      note: funnel
        ? `at ${funnel.publishedInstitutions.toLocaleString("en-US")} institutions`
        : "Could not read the published catalog.",
      href: "/admin/data",
    },
    ...spendVitals(spend?.total ?? null),
    {
      label: "Leads waiting",
      value: String(needsYou.filter((item) => item.area === "Customers").length),
      note: "requests owed a reply",
      href: "/admin/customers",
    },
  ];
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  });

  return (
    <div className="space-y-8 pb-10">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-gray-500">Today · {today}</p>
          <h1 className="admin-display-title mt-2">{needsYouHeadline(needsYou)}</h1>
          <p className="admin-lede mt-1">
            {needsYou.length === 0
              ? "The agents run on their own every five minutes. Everything below is live."
              : "Most urgent first. Each item has the button that clears it."}
          </p>
        </div>
        <Link href="/admin/atlas/details" className="text-xs font-semibold text-[var(--brand-primary)]">
          All run controls and history
        </Link>
      </header>

      <NeedsYouList items={needsYou} />

      <VitalsRow vitals={vitals} />

      <CrewCommandBar />

      {health ? (
        <AtlasOverview health={health} problems={problems} funnel={funnel ?? EMPTY_PIPELINE_FUNNEL} attention={center.attention} showAttention={false} />
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
        marketingEnabled={center.marketing.enabled}
        marketingReason={center.marketing.reason}
        marketingChangedBy={center.marketing.changedBy}
        marketingChangedAtLabel={dateTime(center.marketing.changedAt)}
      />
    </div>
  );
}
