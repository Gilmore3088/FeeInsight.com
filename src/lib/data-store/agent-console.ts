import { sql } from "./connection";
import {
  type LineageTier1,
  type LineageTier2,
  type LineageTier3,
  type LineageGraph,
  type LineageError,
  type LineageGraphResult,
  type ReasoningTraceRow,
  type MessageThread,
  type RecentPublishedFee,
} from "./agent-console-types";

/**
 * Agent console queries (Plan 62B-10, tabs: Lineage/Messages/Replay).
 *
 * Types + constants live in `./agent-console-types` (no DB dependency — safe
 * to import from client components). This module adds the server query
 * functions that hit Postgres, and re-exports the types for callers that
 * only need a single import.
 *
 * Backing DB objects:
 *   - `lineage_graph(fee_published_id)` (62B-01): JSONB Tier-3 → Tier-2 → Tier-1 → R2
 *   - `v_agent_reasoning_trace` (62B-05/06): events + messages unioned by correlation_id
 *   - `agent_messages` (62B-05): inter-agent message queue
 */

export type {
  LineageTier1,
  LineageTier2,
  LineageTier3,
  LineageGraph,
  LineageError,
  LineageGraphResult,
  ReasoningTraceRow,
  MessageThread,
  RecentPublishedFee,
};

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// The lineage_graph() SQL function returns a nested JSONB document.
// Shape (per 62B-01 lineage_graph function comment):
//   { tier_3: { row, children: [{ tier_2: { row, children: [{ tier_1: { row, r2_key? } }] } }] } }
// Or (since WR-06 fix, migration 20260517): a discriminated error payload
// when a lineage row is missing:
//   { error: "fee_published_not_found" | "tier_2_missing" | "tier_1_missing", ... }
// Types live in `./agent-console-types` and are re-exported above.

function isErrorPayload(
  g: unknown,
): g is { error: string } & Record<string, unknown> {
  return (
    typeof g === "object" &&
    g !== null &&
    "error" in g &&
    typeof (g as { error: unknown }).error === "string"
  );
}

export async function getLineageGraph(
  feePublishedId: number,
): Promise<LineageGraphResult> {
  const rows = (await sql`
    SELECT lineage_graph(${feePublishedId}::BIGINT) AS g
  `) as unknown as { g: unknown }[];
  const g = rows[0]?.g ?? null;
  if (isErrorPayload(g)) {
    const { error, ...details } = g;
    const code = error as LineageError["code"];
    return { ok: false, error: { code, details } };
  }
  return { ok: true, graph: (g as LineageGraph) ?? null };
}

export async function getReasoningTrace(
  correlationId: string,
  maxRows = 500,
): Promise<ReasoningTraceRow[]> {
  const rows = (await sql`
    SELECT kind, created_at, agent_name, intent_or_action, tool_name, entity, payload, row_id
      FROM v_agent_reasoning_trace
     WHERE correlation_id = ${correlationId}::UUID
     ORDER BY created_at
     LIMIT ${maxRows}
  `) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    kind: (r.kind === "message" ? "message" : "event") as "event" | "message",
    created_at: toIso(r.created_at) ?? "",
    agent_name: String(r.agent_name ?? ""),
    intent_or_action: r.intent_or_action == null ? null : String(r.intent_or_action),
    tool_name: r.tool_name == null ? null : String(r.tool_name),
    entity: r.entity == null ? null : String(r.entity),
    payload: r.payload,
    row_id: String(r.row_id ?? ""),
  }));
}

export async function listRecentThreads(
  sinceHours = 72,
  limit = 50,
): Promise<MessageThread[]> {
  const rows = (await sql`
    SELECT correlation_id,
           MIN(created_at) AS started_at,
           MAX(round_number) AS round_count,
           (ARRAY_AGG(intent ORDER BY created_at DESC))[1] AS latest_intent,
           (ARRAY_AGG(state ORDER BY created_at DESC))[1] AS latest_state,
           ARRAY_AGG(DISTINCT sender_agent) AS participants
      FROM agent_messages
     WHERE created_at > NOW() - make_interval(hours => ${sinceHours})
     GROUP BY correlation_id
     ORDER BY started_at DESC
     LIMIT ${limit}
  `) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    correlation_id: String(r.correlation_id),
    latest_state: String(r.latest_state ?? ""),
    round_count: Number(r.round_count ?? 0),
    latest_intent: String(r.latest_intent ?? ""),
    started_at: toIso(r.started_at) ?? "",
    participants: Array.isArray(r.participants)
      ? (r.participants as unknown[]).map(String)
      : [],
  }));
}

/**
 * Recent published fees for the Lineage tab picker (UAT Gap 6b).
 */
export async function listRecentPublishedFees(
  limit = 10,
): Promise<RecentPublishedFee[]> {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 50);
  // Filter out rolled-back rows; every live-path published-record query must
  // scope to rolled_back_at IS NULL.
  const rows = (await sql`
    SELECT fee_published_id,
           canonical_fee_key,
           institution_id,
           fee_name,
           published_at
      FROM published_fee_records
     WHERE rolled_back_at IS NULL
     ORDER BY published_at DESC
     LIMIT ${safeLimit}
  `) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    fee_published_id: Number(r.fee_published_id),
    canonical_fee_key: String(r.canonical_fee_key ?? ""),
    institution_id: Number(r.institution_id ?? 0),
    fee_name: String(r.fee_name ?? ""),
    published_at: toIso(r.published_at) ?? "",
  }));
}
