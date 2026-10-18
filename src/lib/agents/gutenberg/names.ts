import { registryLedgerAgent } from "@/lib/agents/hoovie/names";

/**
 * Gutenberg is the internal agent that keeps the live fee catalog (#1075; DECISIONS, Oct 12): it
 * takes Darwin-verified fees, decides which go live, and keeps them correct. Hamilton becomes the
 * product only.
 *
 * The move is in steps (#1075 "Order"). Step 1: every reader of publisher work accepts both agent
 * names, so the rows Hamilton wrote before the switch and the rows Gutenberg writes after it are
 * read the same way. Step 2: every writer of publisher work (runs, steps, `pipeline_feedback`
 * reports) writes `gutenberg`. Persisted `hamilton.*` check names never change (they are matched
 * by exact value), and older rows keep the name `hamilton`.
 */
export const GUTENBERG_AGENT = "gutenberg" as const;

/** The agent names publisher rows carry: Hamilton's before step 2 of #1075, Gutenberg's after it. */
export const PUBLISHER_AGENT_NAMES: readonly string[] = ["hamilton", GUTENBERG_AGENT];

/** Whether an agent name belongs to the publisher, under either name. Pure. */
export function isPublisherAgent(agentName: string | null | undefined): boolean {
  return agentName != null && PUBLISHER_AGENT_NAMES.includes(agentName);
}

/**
 * The step keys that are publisher work, owned by Gutenberg from #1075 step 2. Every other
 * `hamilton` step (Pro asks, studies, briefings, alerts, report runs, answer evals) is the product's.
 */
export const PUBLISHER_STEP_KEYS: readonly string[] = [
  "publish",
  "publish-index",
  "publish-context",
  "category-guard",
  "frequency-fill",
  "source-link-repair",
  "public-diagnose",
];

/**
 * The agent a ledger row belongs to today. A publisher step written under Hamilton's name
 * before the switch counts as Gutenberg's, so a reader that groups history by agent shows the
 * publisher's work in one place across the switch. Likewise a registry step written under
 * Magellan's name before #1865 counts as Hoovie's (`registryLedgerAgent`). Pure.
 */
export function ledgerAgent(agentName: string, stepKey: string | null | undefined): string {
  if (agentName === "hamilton" && stepKey != null && PUBLISHER_STEP_KEYS.includes(stepKey)) return GUTENBERG_AGENT;
  return registryLedgerAgent(agentName, stepKey);
}
