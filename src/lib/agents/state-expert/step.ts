import type { sql } from "@/lib/data-store/connection";

import { PEER_MIN_INSTITUTIONS, refreshStateMemory, ALL_TIERS } from "./memory";

type SqlTag = typeof sql;

export interface StateExpertStepResult {
  status: "completed" | "skipped";
  summary: string;
  detail: Record<string, unknown>;
}

/**
 * The `state-expert` lane step (Atlas, deterministic, free). Refreshes the state's
 * memory at the start of a full pass and records what it learned in the step detail,
 * so the run ledger shows the regulator, platforms, best strategies and peer coverage
 * the rest of the run works with.
 */
export async function runStateExpertStep(options: {
  db: SqlTag;
  runId: number;
  stateCode?: string;
  dryRun?: boolean;
}): Promise<StateExpertStepResult> {
  if (!options.stateCode) {
    return {
      status: "skipped",
      summary: "State expert skipped: the run has no state scope.",
      detail: { state_code: null },
    };
  }
  const { memory, stored } = await refreshStateMemory(options.db, options.stateCode, {
    runId: options.runId,
    dryRun: options.dryRun,
  });
  if (!memory) {
    return {
      status: "skipped",
      summary: `State expert skipped: ${options.stateCode} has no state expert.`,
      detail: { state_code: options.stateCode },
    };
  }

  const stateWide = memory.peerLevels.filter((level) => level.tier === ALL_TIERS);
  const feesWithPeers = stateWide.filter((level) => level.count >= PEER_MIN_INSTITUTIONS);
  const topFinder = memory.strategies.finder[0]?.strategy ?? null;
  const topReader = memory.strategies.reader[0]?.strategy ?? null;
  const topPlatform = memory.platforms[0]?.platform ?? null;
  return {
    status: "completed",
    summary:
      `${memory.expertName} refreshed the ${memory.stateCode} memory: ${memory.institutionCount.toLocaleString()} institutions, ` +
      `${memory.publishedFeeCount.toLocaleString()} published fees, peer levels for ${feesWithPeers.length.toLocaleString()} fee categories ` +
      `with ${PEER_MIN_INSTITUTIONS}+ institutions${stored ? "" : " (memory not stored)"}.`,
    detail: {
      state_code: memory.stateCode,
      expert_name: memory.expertName,
      expert_bio: memory.expertBio,
      regulator: memory.regulator.agency,
      regulator_source: memory.regulator.source,
      credit_union_regulator: memory.regulator.creditUnionAgency,
      institutions: memory.institutionCount,
      published_fees: memory.publishedFeeCount,
      platforms: memory.platforms.slice(0, 5),
      top_platform: topPlatform,
      top_finder_strategy: topFinder,
      top_reader_strategy: topReader,
      finder_strategies: memory.strategies.finder.slice(0, 5),
      reader_strategies: memory.strategies.reader.slice(0, 5),
      peer_level_rows: memory.peerLevels.length,
      fee_categories_with_peers: feesWithPeers.length,
      peer_levels_sample: feesWithPeers.slice(0, 10),
      memory_stored: stored,
      dry_run: Boolean(options.dryRun),
      provider_call_queued: false,
    },
  };
}
