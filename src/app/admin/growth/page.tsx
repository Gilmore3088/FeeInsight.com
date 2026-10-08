export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth";
import { getMarketingControl } from "@/lib/automation-control";
import { sql } from "@/lib/data-store/connection";
import { contentSchemaReady, listContentDrafts } from "@/lib/data-store/content-drafts";
import { listGrowthSteps, readGrowthBudget } from "@/lib/data-store/growth-board";
import { recentLessons } from "@/lib/agents/growth/lessons";
import { GROWTH_AGENTS } from "@/lib/agents/growth/roster";
import { GrowthBoard, QUEUE_LIMIT } from "./board";
import { parseQueueFilter } from "./queue-view";

/** How many of growth's ledger steps the page reads. */
const STEP_LIMIT = 120;

/** A read that failed is shown as unread, never as an empty or made-up value. */
async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.error("[growth] read failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * One approval page for the whole marketing team (growth-os BUILD-PLAN 1.9): every item in
 * the queue (`content_drafts`), each agent's recent steps from the run ledger and its lessons,
 * and the marketing pause and budget state. Nothing posts or sends from here.
 */
export default async function GrowthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAuth("view");
  const filter = parseQueueFilter(await searchParams);

  const ready = await attempt(() => contentSchemaReady());
  const [items, control, budget, steps, lessonList] = await Promise.all([
    ready ? attempt(() => listContentDrafts(QUEUE_LIMIT)) : Promise.resolve(ready === false ? [] : null),
    attempt(() => getMarketingControl()),
    attempt(() => readGrowthBudget()),
    attempt(() => listGrowthSteps(STEP_LIMIT)),
    Promise.all(GROWTH_AGENTS.map((agent) => attempt(() => recentLessons(sql, agent)))),
  ]);
  const lessons = new Map(GROWTH_AGENTS.map((agent, index) => [agent, lessonList[index]]));

  return <GrowthBoard filter={filter} ready={ready} items={items} control={control} budget={budget} steps={steps} lessons={lessons} />;
}
