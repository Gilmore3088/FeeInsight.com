import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Gutenberg's role lessons: how to keep the live fee catalog better, each from an issue whose root
 * cause was in publishing. A PR that closes such an issue adds its lesson in the same PR
 * (AGENTS.md, "How work runs").
 */
export const GUTENBERG_LESSONS: AgentLesson[] = [
  {
    id: "issue-2356",
    agent: "gutenberg",
    stage: "publish",
    lesson: "Check that the verified row chosen for publishing is still the current one before any early exit on its category; a caller holding an older snapshot defers instead of writing.",
    why: "In the international publication adapter the non-international category exit came before the snapshot check, so a caller holding the prior international row reached its ordinary write after the verified category had changed to domestic.",
    evidence: { issues: [2356], prs: [2386], files: ["src/lib/agents/knox/international-wire-scope.db.test.ts"] },
    appliesTo: ["publish", "publish-sweeps"],
    since: "2026-10-19",
  },
];
