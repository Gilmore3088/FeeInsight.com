import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Hamilton's role lessons: how to analyse and answer better, each from an issue whose root cause
 * was here. `written-answer` is Hamilton's written answer (`hamilton/written-answer-read.ts`),
 * which adds these to its instructions. A PR that closes such an issue adds its lesson in the same
 * PR (AGENTS.md, "How work runs").
 */
export const HAMILTON_LESSONS: AgentLesson[] = [
  {
    id: "issue-2190",
    agent: "hamilton",
    stage: "analysis",
    lesson: "Every count and median Hamilton shows reads active institutions only; an institution the regulator lists as inactive is left out of every reader, not just the headline figure.",
    why: "State market medians, the directory's per-state counts and several other public readers counted every institution, including inactive ones, beside figures that did filter.",
    evidence: { issues: [2190], prs: [2172, 2390], files: ["src/lib/data-store/fee-stats.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "issue-2373",
    agent: "hamilton",
    stage: "written answer",
    lesson: "When a coverage count could not be read, say it is unknown; never state zero observations, categories or institutions from a failed lookup.",
    why: "An optional published-fee count query timed out, getPublicStats returned zeros, and the cached zeros let Hamilton's instructions claim zero coverage for ten minutes.",
    evidence: { issues: [2373], prs: [2353], files: ["src/lib/public-stats.ts"] },
    appliesTo: ["written-answer"],
    since: "2026-10-19",
  },
  {
    id: "issue-2327",
    agent: "hamilton",
    stage: "written answer",
    lesson: "The institution briefing you are given is evidence, like a tool result: a figure taken correctly from it is supported, so use it and cite it as you would a tool result.",
    why: "The written-answer check was passed only tool results, so a correct Navy Federal answer built from the briefing's fee-income figures was withheld as unsupported.",
    evidence: { issues: [2327], prs: [2337], files: ["src/lib/hamilton/written-answer-read.ts"] },
    appliesTo: ["written-answer"],
    since: "2026-10-19",
  },
  {
    id: "restore-name-first",
    agent: "hamilton",
    stage: "source check",
    lesson: "Put a taken-down fee back live on its stored line only when that line reads name first and its name does not say free; a line that opens on a price may carry the row above's price.",
    why: "The lost-read restore trusted the stored line alone, and in a sample of 20 of its 159 restores 4 lines opened on a price (\"$30 Replacement Credit Card Rush | $25 Replace Key\") and one was \"Notary Fee Free for members\" at the $5 non-member price.",
    evidence: { issues: [978], prs: [], files: ["src/lib/agents/hamilton/source-check.ts"] },
    appliesTo: ["publish", "publish-index", "publish-context"],
    since: "2026-10-20",
  },
  {
    id: "product-page-same-item",
    agent: "hamilton",
    stage: "product-page conflict",
    lesson: "A product page conflicts with the schedule only when the schedule prices the same item at another price; a different item in the same category, or a premium tier's own page, is not a conflict.",
    why: "The conflict check compared by category alone, so 12 of 20 sampled takedowns were a returned-item fee against a bill-pay NSF line, or a tier page against the standard schedule.",
    evidence: { issues: [978], prs: [2440], files: ["src/lib/agents/hamilton/product-page-conflict.ts"] },
    appliesTo: ["publish", "publish-index", "publish-context"],
    since: "2026-10-20",
  },
];
