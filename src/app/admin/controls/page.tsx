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
import { getSpendSummary } from "@/lib/data-store/console-spend";
import { getMarketReadiness } from "@/lib/data-store/market-readiness";
import { getReportFreshness } from "@/lib/data-store/feed-freshness";
import { buildLaunchChecklist, type CheckState } from "@/lib/console/launch-checklist";
import { AtlasEmergencyControl } from "../atlas-emergency-control";
import { RoomHeader, Unreadable } from "../room-hub";
import { SpendPanel } from "../spend-panel";

// Same cache entry as the Today page.
const getCachedAtlasCommandCenter = unstable_cache(getAtlasCommandCenter, ["admin", "atlas-command-center"], {
  revalidate: ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
  tags: [ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG],
});

const MARK: Record<CheckState, { symbol: string; tone: string; label: string }> = {
  done: { symbol: "✓", tone: "bg-emerald-500", label: "Done" },
  partial: { symbol: "½", tone: "bg-amber-400", label: "Partly done" },
  not_done: { symbol: "✕", tone: "bg-red-500", label: "Not done" },
  unknown: { symbol: "?", tone: "bg-gray-400", label: "Can't check here" },
};

function dateTime(value: string | null): string {
  return value ? formatAdminDateTime(value) : "—";
}

/** The Controls room: spend against caps, the stop switches, and the launch checklist. */
export default async function ControlsRoomPage() {
  await requireAuth("view");
  const [center, spend, markets, reports] = await Promise.all([
    getCachedAtlasCommandCenter(),
    getSpendSummary().catch((error) => {
      console.error("Controls spend failed", error);
      return null;
    }),
    getMarketReadiness().catch((error) => {
      console.error("Controls market readiness failed", error);
      return null;
    }),
    getReportFreshness().catch((error) => {
      console.error("Controls report freshness failed", error);
      return null;
    }),
  ]);
  const library = reports?.find((report) => report.key === "published_reports");
  const checklist = buildLaunchChecklist({
    env: process.env,
    spend,
    readyMarkets: markets ? markets.filter((market) => market.ready).length : null,
    libraryReports: reports ? library?.count ?? 0 : null,
  });
  const done = checklist.filter((check) => check.state === "done").length;

  return (
    <div className="space-y-8 pb-10">
      <RoomHeader room="controls">
        <Link href="/admin/api-trust" prefetch={false} className="text-xs font-semibold text-[var(--brand-primary)]">
          Caps, blocked calls and route spend
        </Link>
      </RoomHeader>

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

      {spend ? <SpendPanel spend={spend} /> : <Unreadable what="Spend" />}

      <section aria-label="Launch checklist" className="admin-card px-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="admin-section-title">Launch checklist</p>
          <p className="text-xs text-gray-500">{done} of {checklist.length} done · checked when this page loads</p>
        </div>
        <ul className="mt-2 divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {checklist.map((check) => {
            const mark = MARK[check.state];
            return (
              <li key={check.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 py-2.5 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto]">
                <span
                  aria-label={mark.label}
                  className={`mt-0.5 grid size-5 place-items-center rounded-full text-[11px] font-bold text-white ${mark.tone}`}
                >
                  {mark.symbol}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{check.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{check.detail}</p>
                </div>
                {check.href ? (
                  <Link href={check.href} prefetch={false} className="col-start-2 text-xs font-semibold text-[var(--brand-primary)] sm:col-start-3 sm:self-center">
                    Open
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

    </div>
  );
}
