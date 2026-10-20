import { STEP_OWNER } from "@/lib/agents/narrate";
import { ALL_AGENT_LESSONS } from "./lesson-registry";
import { LESSON_AGENTS, type AgentLesson, type LessonAgent } from "./lesson-types";

/**
 * The reader every run uses: which of an agent's role lessons shape a step, and the block of
 * instructions a model-calling step adds to its request. Lessons come from the repo (reviewed
 * code), so a run never waits on the database to know them; `agent_lessons` is their mirror for
 * the admin pages and history (`lesson-sync.ts`).
 */

/** Most lessons one model request carries, newest first. */
export const PROMPT_LESSON_LIMIT = 10;

function isLessonAgent(name: string | null | undefined): name is LessonAgent {
  return name != null && (LESSON_AGENTS as readonly string[]).includes(name);
}

/**
 * The agent whose lessons shape a step. Deming's checks run under Atlas's name; publish steps
 * recorded under Hamilton's name are Gutenberg's, and registry steps under Magellan's are Hoovie's
 * (`STEP_OWNER`). Null for an agent that keeps no role lessons (Growth).
 */
export function lessonAgentForStep(agentName: string | null | undefined, stepKey: string | null | undefined): LessonAgent | null {
  if (stepKey?.startsWith("deming-")) return "deming";
  const owner = (stepKey ? STEP_OWNER[stepKey] : undefined) ?? agentName ?? null;
  return isLessonAgent(owner) ? owner : null;
}

function newestFirst(a: AgentLesson, b: AgentLesson): number {
  return b.since.localeCompare(a.since) || b.id.localeCompare(a.id);
}

/** The agent's lessons that apply to this step, newest first. Pure. */
export function lessonsFor(agent: string, stepKey: string, lessons: readonly AgentLesson[] = ALL_AGENT_LESSONS): AgentLesson[] {
  return lessons
    .filter((lesson) => lesson.agent === agent && (lesson.appliesTo === "all" || lesson.appliesTo.includes(stepKey)))
    .sort(newestFirst);
}

/** The lessons that shape a ledger step, by its recorded agent and key. Pure. */
export function lessonsForStep(agentName: string | null | undefined, stepKey: string, lessons: readonly AgentLesson[] = ALL_AGENT_LESSONS): AgentLesson[] {
  const agent = lessonAgentForStep(agentName, stepKey);
  return agent ? lessonsFor(agent, stepKey, lessons) : [];
}

/** Ids for a step's `lessons_applied` detail. */
export function lessonIds(lessons: readonly AgentLesson[]): string[] {
  return lessons.map((lesson) => lesson.id);
}

/**
 * The instructions block for a model request: at most `limit` lessons, newest first. Empty when
 * there are none, so a request without lessons is unchanged.
 */
export function lessonsPromptBlock(lessons: readonly AgentLesson[], limit = PROMPT_LESSON_LIMIT): string {
  const used = [...lessons].sort(newestFirst).slice(0, limit);
  if (used.length === 0) return "";
  return [
    "LESSONS FOR YOUR ROLE",
    "Each lesson below comes from a confirmed mistake in this role. Apply them in this task; they never override the source text or the output format asked for.",
    ...used.map((lesson) => `- [${lesson.id}] ${lesson.lesson}`),
  ].join("\n");
}

/**
 * What a model-calling step sends and records: the `system` text (absent when there are no
 * lessons) and the ids it carried, for `lessons_applied`.
 */
export function lessonsForModel(agent: LessonAgent, stepKey: string, lessons: readonly AgentLesson[] = ALL_AGENT_LESSONS): { system?: string; lessonIds: string[] } {
  const applied = lessonsFor(agent, stepKey, lessons).slice(0, PROMPT_LESSON_LIMIT);
  const system = lessonsPromptBlock(applied);
  return system ? { system, lessonIds: lessonIds(applied) } : { lessonIds: [] };
}
