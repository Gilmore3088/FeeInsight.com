import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import type { AgentRunStepDefinition } from "@/lib/agents/types";
import { DARWIN_VERIFY_MAX_LIMIT } from "@/lib/agents/darwin/verify";
import { HAMILTON_PUBLISH_MAX_LIMIT } from "@/lib/agents/hamilton/publish";
import { DISCOVERY_METHOD_VERSION, MAGELLAN_DISCOVERY_MAX_LIMIT, UPGRADE_SEARCH_VERSION } from "@/lib/agents/magellan/discovery";
import { FEE_NAMED_LINK_SQL, PRODUCT_LINK_SQL } from "@/lib/agents/magellan/link-coverage";

type SqlTag = typeof sql;

/**
 * The direct re-search of one state's missed banks, for a state whose lane is hours away
 * (coordinator, 2026-10-07: 60 Tennessee banks Magellan gave up on, plus 45 whose link is
 * a checking-account page, re-searched with discovery method 5 without waiting for the TN
 * lane). Each run searches the state's due banks (dead ends whose last search used an
 * older method, then product-page links searched for the real schedule) and carries what
 * it finds through fetch, read, extract, verify and publish. Free steps only. A requested
 * state gets runs until nothing in it is due or its request expires; Magellan's own
 * selectors decide which banks are due, so a bank is never searched twice under one method.
 */
export const PRIORITY_STATE_RESEARCH_SOURCE = "atlas.priority_state_research";
/** Product-page links searched per run beside the dead ends (the default is 3). */
export const STATE_RESEARCH_UPGRADE_SLOTS = 25;

export interface PriorityStateResearchRequest {
  stateCode: string;
  reason: string;
  /** The request ends on its own after this day (UTC, inclusive). */
  until: string;
}

export const PRIORITY_STATE_RESEARCH_REQUESTS: readonly PriorityStateResearchRequest[] = [
  {
    stateCode: "TN",
    reason: "Tennessee coverage gap: 60 dead-end banks with a website and 45 checking-page links re-searched with discovery method 5",
    until: "2026-10-10",
  },
];

export function stateResearchSteps(): AgentRunStepDefinition[] {
  return [
    {
      key: "discover",
      agent: "magellan",
      title: "Re-search the state's missed banks",
      input: { discovery_limit: MAGELLAN_DISCOVERY_MAX_LIMIT, upgrade_slots: STATE_RESEARCH_UPGRADE_SLOTS },
    },
    { key: "fetch", agent: "magellan", title: "Fetch the fee documents found" },
    { key: "read", agent: "rosetta", title: "Read and normalize the fee documents" },
    { key: "extract", agent: "knox", title: "Extract fee observations" },
    { key: "classify", agent: "darwin", title: "Classify and verify extracted fees", input: { verify_limit: DARWIN_VERIFY_MAX_LIMIT } },
    { key: "publish", agent: "hamilton", title: "Publish verified fees", input: { publish_limit: HAMILTON_PUBLISH_MAX_LIMIT } },
  ];
}

/**
 * Banks in the state a re-search would pick now: dead ends with a website whose last
 * search used an older method (12 hours after it), and product-page links not yet
 * searched for the real schedule at the current upgrade version.
 */
