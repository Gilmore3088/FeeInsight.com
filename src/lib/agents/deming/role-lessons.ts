import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Deming's role lessons: how to measure the pipeline better, each from an issue whose root cause
 * was here. A PR that closes such an issue adds its lesson in the same PR (AGENTS.md, "How work
 * runs"). Deming's steps run under Atlas's name and `agent_registry` has no `deming` row, so the
 * lesson sync skips these and says so; the steps still read them.
 */
export const DEMING_LESSONS: AgentLesson[] = [
  {
    id: "pr-2119-bound-not-point",
    agent: "deming",
    stage: "accuracy audit",
    lesson: "Call the stored-copy accuracy target met only when the unrounded 95% Wilson lower bound reaches it over at least 3,400 unique scorable fees from one checker series; below that the status is insufficient. Count each published fee once (its newest verdict) and each daily draw once, pool only one checker series, and never judge a change across a change of series.",
    why: "The automated stored-copy audit pooled rolling events across retries and checker versions and declared its 99.5% target met from a point estimate, so a scoring change could look like a data improvement.",
    evidence: { issues: [2071], prs: [2119], files: ["docs/project/findings/2026-10-19-audit-confidence-history.md", "src/lib/agents/deming/accuracy-measure.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "issue-2466-reference-binding",
    agent: "deming",
    stage: "answer-key eligibility",
    lesson: "Before trusting a fail-closed measurement gate, count how many real keys it admits; a gate that admits none measures nothing. Bind a reference to what stays stable for its kind (PDF bytes, an HTML page's extracted main text and the key's own lines), ask for a consumer heading only where a schedule has a business section to separate, count discovery incomplete only for an unvisited link that could be a newer fee schedule, and clear a stored hash whenever the reference URL changes.",
    why: "The first eligibility run admitted 0 of 62 confirmed keys: HTML pages changed bytes on every fetch, schedules with no consumer heading were always unproven, any unvisited navigation hub made discovery incomplete, and a key whose URL was edited kept the old document's hash.",
    evidence: { issues: [2466], prs: [2468], files: ["docs/project/findings/2026-10-20-answer-key-eligibility-admits-none.md", "src/lib/data-store/answer-key-eligibility.ts"] },
    appliesTo: "all",
    since: "2026-10-20",
  },
];
