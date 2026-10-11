import { CREW } from "@/lib/agents/crew-members";
import { STEP_OWNER } from "@/lib/agents/narrate";
import { MARKETING_STEP_KEYS, PROVIDER_STEP_KEYS, type AdminAgent } from "@/lib/agents/types";
import { cronEntries, nextScheduledAt, pathnameOf, routeIdFor, type CronEntry } from "./schedule-check";

/**
 * Atlas's agent registry (Agentic OS PRD WP-01), built from code rather than stored rows: the
 * crew list, each step's owner (`STEP_OWNER`), the paid and marketing step lists, and the crons in
 * vercel.json. Nothing here can drift from what runs, because it is what runs. A cron with no
 * owner below fails `registry.test.ts`.
 */

/** Which crew member a scheduled route belongs to. The tick and registry tick drive several agents; Atlas owns the schedule. */
export const CRON_OWNER: Record<string, AdminAgent> = {
  "/api/admin/agents/tick": "atlas",
  "/api/admin/registry/tick": "magellan",
  "/api/admin/crew/daily-brief": "atlas",
  "/api/admin/crew/fee-alerts": "hamilton",
  "/api/admin/crew/pro-digest": "atlas",
  "/api/admin/crew/briefing-refresh": "hamilton",
  "/api/admin/crew/competitor-alerts": "hamilton",
  "/api/admin/crew/indexnow": "atlas",
  "/api/admin/crew/lead-watch": "atlas",
  "/api/admin/crew/scoreboard": "atlas",
  "/api/admin/crew/bayes": "atlas",
  "/api/admin/crew/schedule-check": "atlas",
  "/api/admin/reports/schedule": "hamilton",
  "/api/admin/crew/marketing": "growth",
  "/api/admin/crew/studies": "hamilton",
  "/api/admin/crew/answer-eval": "hamilton",
  "/api/admin/crew/content": "growth",
  "/api/admin/crew/contacts": "growth",
  "/api/admin/crew/growth-score": "growth",
  "/api/admin/crew/outreach": "growth",
  "/api/admin/crew/learning": "growth",
  "/api/admin/crew/intel": "growth",
  "/api/admin/crew/conversion": "growth",
  "/api/admin/crew/growth-loop": "growth",
};

export interface RegistrySchedule extends CronEntry {
  routeId: string | null;
}

export interface RegistryAgent {
  agent: AdminAgent;
  name: string;
  role: string;
  steps: string[];
  paidSteps: string[];
  marketingSteps: string[];
  schedules: RegistrySchedule[];
}

export function cronOwner(path: string): AdminAgent | null {
  return CRON_OWNER[pathnameOf(path)] ?? null;
}

export function agentRegistry(crons: CronEntry[] = cronEntries()): RegistryAgent[] {
  return CREW.map((member) => {
    const steps = Object.entries(STEP_OWNER)
      .filter(([, owner]) => owner === member.agent)
      .map(([step]) => step)
      .sort();
    return {
      agent: member.agent,
      name: member.name,
      role: member.role,
      steps,
      paidSteps: steps.filter((step) => PROVIDER_STEP_KEYS.includes(step)),
      marketingSteps: steps.filter((step) => MARKETING_STEP_KEYS.includes(step)),
      schedules: crons
        .filter((cron) => cronOwner(cron.path) === member.agent)
        .map((cron) => ({ ...cron, routeId: routeIdFor(cron.path) })),
    };
  });
}

/** Pure: the soonest next fire across an agent's schedules, or null when it has none. */
export function nextRunFor(schedules: CronEntry[], now: Date): string | null {
  let soonest: Date | null = null;
  for (const schedule of schedules) {
    const next = nextScheduledAt(schedule.schedule, now);
    if (next && (!soonest || next < soonest)) soonest = next;
  }
  return soonest?.toISOString() ?? null;
}
