import type { sql } from "@/lib/data-store/connection";

import type { PlaybookFormat } from "./format";
import { isPermanentForInput, isSuccessOutcome, type AttemptOutcome, type AttemptStage } from "./outcomes";

type SqlTag = typeof sql;

/**
 * The per-institution playbook: what the pipeline has learned about one institution's
 * fee documents. Stored on `institution_source_profiles` and updated after every
 * attempt by the pure `applyAttempt`; no model involved.
 */

export interface StrategyStats {
  stage: AttemptStage;
  strategy: string;
  version: number;
  attempts: number;
  successes: number;
  meanYield: number;
  meanCostMicrousd: number;
  lastOutcome: AttemptOutcome;
  lastAt: string;
  /** Last few successful yields, newest last; the source of `expectedFeeCount`. */
  recentYields: number[];
}

export interface DoNotRetryEntry {
  stage: AttemptStage;
  strategy: string;
  version: number;
  fingerprint: string;
  outcome: AttemptOutcome;
  at: string;
}

export interface Playbook {
  format: PlaybookFormat | null;
  bestStrategy: Partial<Record<AttemptStage, string>>;
  strategyStats: Record<string, StrategyStats>;
  doNotRetry: DoNotRetryEntry[];
  expectedFeeCount: number | null;
  costToDateMicrousd: number;
}

/** What `applyAttempt` needs to know about one attempt. */
export interface AttemptFacts {
  stage: AttemptStage;
  strategy: string;
  version: number;
  fingerprint: string | null;
  outcome: AttemptOutcome;
  yieldCount: number;
  costMicrousd: number;
  /** Set when the attempt learned the document's format (Rosetta). */
  format?: PlaybookFormat | null;
}

export const DO_NOT_RETRY_LIMIT = 50;
export const RECENT_YIELD_LIMIT = 5;
/** Minimum success rate for a strategy to be preferred for an institution. */
export const PREFERRED_SUCCESS_RATE = 0.8;

export const EMPTY_PLAYBOOK: Playbook = {
  format: null,
  bestStrategy: {},
  strategyStats: {},
  doNotRetry: [],
  expectedFeeCount: null,
  costToDateMicrousd: 0,
};

export function strategyKey(stage: AttemptStage, strategy: string, version: number): string {
  return `${stage}:${strategy}@${version}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function successRate(stats: StrategyStats): number {
  return stats.attempts === 0 ? 0 : stats.successes / stats.attempts;
}

/** The preferred strategy for a stage: reliable first, then cheapest, then highest yield. */
export function bestStrategyFor(stage: AttemptStage, strategyStats: Record<string, StrategyStats>): string | null {
  const reliable = Object.values(strategyStats)
    .filter((stats) => stats.stage === stage && stats.successes > 0 && successRate(stats) >= PREFERRED_SUCCESS_RATE)
    .sort((a, b) => a.meanCostMicrousd - b.meanCostMicrousd || b.meanYield - a.meanYield || b.version - a.version);
  return reliable[0]?.strategy ?? null;
}

/** Pure: the playbook after one attempt. */
export function applyAttempt(playbook: Playbook, attempt: AttemptFacts, now: Date = new Date()): Playbook {
  const at = now.toISOString();
  const key = strategyKey(attempt.stage, attempt.strategy, attempt.version);
  const previous = playbook.strategyStats[key];
  const attempts = (previous?.attempts ?? 0) + 1;
  const success = isSuccessOutcome(attempt.outcome);
  const countsYield = success && attempt.outcome !== "unchanged";
  const recentYields = countsYield
    ? [...(previous?.recentYields ?? []), attempt.yieldCount].slice(-RECENT_YIELD_LIMIT)
    : previous?.recentYields ?? [];
  const stats: StrategyStats = {
    stage: attempt.stage,
    strategy: attempt.strategy,
    version: attempt.version,
    attempts,
    successes: (previous?.successes ?? 0) + (success ? 1 : 0),
    meanYield: ((previous?.meanYield ?? 0) * (attempts - 1) + attempt.yieldCount) / attempts,
    meanCostMicrousd: ((previous?.meanCostMicrousd ?? 0) * (attempts - 1) + attempt.costMicrousd) / attempts,
    lastOutcome: attempt.outcome,
    lastAt: at,
    recentYields,
  };
  const strategyStats = { ...playbook.strategyStats, [key]: stats };

  const sameInput = (entry: DoNotRetryEntry) =>
    entry.stage === attempt.stage &&
    entry.strategy === attempt.strategy &&
    entry.version === attempt.version &&
    entry.fingerprint === attempt.fingerprint;
  let doNotRetry = playbook.doNotRetry.filter((entry) => !sameInput(entry));
  if (attempt.fingerprint && isPermanentForInput(attempt.outcome)) {
    doNotRetry = [
      ...doNotRetry,
      {
        stage: attempt.stage,
        strategy: attempt.strategy,
        version: attempt.version,
        fingerprint: attempt.fingerprint,
        outcome: attempt.outcome,
        at,
      },
    ].slice(-DO_NOT_RETRY_LIMIT);
  }

  const best = bestStrategyFor(attempt.stage, strategyStats);
  const bestStrategy = { ...playbook.bestStrategy };
  if (best) bestStrategy[attempt.stage] = best;
  else delete bestStrategy[attempt.stage];

  return {
    format: attempt.format ?? playbook.format,
    bestStrategy,
    strategyStats,
    doNotRetry,
    expectedFeeCount: attempt.stage === "extract" && countsYield ? median(recentYields) : playbook.expectedFeeCount,
    costToDateMicrousd: playbook.costToDateMicrousd + Math.max(0, attempt.costMicrousd),
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/** Builds a playbook from an `institution_source_profiles` row (missing columns mean empty). */
export function playbookFromRow(source: object | null | undefined): Playbook {
  if (!source) return EMPTY_PLAYBOOK;
  const row = source as Record<string, unknown>;
  const doNotRetry = parseJson<unknown>(row.do_not_retry, []);
  return {
    format: (row.format as PlaybookFormat | null | undefined) ?? null,
    bestStrategy: parseJson(row.best_strategy, {}),
    strategyStats: parseJson(row.strategy_stats, {}),
    doNotRetry: Array.isArray(doNotRetry) ? (doNotRetry as DoNotRetryEntry[]) : [],
    expectedFeeCount: row.expected_fee_count == null ? null : Number(row.expected_fee_count),
    costToDateMicrousd: Number(row.cost_to_date_microusd ?? 0) || 0,
  };
}

export async function loadPlaybook(db: SqlTag, institutionId: number): Promise<Playbook> {
  const [row] = await db`
    SELECT format, best_strategy, strategy_stats, do_not_retry, expected_fee_count, cost_to_date_microusd
      FROM institution_source_profiles
     WHERE institution_id = ${institutionId}
  `;
  return playbookFromRow(row);
}

/** Writes the playbook back. A missing profile row is left alone (sync creates it). */
export async function persistPlaybook(db: SqlTag, institutionId: number, playbook: Playbook): Promise<void> {
  await db`
    UPDATE institution_source_profiles
       SET format = COALESCE(${playbook.format}, format),
           best_strategy = ${JSON.stringify(playbook.bestStrategy)}::jsonb,
           strategy_stats = ${JSON.stringify(playbook.strategyStats)}::jsonb,
           do_not_retry = ${JSON.stringify(playbook.doNotRetry)}::jsonb,
           expected_fee_count = ${playbook.expectedFeeCount},
           cost_to_date_microusd = ${playbook.costToDateMicrousd},
           last_learned_at = NOW()
     WHERE institution_id = ${institutionId}
  `;
}
