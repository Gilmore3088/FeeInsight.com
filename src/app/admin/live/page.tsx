import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import { getFlowSnapshot, getFlowWaiting } from "@/lib/agents/flow";
import { LiveFlow } from "./live-flow";

export const dynamic = "force-dynamic";

/** One plain page: which institution each agent just handled and what happened to it. */
export default async function LivePage() {
  await requireAuth("view");
  const [snapshot, waiting] = await Promise.all([
    getFlowSnapshot().catch((error) => {
      console.error("Live flow snapshot failed", error);
      return { moves: [], now: [], generatedAt: new Date().toISOString() };
    }),
    getFlowWaiting().catch((error) => {
      console.error("Live flow waiting counts failed", error);
      return null;
    }),
  ]);

  return (
    <div className="space-y-6 pb-10">
      <header>
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Live" }]} />
        <h1 className="admin-display-title mt-2">Live</h1>
        <p className="admin-lede mt-1">Each bank moves top to bottom. This shows who is handling what, and what just happened.</p>
      </header>
      <LiveFlow initial={{ ...snapshot, waiting }} />
    </div>
  );
}
