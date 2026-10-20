/**
 * Hoovie is the internal agent that owns public data: the registry loaders (`registry-*` steps)
 * that pull regulator, government and survey datasets (#1865; agent_registry row in
 * 20270110000061_hoovie_agent.sql; DECISIONS, Oct 17). Internal name only: it never appears on a
 * customer screen.
 *
 * Registry runs used to be written under Magellan's name. New runs and steps carry `hoovie`; older
 * rows keep `magellan` (they are never relabelled, which would be a prod write). So every reader
 * that groups ledger rows by agent treats a `registry-*` step written under Magellan's name as
 * Hoovie's, and Magellan keeps only fee-schedule work. The run marker `params_json.source =
 * 'magellan.registry'` (`REGISTRY_RUN_SOURCE`) is unchanged, so the registry tick finds old and new
 * runs alike.
 */
export const HOOVIE_AGENT = "hoovie" as const;

/** Every registry step key starts with this (`REGISTRY_STEP_PREFIX` in magellan/registry). */
export const REGISTRY_STEP_KEY_PREFIX = "registry-";

/** The agent names registry rows carry: Magellan's before #1865, Hoovie's after it. */
export const REGISTRY_AGENT_NAMES: readonly string[] = ["magellan", HOOVIE_AGENT];

/** Whether a step key is registry (public data) work. Pure. */
export function isRegistryStep(stepKey: string | null | undefined): boolean {
  return stepKey != null && stepKey.startsWith(REGISTRY_STEP_KEY_PREFIX);
}

/**
 * The agent a ledger row belongs to today, for registry work: a `registry-*` step written under
 * Magellan's name before #1865 is Hoovie's. Any other row keeps its own name. Pure.
 */
export function registryLedgerAgent(agentName: string, stepKey: string | null | undefined): string {
  return agentName === "magellan" && isRegistryStep(stepKey) ? HOOVIE_AGENT : agentName;
}

/**
 * The raw agent names whose rows can belong to `agent` today: Hoovie reads both registry names,
 * every other agent its own. Pair it with the step-key test (`registryLedgerAgent` or the SQL CASE)
 * so Magellan's own reads leave older registry steps out.
 */
export function registryLedgerNames(agent: string): string[] {
  return agent === HOOVIE_AGENT ? [...REGISTRY_AGENT_NAMES] : [agent];
}
