import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import { getFlowSnapshot, getFlowWaitingWithin } from "@/lib/agents/flow";
import { LiveFlow } from "./live-flow";

export const dynamic = "force-dynamic";
/** Its reads are bounded (`lib/agents/flow.ts`); a render never holds a connection for minutes (#2016). */
export const maxDuration = 30;

/** One plain page: which institution each agent just handled and what happened to it. */
export default async function LivePage() {
  await requireAuth("view");
  const [snapshot, waiting] = await Promise.all([
    getFlowSnapshot().catch((error) => {
      console.error("Live flow snapshot failed", error);
      return { moves: [], now: [], generatedAt: new Date().toISOString() };
    }),
    // The counts are waited for a few seconds at most; the page polls them again (#2016).
    getFlowWaitingWithin(),
  ]);

  return (
    <div className="space-y-6 pb-10">
      <header>
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Live" }]} />
        <h1 className="admin-display-title mt-2">Live</h1>
        <p className="admin-lede mt-1">Watch banks move through the agents, step by step, as they work.</p>
      </header>
      <LiveFlow initial={{ ...snapshot, waiting }} />
    </div>
  );
}
