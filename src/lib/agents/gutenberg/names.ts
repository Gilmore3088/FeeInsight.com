/**
 * Gutenberg is the internal agent that keeps the live fee catalog (#1075; DECISIONS, Oct 12): it
 * takes Darwin-verified fees, decides which go live, and keeps them correct. Hamilton becomes the
 * product only.
 *
 * The move is in steps (#1075 "Order"). Step 1 (this file): every reader of publisher work accepts
 * both agent names, so the rows Hamilton wrote before the switch and the rows Gutenberg writes
 * after it are read the same way. Nothing writes the name `gutenberg` yet; step 2 switches the
 * writers. Persisted `hamilton.*` check names never change (they are matched by exact value).
 */
export const GUTENBERG_AGENT = "gutenberg" as const;

/** The agent names publisher rows carry: Hamilton's until step 2 of #1075, Gutenberg's after it. */
export const PUBLISHER_AGENT_NAMES: readonly string[] = ["hamilton", GUTENBERG_AGENT];

/** Whether an agent name belongs to the publisher, under either name. Pure. */
export function isPublisherAgent(agentName: string | null | undefined): boolean {
  return agentName != null && PUBLISHER_AGENT_NAMES.includes(agentName);
}
