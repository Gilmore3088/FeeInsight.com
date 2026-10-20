/**
 * Role lessons (James, 2026-10-20: "I don't want a check, I want a lesson for the agents so they get
 * better at their roles"). A lesson is one or two plain sentences on how an agent should do its job
 * differently, taken from an issue whose root cause was in that agent. Lessons are reviewed code:
 * each agent keeps them in `src/lib/agents/<agent>/role-lessons.ts`, `lesson-registry.ts` gathers
 * them, the daily `atlas-lesson-sync` step copies them into `agent_lessons`, and every run reads
 * them (`lesson-reader.ts`). `scripts/ci-guards.sh lesson-kill` checks the files.
 */

/** The pipeline agents that keep role lessons. Each has `src/lib/agents/<agent>/role-lessons.ts`. */
export const LESSON_AGENTS = ["atlas", "magellan", "hoovie", "rosetta", "knox", "darwin", "gutenberg", "hamilton", "deming"] as const;

export type LessonAgent = (typeof LESSON_AGENTS)[number];

export interface AgentLesson {
  /** Unique across all agents, e.g. "issue-2306" (a second lesson from one issue adds a suffix). */
  id: string;
  agent: LessonAgent;
  /** The part of the role it is about, e.g. "extract", "verify", "registry load". */
  stage: string;
  /** One or two plain sentences: how the agent should do its role differently. */
  lesson: string;
  /** The root cause the issue found. */
  why: string;
  evidence: { issues: number[]; prs: number[]; files: string[] };
  /** The step keys it shapes, or "all" for every step the agent owns. */
  appliesTo: readonly string[] | "all";
  /** The date the lesson was learned (the issue's close or the fix's merge), YYYY-MM-DD. */
  since: string;
}
