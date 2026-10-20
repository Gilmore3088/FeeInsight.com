import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Rosetta's role lessons: how to turn documents into text better, each from an issue whose root
 * cause was here. A PR that closes such an issue adds its lesson in the same PR (AGENTS.md, "How
 * work runs").
 */
export const ROSETTA_LESSONS: AgentLesson[] = [
  {
    id: "issue-2325",
    agent: "rosetta",
    stage: "paid read",
    lesson: "Only a reply the model finished, or one cut off at its length limit that still passes the content checks, is usable text; a refusal, pause or unknown finish is not a read. A reply whose cost cannot be read has an unknown cost, never $0.",
    why: "Refusal, pause, missing and unknown finishes reached the completed-text writers, and omitted or malformed usage became a zero cost estimate.",
    evidence: { issues: [2325], prs: [2339], files: ["src/lib/agents/rosetta/paid-read.ts"] },
    appliesTo: ["read-paid"],
    since: "2026-10-19",
  },
];
