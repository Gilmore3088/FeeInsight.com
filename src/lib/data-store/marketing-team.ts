import { getMarketingControl } from "@/lib/automation-control";
import { GROWTH_AGENTS, GROWTH_AGENT_ROLES, type GrowthAgent } from "@/lib/agents/growth/roster";
import { sql } from "./connection";
import { contentSchemaReady } from "./content-drafts";
import { readGrowthBudget, type GrowthBudgetState } from "./growth-board";

/**
 * The marketing team for the Agents room: one card per agent in `growth-os/agents/`, with
 * what each has filed to the approval queue (`content_drafts`). All of them run as the ledger
 * agent `growth`, so the queue's `agent` column is what tells them apart.
 */

export interface MarketingMember {
  agent: GrowthAgent;
  name: string;
  role: string;
  /** Items this agent has filed to the queue, and how many still wait for James. */
  filed: number;
  waiting: number;
  lastFiledAt: string | null;
  status: string;
  tone: "working" | "paused" | "idle";
}

export interface FiledCount {
  agent: string;
  status: string;
  count: number;
  lastAt: string | null;
}

/** Why nothing runs, if something stops it: the marketing pause first, then the growth budget. */
export function teamStop(marketingEnabled: boolean, budget: GrowthBudgetState["state"]): string | null {
  if (!marketingEnabled) return "Paused: marketing is switched off";
  if (budget !== "enabled") return "Paused: growth budget is off";
  return null;
}

/** Pure: fold the queue counts into one card per agent, in the roster's order. */
export function summarizeMarketingTeam(rows: FiledCount[], stop: string | null): MarketingMember[] {
  return GROWTH_AGENTS.map((agent) => {
    const mine = rows.filter((row) => row.agent === agent);
    const filed = mine.reduce((sum, row) => sum + row.count, 0);
    const waiting = mine.filter((row) => row.status === "draft").reduce((sum, row) => sum + row.count, 0);
    const lastFiledAt = mine.reduce<string | null>((latest, row) => (row.lastAt && (!latest || row.lastAt > latest) ? row.lastAt : latest), null);
    const status = stop ?? (filed > 0 ? `${filed} filed for review` : "Not started yet");
    return {
      agent,
      name: agent.charAt(0).toUpperCase() + agent.slice(1),
      role: GROWTH_AGENT_ROLES[agent],
      filed,
      waiting,
      lastFiledAt,
      status,
      tone: stop ? "paused" : filed > 0 ? "working" : "idle",
    };
  });
}

export async function getMarketingTeam(): Promise<MarketingMember[]> {
  const [control, budget, ready] = await Promise.all([getMarketingControl(), readGrowthBudget(), contentSchemaReady()]);
  const rows = ready
    ? await sql`
        SELECT agent, status, COUNT(*)::int AS count, MAX(created_at) AS last_at
          FROM content_drafts
         WHERE agent IS NOT NULL
         GROUP BY 1, 2
      `
    : [];
  return summarizeMarketingTeam(
    rows.map((row) => ({
      agent: String(row.agent),
      status: String(row.status),
      count: Number(row.count),
      lastAt: row.last_at ? new Date(row.last_at as string).toISOString() : null,
    })),
    teamStop(control.enabled, budget.state),
  );
}
