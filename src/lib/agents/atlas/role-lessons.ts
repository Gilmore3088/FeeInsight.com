import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Atlas's role lessons: how to run the crew better, each from an issue whose root cause was here.
 * A PR that closes such an issue adds its lesson in the same PR (AGENTS.md, "How work runs").
 */
export const ATLAS_LESSONS: AgentLesson[] = [
  {
    id: "issue-2198",
    agent: "atlas",
    stage: "scheduling",
    lesson: "A capped optional paid pass is skipped with a receipt and its lane carries on with its free steps; a budget limit never strands deterministic work.",
    why: "Queue selection excluded any lane whose next step was a paid pass while paid steps were not allowed, so the executor's skip was unreachable and three stalled lanes could fill every active lane slot.",
    evidence: { issues: [2198], prs: [2208], files: ["src/lib/agents/run-store.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "issue-2206",
    agent: "atlas",
    stage: "daily brief",
    lesson: "The brief's headline count matches the problems it lists, and each problem names its error, owner, next action and link; an empty check is never reported as a successful load.",
    why: "The brief headlined the needs-you count and then added health and storage warnings outside it, printed only alert titles, and counted empty checks as successes.",
    evidence: { issues: [2206], prs: [2251, 2267], files: ["src/lib/agents/daily-brief.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
];
