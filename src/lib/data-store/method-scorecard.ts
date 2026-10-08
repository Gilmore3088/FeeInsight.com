import { sql } from "./connection";

/**
 * Which methods work: every strategy each agent tried in the last 7 days, read from
 * the learning core's attempt log (`pipeline_attempts`). Each attempt worked, found
 * nothing to do (nothing there, or already up to date), or failed. Cost is what paid
 * strategies spent. Nothing is estimated.
 */

export const STAGE_AGENT: Record<string, { agent: string; name: string; job: string }> = {
  discover: { agent: "magellan", name: "Magellan", job: "Finding fee schedule pages" },
  fetch: { agent: "magellan", name: "Magellan", job: "Downloading them" },
  read: { agent: "rosetta", name: "Rosetta", job: "Reading the documents" },
  extract: { agent: "knox", name: "Knox", job: "Pulling fees out" },
  verify: { agent: "darwin", name: "Darwin", job: "Checking each fee" },
  publish: { agent: "hamilton", name: "Hamilton", job: "Publishing and re-checking" },
};

/** Outcomes that mean "nothing to do here", counted apart from failures. */
export const NOTHING_OUTCOMES = ["no_candidates", "unchanged", "empty"];

export const STAGE_ORDER = ["discover", "fetch", "read", "extract", "verify", "publish"];

export interface MethodRow {
  stage: string;
  strategy: string;
  version: number;
  attempts: number;
  ok: number;
  /** Found nothing to do: no candidates on the page, the copy unchanged, or an empty result. Not a failure. */
  nothing: number;
  costUsd: number;
}

export interface MethodGroup {
  stage: string;
  strategy: string;
  /** The newest version seen in the window; older versions are folded into `older`. */
  current: MethodRow;
  older: MethodRow[];
}

/** Pure: group rows by stage and strategy, newest version first, busiest strategy (all versions) first. */
export function groupMethods(rows: MethodRow[]): Map<string, MethodGroup[]> {
  const byStrategy = new Map<string, MethodRow[]>();
  for (const row of rows) {
    const key = `${row.stage}|${row.strategy}`;
    byStrategy.set(key, [...(byStrategy.get(key) ?? []), row]);
  }
  const byStage = new Map<string, MethodGroup[]>();
  for (const versions of byStrategy.values()) {
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    const [current, ...older] = sorted;
    const groups = byStage.get(current.stage) ?? [];
    groups.push({ stage: current.stage, strategy: current.strategy, current, older });
    byStage.set(current.stage, groups);
  }
  const total = (group: MethodGroup) => group.current.attempts + group.older.reduce((sum, row) => sum + row.attempts, 0);
  for (const groups of byStage.values()) groups.sort((a, b) => total(b) - total(a));
  return byStage;
}

export async function getMethodScorecard(days = 7): Promise<{ readAt: string; rows: MethodRow[] }> {
  const rows = await sql`
    SELECT stage, strategy, strategy_version,
           COUNT(*)::int AS attempts,
           COUNT(*) FILTER (WHERE outcome IN ('ok', 'ok_partial'))::int AS ok,
           COUNT(*) FILTER (WHERE outcome = ANY(${NOTHING_OUTCOMES}::text[]))::int AS nothing,
           COALESCE(SUM(cost_microusd), 0)::bigint AS cost
      FROM pipeline_attempts
     WHERE created_at >= NOW() - make_interval(days => ${days})
     GROUP BY 1, 2, 3
  `;
  return {
    readAt: new Date().toISOString(),
    rows: rows.map((row) => ({
      stage: String(row.stage),
      strategy: String(row.strategy),
      version: Number(row.strategy_version),
      attempts: Number(row.attempts),
      ok: Number(row.ok),
      nothing: Number(row.nothing),
      costUsd: Math.round(Number(row.cost) / 10_000) / 100,
    })),
  };
}
