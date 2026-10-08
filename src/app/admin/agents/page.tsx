export const dynamic = "force-dynamic";

import Link from "next/link";
import { unstable_cache } from "next/cache";
import { requireAuth } from "@/lib/auth";
import {
  ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG,
  ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
} from "@/lib/admin-dashboard-cache";
import { getAtlasCommandCenter } from "@/lib/admin-command-center";
import { getCrewFeed, getCrewStatus } from "@/lib/agents/crew";
import { getSpendSummary } from "@/lib/data-store/console-spend";
import { getMarketingTeam } from "@/lib/data-store/marketing-team";
import { EMPTY_PIPELINE_FUNNEL, getPipelineFunnel } from "@/lib/data-store/pipeline-funnel";
import { pipelineHealthProblems } from "@/lib/job-health";
import { getPipelineHealth } from "@/lib/pipeline-health";
import { AtlasOverview } from "../atlas-overview";
import { CrewCommandBar } from "../crew-command-bar";
import { CrewLive } from "../crew-live";
import { MarketingTeam } from "../marketing-team";
import { RoomHeader, Unreadable } from "../room-hub";
import { SpendPanel } from "../spend-panel";

// Same cache entries as the Today page.
const getCachedAtlasCommandCenter = unstable_cache(getAtlasCommandCenter, ["admin", "atlas-command-center"], {
  revalidate: ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
  tags: [ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG],
});

const getCachedPipelineFunnel = unstable_cache(getPipelineFunnel, ["admin", "atlas-pipeline-funnel"], {
  revalidate: ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
  tags: [ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG],
});

/** The Agents room: pipeline health, the run buttons, the pipeline crew and the marketing team, and what each costs. */
export default async function AgentsRoomPage() {
  await requireAuth("view");
  const [center, health, funnel, crew, feed, spend, marketing] = await Promise.all([
    getCachedAtlasCommandCenter(),
    getPipelineHealth().catch((error) => {
      console.error("Agents room pipeline health failed", error);
      return null;
    }),
    getCachedPipelineFunnel().catch((error) => {
      console.error("Agents room pipeline funnel failed", error);
      return null;
    }),
    getCrewStatus().catch((error) => {
      console.error("Agents room crew status failed", error);
      return [];
    }),
    getCrewFeed({ limit: 40 }).catch((error) => {
      console.error("Agents room crew feed failed", error);
      return [];
    }),
    getSpendSummary().catch((error) => {
      console.error("Agents room spend failed", error);
      return null;
    }),
    getMarketingTeam().catch((error) => {
      console.error("Agents room marketing team failed", error);
      return null;
    }),
  ]);

  return (
    <div className="space-y-8 pb-10">
      <RoomHeader room="agents">
        <Link href="/admin/live" prefetch={false} className="hidden text-xs font-semibold text-[var(--brand-primary)] md:inline">
          Watch banks move through the agents
        </Link>
      </RoomHeader>
      {health ? (
        <AtlasOverview
          health={health}
          problems={pipelineHealthProblems(health)}
          funnel={funnel ?? EMPTY_PIPELINE_FUNNEL}
          attention={center.attention}
          showAttention={false}
        />
      ) : (
        <Unreadable what="Pipeline health" />
      )}
      <CrewCommandBar />
      <CrewLive initialCrew={crew} initialFeed={feed}>
        {marketing ? <MarketingTeam team={marketing} /> : <Unreadable what="The marketing team" />}
      </CrewLive>
      {spend ? <SpendPanel spend={spend} title="What each agent is spending" /> : <Unreadable what="Agent spend" />}
    </div>
  );
}
