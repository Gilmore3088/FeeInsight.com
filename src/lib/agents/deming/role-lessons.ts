import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Deming's role lessons: how to measure the pipeline better, each from an issue whose root cause
 * was here. A PR that closes such an issue adds its lesson in the same PR (AGENTS.md, "How work
 * runs"). Deming's steps run under Atlas's name and `agent_registry` has no `deming` row, so the
 * lesson sync skips these and says so; the steps still read them. None yet.
 */
export const DEMING_LESSONS: AgentLesson[] = [];