export async function countStateResearchDue(db: SqlTag, stateCode: string): Promise<{ deadEnds: number; productPages: number }> {
  const currentMethod = JSON.stringify({ method_version: DISCOVERY_METHOD_VERSION });
  const upgradeMarker = JSON.stringify({ upgrade_search: UPGRADE_SEARCH_VERSION });
  const [row] = await db<Array<{ dead_ends: number | string; product_pages: number | string }>>`
    SELECT
      COUNT(*) FILTER (WHERE
        COALESCE(btrim(inst.fee_schedule_url), '') = ''
        AND inst.rescue_status IN ('dead', 'needs_human')
        AND inst.last_rescue_attempt_at < NOW() - INTERVAL '12 hours'
        AND NOT EXISTS (
          SELECT 1 FROM pipeline_attempts pa
           WHERE pa.institution_id = inst.id AND pa.stage = 'discover' AND pa.detail @> ${currentMethod}::jsonb
        )
      )::int AS dead_ends,
      COUNT(*) FILTER (WHERE
        lower(inst.fee_schedule_url) ~ ${PRODUCT_LINK_SQL}
        AND lower(inst.fee_schedule_url) !~ ${FEE_NAMED_LINK_SQL}
        AND COALESCE(profile.locked_by_correction, FALSE) IS FALSE
        AND NOT EXISTS (
          SELECT 1 FROM pipeline_attempts pa
           WHERE pa.institution_id = inst.id AND pa.stage = 'discover' AND pa.detail @> ${upgradeMarker}::jsonb
        )
      )::int AS product_pages
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND upper(btrim(inst.state_code)) = ${stateCode}
       AND COALESCE(btrim(inst.website_url), '') <> ''
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
  `;
  return { deadEnds: Number(row?.dead_ends ?? 0), productPages: Number(row?.product_pages ?? 0) };
}

export interface SchedulePriorityStateResearchResult {
  states: Array<{
    stateCode: string;
    status: "scheduled" | "reused" | "in_flight" | "nothing_due" | "expired" | "failed";
    runId?: number;
    deadEnds?: number;
    productPages?: number;
    error?: string;
  }>;
}

/**
 * One run per requested state at a time, and none while the state's own lane is running
 * (a queued lane does not count)
 * (the lane's discovery would search the same banks). Called once per tick.
 */
export async function schedulePriorityStateResearchRuns(
  options: { db?: SqlTag; now?: Date; requests?: readonly PriorityStateResearchRequest[] } = {},
): Promise<SchedulePriorityStateResearchResult> {
  const db = options.db ?? sql;
  const now = options.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  const result: SchedulePriorityStateResearchResult = { states: [] };
  for (const request of options.requests ?? PRIORITY_STATE_RESEARCH_REQUESTS) {
    const stateCode = request.stateCode.trim().toUpperCase();
    if (day > request.until) {
      result.states.push({ stateCode, status: "expired" });
      continue;
    }
    try {
      const [{ busy }] = await db<Array<{ busy: number | string }>>`
        SELECT COUNT(*)::int AS busy
          FROM agent_runs
         WHERE upper(btrim(state_code)) = ${stateCode}
           AND (
             (params_json->>'source' = ${PRIORITY_STATE_RESEARCH_SOURCE}::text
               AND status IN ('queued', 'running', 'cancel_requested'))
             -- Only a lane actually running: TN's lane sat queued from 00:55 to past 08:00 on
             -- 7 Oct, and waiting on a queued lane is exactly the wait this path skips.
             OR (run_kind = 'workflow_lane' AND status IN ('running', 'cancel_requested'))
           )
      `;
      if (Number(busy) > 0) {
        result.states.push({ stateCode, status: "in_flight" });
        continue;
      }
      const due = await countStateResearchDue(db, stateCode);
      if (due.deadEnds + due.productPages === 0) {
        result.states.push({ stateCode, status: "nothing_due", ...due });
        continue;
      }
      const started = await startAgentRun({
        agent: "atlas",
        kind: "manual_repair",
        title: `Re-search missed banks: ${stateCode}`,
        stateCode,
        params: {
          source: PRIORITY_STATE_RESEARCH_SOURCE,
          state_code: stateCode,
          reason: request.reason,
          dead_ends_due: due.deadEnds,
          product_pages_due: due.productPages,
          method_version: DISCOVERY_METHOD_VERSION,
        },
        triggeredBy: "api.admin.agents.tick",
        triggerSource: "schedule",
        idempotencyKey: `atlas:state-research:${stateCode}:${hour}`,
        steps: stateResearchSteps(),
        summary: `Direct re-search of ${stateCode}: ${due.deadEnds} dead ends and ${due.productPages} product-page links due.`,
      });
      result.states.push({ stateCode, status: started.reused ? "reused" : "scheduled", runId: started.run.id, ...due });
    } catch (error) {
      result.states.push({ stateCode, status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
