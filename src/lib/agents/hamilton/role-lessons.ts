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
    lesson: "The institution briefing Hamilton is given is evidence, like a tool result: a figure taken correctly from the briefing is supported, and the answer check must read the briefing too.",
    why: "The written-answer check was passed only tool results, so a correct Navy Federal answer built from the briefing's fee-income figures was withheld as unsupported.",
    evidence: { issues: [2327], prs: [2337], files: ["src/lib/hamilton/written-answer-read.ts"] },
    appliesTo: ["written-answer"],
    since: "2026-10-19",
  },
];
