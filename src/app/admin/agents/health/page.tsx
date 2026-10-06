import {
  getAgentHealthTiles,
  getAgentHealthSparkline,
  HEALTH_METRICS,
  type AgentHealthTile,
} from "@/lib/data-store/agent-console";
import { Tiles } from "../overview/tiles";
import { ScreenHeader } from "../../room-hub";

export const dynamic = "force-dynamic";

export default async function AgentsHealthPage() {
  let tiles: AgentHealthTile[] = [];
  let sparklines: Record<string, number[]> = {};
  let loadError: string | null = null;

  try {
    tiles = await getAgentHealthTiles();
    const pairs = tiles.flatMap((t) =>
      HEALTH_METRICS.map((m) => ({ agent: t.agent_name, metric: m })),
    );
    const results = await Promise.all(
      pairs.map(async (p) => {
        try {
          const hist = await getAgentHealthSparkline(p.agent, p.metric, 672);
          return [`${p.agent}:${p.metric}`, hist] as const;
        } catch {
          return [`${p.agent}:${p.metric}`, []] as const;
        }
      }),
    );
    sparklines = Object.fromEntries(results);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="flex flex-col gap-3">
      <ScreenHeader title="Agent health" lede="Each agent's health tiles with their last seven days." />
      {loadError && (
        <div className="admin-card p-4 text-[12px] text-red-600 dark:text-red-400">
          Failed to load agent health: {loadError}
        </div>
      )}
      <Tiles data={tiles} sparklines={sparklines} />
    </section>
  );
}
