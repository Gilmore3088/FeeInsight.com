export const dynamic = "force-dynamic";

import Link from "next/link";
import { unstable_cache } from "next/cache";
import { requireAuth } from "@/lib/auth";
import {
  ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG,
  ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
} from "@/lib/admin-dashboard-cache";
import { getAtlasCommandCenter } from "@/lib/admin-command-center";
import { getFailureAlerts } from "@/lib/agents/failure-alerts";
import { getPipelineFunnel } from "@/lib/data-store/pipeline-funnel";
import { pipelineHealthProblems } from "@/lib/job-health";
import { getPipelineHealth } from "@/lib/pipeline-health";
import { getLeads } from "@/lib/admin-queries";
import { buildNeedsYou, needsYouHeadline } from "@/lib/console/needs-you";
import { getSpendSummary } from "@/lib/data-store/console-spend";
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

// Spend moves with every paid call; a minute old is fresh enough for the home screen.
const getCachedSpendSummary = unstable_cache(getSpendSummary, ["admin", "console-spend"], { revalidate: 60 });

/** One tap to each place the rest of the console lives. */
const ELSEWHERE: Array<{ href: string; label: string }> = [
  { href: "/admin/agents", label: "Agents at work" },
  { href: "/admin/data", label: "Data feeds" },
  { href: "/admin/controls", label: "Spend and switches" },
];

/**
 * Today: the console's home. What needs a person, then three numbers, nothing else.
 * The crew, pipeline funnel, data feeds and stop switches live in their rooms, one
 * tap away. Every item and number is read from a table; a value that could not be
 * read says so.
 */
export default async function TodayPage() {
  await requireAuth("view");
  const [center, health, funnel, failureAlerts, spend, leads] = await Promise.all([
    getCachedAtlasCommandCenter(),
    getPipelineHealth().catch((error) => {
      console.error("Today pipeline health query failed", error);
      return null;
    }),
    getCachedPipelineFunnel().catch((error) => {
      console.error("Today pipeline funnel query failed", error);
      return null;
    }),
    getFailureAlerts(),
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
    spendVitals(spend?.total ?? null)[0],
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
    <div className="space-y-6 pb-10">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-gray-500">Today · {today}</p>
        <h1 className="admin-display-title mt-2">{needsYouHeadline(needsYou)}</h1>
        <p className="admin-lede mt-1">
          {needsYou.length === 0
            ? "The agents run on their own every five minutes."
            : "Most urgent first. Each item has the button that clears it."}
        </p>
      </header>

      <NeedsYouList items={needsYou} />

      {problems.length > 0 ? (
        <Link
          href="/admin/agents"
          prefetch={false}
          role="status"
          className="block rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200"
        >
          <span className="font-semibold">Pipeline needs attention:</span> {problems.join(" ")}
        </Link>
      ) : null}

      <VitalsRow vitals={vitals} />

      <nav aria-label="Elsewhere in the console" className="flex flex-wrap gap-2">
        {ELSEWHERE.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            prefetch={false}
            className="rounded-full border border-black/[0.08] px-3 py-1.5 text-xs font-semibold text-[var(--brand-primary)] hover:bg-black/[0.03] dark:border-white/[0.08] dark:hover:bg-white/[0.05]"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
