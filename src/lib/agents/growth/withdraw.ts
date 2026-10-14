import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import { OUTREACH_WORKFLOW, withdrawNonBuyerDrafts } from "@/lib/agents/growth/outreach";

type SqlTag = typeof sql;

/**
 * Unreviewed first-email drafts that no longer qualify (an older `OUTREACH_QUOTE_RULE`, an
 * addressee who is not a decision-maker, or a quoted fee no longer live) were withdrawn only
 * inside a real outreach run, which runs Mondays. On 2026-10-09 James approved withdrawing the
 * 23 rule-2 drafts now, so the agent tick checks every 5 minutes and starts a one-step growth
 * run (`growth-withdraw`) when there is something to withdraw: at most one a day. The step runs
 * `withdrawNonBuyerDrafts` itself; nothing here changes a draft. Free, no model calls.
 */
export const STALE_OUTREACH_WITHDRAW_SOURCE = "growth.outreach_withdraw";
export const STALE_OUTREACH_WITHDRAW_STEP = "growth-withdraw";

export interface StaleOutreachWithdrawResult {
  scheduled: boolean;
  runId: number | null;
  /** Drafts the dry-run count found to withdraw; 0 when the check stopped earlier. */
  due: number;
  reason: "marketing_paused" | "no_drafts" | "already_ran_today" | "nothing_to_withdraw" | null;
}

export function staleOutreachWithdrawKey(day: string): string {
  return `growth:outreach-withdraw:${day}`;
}

export async function scheduleStaleOutreachWithdrawal(
  input: { marketingEnabled: boolean; now?: Date },
  db: SqlTag = sql,
): Promise<StaleOutreachWithdrawResult> {
  const none = { scheduled: false, runId: null, due: 0 };
  // Growth's steps wait while marketing is paused; queue nothing for them either.
  if (!input.marketingEnabled) return { ...none, reason: "marketing_paused" };

  // Cheap first: most ticks there is no unreviewed first email at all.
  const [pending] = await db<Array<{ n: number | string }>>`
    SELECT count(*)::int AS n FROM content_drafts
     WHERE workflow = ${OUTREACH_WORKFLOW} AND kind = 'outreach_email' AND status = 'draft'
  `;
  if (Number(pending?.n ?? 0) === 0) return { ...none, reason: "no_drafts" };

  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  const idempotencyKey = staleOutreachWithdrawKey(day);
  const [existing] = await db<Array<{ id: number | string }>>`
    SELECT id FROM agent_runs WHERE idempotency_key = ${idempotencyKey} LIMIT 1
  `;
  if (existing) return { ...none, runId: Number(existing.id), reason: "already_ran_today" };

  // The same rule the step applies, as a count: nothing changes on a dry run.
  const due = await withdrawNonBuyerDrafts(db, true);
  if (due === 0) return { ...none, reason: "nothing_to_withdraw" };

  const started = await startAgentRun({
    agent: "growth",
    kind: "workflow",
    title: `Withdraw stale outreach drafts ${day}`,
    params: { source: STALE_OUTREACH_WITHDRAW_SOURCE, agent: "carnegie", due },
    triggeredBy: "api.admin.agents.tick",
    triggerSource: "schedule",
    idempotencyKey,
    steps: [
      {
        key: STALE_OUTREACH_WITHDRAW_STEP,
        agent: "growth",
        title: "Take back unreviewed first emails that no longer qualify",
      },
    ],
    summary: `${due} unreviewed first email${due === 1 ? "" : "s"} no longer qualif${due === 1 ? "ies" : "y"}; withdrawn now rather than at Monday's outreach run.`,
  });
  return { scheduled: !started.reused, runId: started.run.id, due, reason: null };
}
