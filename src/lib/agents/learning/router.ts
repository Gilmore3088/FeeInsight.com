import type { PlaybookFormat } from "./format";
import type { AttemptStage } from "./outcomes";
import { strategyKey, PREFERRED_SUCCESS_RATE, type Playbook } from "./playbook";

/**
 * The strategy router: memory decides the next action. Pure and deterministic.
 *   1. Never repeat a known failure: a (stage, strategy, version, fingerprint) in the
 *      playbook's do-not-retry list is skipped. Same input + same method = no attempt.
 *   2. Use what worked: the cheapest strategy with a success rate of at least 80% here.
 *   3. Otherwise use format priors: the cheapest strategy suited to the learned format.
 *   4. Otherwise the cheapest remaining strategy.
 */

export interface StrategyCandidate {
  strategy: string;
  version: number;
  costMicrousd: number;
  /** Formats this strategy suits; omitted means any. */
  formats?: PlaybookFormat[];
}

export type RouterDecision =
  | { kind: "run"; strategy: string; version: number; reason: string }
  | { kind: "skip"; reason: "known_failure" | "no_strategy"; detail: string };

export function chooseStrategy({
  stage,
  playbook,
  fingerprint,
  candidates,
}: {
  stage: AttemptStage;
  playbook: Playbook;
  fingerprint: string | null;
  candidates: StrategyCandidate[];
}): RouterDecision {
  if (candidates.length === 0) {
    return { kind: "skip", reason: "no_strategy", detail: `router: no ${stage} strategy for this input` };
  }

  const failed = (candidate: StrategyCandidate) =>
    fingerprint != null &&
    playbook.doNotRetry.find(
      (entry) =>
        entry.stage === stage &&
        entry.strategy === candidate.strategy &&
        entry.version === candidate.version &&
        entry.fingerprint === fingerprint,
    );
  const open = candidates.filter((candidate) => !failed(candidate));
  if (open.length === 0) {
    const entry = failed(candidates[0]);
    return {
      kind: "skip",
      reason: "known_failure",
      detail: `router: ${candidates.map((c) => `${c.strategy}@${c.version}`).join(", ")} already failed on this input${entry ? ` (${entry.outcome})` : ""}`,
    };
  }

  const byCost = [...open].sort((a, b) => a.costMicrousd - b.costMicrousd || b.version - a.version);

  const proven = byCost.find((candidate) => {
    const stats = playbook.strategyStats[strategyKey(stage, candidate.strategy, candidate.version)];
    return stats && stats.successes > 0 && stats.successes / stats.attempts >= PREFERRED_SUCCESS_RATE;
  });
  if (proven) {
    return { kind: "run", strategy: proven.strategy, version: proven.version, reason: `router: ${proven.strategy} has worked here before` };
  }

  if (playbook.format) {
    const suited = byCost.find((candidate) => candidate.formats?.includes(playbook.format!));
    if (suited) {
      return { kind: "run", strategy: suited.strategy, version: suited.version, reason: `router: ${playbook.format} prior → ${suited.strategy}` };
    }
  }

  const fallback = byCost[0];
  return { kind: "run", strategy: fallback.strategy, version: fallback.version, reason: `router: default → ${fallback.strategy}` };
}
