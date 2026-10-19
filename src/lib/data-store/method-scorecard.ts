import { sql } from "./connection";

/** Reporting categories only; the attempt log and agents' retry rules stay unchanged. */
export const METHOD_OUTCOME_GROUPS = ["worked", "nothing", "held", "nextStep", "failed"] as const;
export type MethodOutcomeGroup = (typeof METHOD_OUTCOME_GROUPS)[number];

export const STAGE_AGENT: Record<string, { agent: string; name: string; job: string }> = {
  discover: { agent: "magellan", name: "Magellan", job: "Finding fee schedule pages" },
  fetch: { agent: "magellan", name: "Magellan", job: "Downloading them" },
  read: { agent: "rosetta", name: "Rosetta", job: "Reading the documents" },
  extract: { agent: "knox", name: "Knox", job: "Pulling fees out" },
  verify: { agent: "darwin", name: "Darwin", job: "Checking each fee" },
  publish: { agent: "gutenberg", name: "Gutenberg", job: "Publishing and re-checking" },
};

export const NOTHING_OUTCOMES = ["no_candidates", "unchanged", "empty"];
const WORKED_OUTCOMES = ["ok", "ok_partial", "low_yield"];
const HELD_OUTCOMES = ["rejected", "evidence_mismatch", "wrong_document"];
const NEXT_STEP_OUTCOMES = ["scanned_pdf", "js_required", "unsupported_format", "too_large", "blocked_bot", "budget_blocked"];

export function methodOutcomeGroup(outcome: string): MethodOutcomeGroup {
  if (WORKED_OUTCOMES.includes(outcome)) return "worked";
  if (NOTHING_OUTCOMES.includes(outcome)) return "nothing";
  if (HELD_OUTCOMES.includes(outcome)) return "held";
  if (NEXT_STEP_OUTCOMES.includes(outcome)) return "nextStep";
  return "failed";
}

export const STAGE_ORDER = ["discover", "fetch", "read", "extract", "verify", "publish"];

export interface VerdictScoreSummary {
  correct: number;
  decided: number;
  holdoutCorrect: number;
  holdoutDecided: number;
  chunks: number;
  passedChunks: number;
}

export interface MethodRow {
  stage: string;
  strategy: string;
  version: number;
  attempts: number;
  ok: number;
  nothing: number;
  held: number;
  nextStep: number;
  failed: number;
  /** Exact typed outcomes remain visible, including why inputs were rejected or blocked. */
  outcomes: Record<string, number>;
  costUsd: number;
  score: VerdictScoreSummary | null;
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
  // Group typed outcomes in SQL rather than treating every non-success as an error.
  // Score details are summed by verdict, not averaged by differently sized batches.
  const rows = await sql`
    SELECT stage, strategy, strategy_version, outcome,
           COUNT(*)::int AS attempts,
           COALESCE(SUM(cost_microusd), 0)::bigint AS cost,
           COALESCE(SUM(CASE WHEN detail->>'right' ~ '^[0-9]+$' THEN (detail->>'right')::bigint ELSE 0 END)
             FILTER (WHERE strategy = 'verify.verdict_score'), 0)::bigint AS scored_right,
           COALESCE(SUM(CASE WHEN detail->>'decided' ~ '^[0-9]+$' THEN (detail->>'decided')::bigint ELSE 0 END)
             FILTER (WHERE strategy = 'verify.verdict_score'), 0)::bigint AS scored_decided,
           COALESCE(SUM(CASE WHEN detail->'holdout'->>'right' ~ '^[0-9]+$' THEN (detail->'holdout'->>'right')::bigint ELSE 0 END)
             FILTER (WHERE strategy = 'verify.verdict_score'), 0)::bigint AS holdout_right,
           COALESCE(SUM(CASE WHEN detail->'holdout'->>'wrong' ~ '^[0-9]+$' THEN (detail->'holdout'->>'wrong')::bigint ELSE 0 END)
             FILTER (WHERE strategy = 'verify.verdict_score'), 0)::bigint AS holdout_wrong
      FROM pipeline_attempts
     WHERE created_at >= NOW() - make_interval(days => ${days})
     GROUP BY 1, 2, 3, 4
  `;
  const methods = new Map<string, MethodRow>();
  for (const row of rows) {
    const stage = String(row.stage);
    const strategy = String(row.strategy);
    const version = Number(row.strategy_version);
    const key = `${stage}|${strategy}|${version}`;
    let method = methods.get(key);
    if (!method) {
      method = {
        stage, strategy, version, attempts: 0, ok: 0, nothing: 0, held: 0, nextStep: 0, failed: 0,
        outcomes: {}, costUsd: 0,
        score: strategy === "verify.verdict_score"
          ? { correct: 0, decided: 0, holdoutCorrect: 0, holdoutDecided: 0, chunks: 0, passedChunks: 0 }
          : null,
      };
      methods.set(key, method);
    }
    const outcome = String(row.outcome);
    const count = Number(row.attempts);
    method.attempts += count;
    method.outcomes[outcome] = (method.outcomes[outcome] ?? 0) + count;
    const group = methodOutcomeGroup(outcome);
    if (group === "worked") method.ok += count;
    else method[group] += count;
    method.costUsd += Number(row.cost) / 1_000_000;
    if (method.score) {
      method.score.correct += Number(row.scored_right);
      method.score.decided += Number(row.scored_decided);
      method.score.holdoutCorrect += Number(row.holdout_right);
      method.score.holdoutDecided += Number(row.holdout_right) + Number(row.holdout_wrong);
      method.score.chunks += count;
      if (outcome === "ok") method.score.passedChunks += count;
    }
  }
  return { readAt: new Date().toISOString(), rows: [...methods.values()] };
}
