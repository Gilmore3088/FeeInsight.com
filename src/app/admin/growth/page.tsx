export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth";
import { getMarketingControl } from "@/lib/automation-control";
import { sql } from "@/lib/data-store/connection";
import { contentSchemaReady, listContentDrafts } from "@/lib/data-store/content-drafts";
import { listGrowthSteps, readGrowthBudget } from "@/lib/data-store/growth-board";
import { contactCounts } from "@/lib/agents/growth/contacts";
import { OUTREACH_CAMPAIGN } from "@/lib/agents/growth/outreach";
import { outreachFunnel } from "@/lib/data-store/outreach-journey";
import { recentLessons } from "@/lib/agents/growth/lessons";
import { GROWTH_AGENTS } from "@/lib/agents/growth/roster";
import { GrowthBoard, QUEUE_LIMIT } from "./board";
import { parseGrowthPage } from "./queue-view";

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
  const { view, filter } = parseGrowthPage(await searchParams);
  // The run ledger and lessons are drawn only on the team view, so only that view reads them.
  const team = view === "team";

  const ready = await attempt(() => contentSchemaReady());
  const [items, control, budget, steps, lessonList, contacts, funnel] = await Promise.all([
    ready ? attempt(() => listContentDrafts(QUEUE_LIMIT)) : Promise.resolve(ready === false ? [] : null),
    attempt(() => getMarketingControl()),
    attempt(() => readGrowthBudget()),
    team ? attempt(() => listGrowthSteps(STEP_LIMIT)) : Promise.resolve(null),
    team ? Promise.all(GROWTH_AGENTS.map((agent) => attempt(() => recentLessons(sql, agent)))) : Promise.resolve(GROWTH_AGENTS.map(() => null)),
    team ? attempt(() => contactCounts()) : Promise.resolve(undefined),
    team ? attempt(() => outreachFunnel(OUTREACH_CAMPAIGN)) : Promise.resolve(undefined),
  ]);
  const lessons = new Map(GROWTH_AGENTS.map((agent, index) => [agent, lessonList[index]]));

  return (
    <GrowthBoard view={view} filter={filter} ready={ready} items={items} control={control} budget={budget} steps={steps} lessons={lessons} contacts={contacts} funnel={funnel} />
  );
}
