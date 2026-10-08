/**
 * Growth's roster and the kinds of item its queue (`content_drafts`) holds. The names are
 * the marketing agents in `growth-os/agents/*.md`; each one files its drafts and PRs under
 * the run-ledger agent `growth`, and the queue row names which of them made it.
 */

/** The marketing agents (`growth-os/agents/<name>.md`). */
export const GROWTH_AGENTS = ["carnegie", "draper", "edison", "ernest", "murrow", "nielsen", "norman", "sherlock"] as const;
export type GrowthAgent = (typeof GROWTH_AGENTS)[number];

/**
 * What a queue item is. Fixed so the approval page and the weekly scoring know how to read
 * each one; add a kind here (and to `channelForKind` and the scoring) before an agent files it.
 */
export const QUEUE_KINDS = [
  "linkedin_post",
  "article",
  "email",
  "outreach_email",
  "pull_request",
  "brief",
  "plan",
  "pitch",
  "note",
] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export function isGrowthAgent(value: unknown): value is GrowthAgent {
  return typeof value === "string" && (GROWTH_AGENTS as readonly string[]).includes(value);
}

export function isQueueKind(value: unknown): value is QueueKind {
  return typeof value === "string" && (QUEUE_KINDS as readonly string[]).includes(value);
}

/** The `content_drafts.channel` an item of this kind goes out on (or `internal` for James only). */
export function channelForKind(kind: QueueKind): string {
  switch (kind) {
    case "linkedin_post":
      return "linkedin";
    case "email":
    case "outreach_email":
    case "pitch":
      return "email";
    case "pull_request":
      return "github";
    case "article":
      return "site";
    default:
      return "internal";
  }
}
