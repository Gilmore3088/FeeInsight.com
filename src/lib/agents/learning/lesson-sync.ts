import type { sql } from "@/lib/data-store/connection";
import { ALL_AGENT_LESSONS } from "./lesson-registry";
import type { AgentLesson } from "./lesson-types";

type SqlTag = typeof sql;

/**
 * `atlas-lesson-sync`, a deterministic step in Atlas's daily scoreboard run (no model calls). It
 * copies the repo's role lessons (`lesson-registry.ts`) into `agent_lessons`, upserting on
 * (agent_name, lesson_name). A lesson removed from the repo is retired, never deleted: its
 * `superseded_by` points at its own `lesson_id` (retired with no successor). Only rows this sync
 * wrote (`evidence_refs.source = 'repo'`) are ever retired. A lesson whose agent has no
 * `agent_registry` row is skipped and reported (the table's foreign key would refuse it).
 */

export const LESSON_SYNC_STEP_KEY = "atlas-lesson-sync";
export const LESSON_SOURCE = "repo";

export interface LessonSyncResult {
  ready: boolean;
  dryRun: boolean;
  repoLessons: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** "agent:lesson" keys retired this run because the repo no longer has them. */
  superseded: string[];
  /** Agents with lessons but no agent_registry row, and how many lessons each had. */
  skippedAgents: Array<{ agent: string; lessons: number }>;
  perAgent: Record<string, number>;
}

/** What one lesson stores in `evidence_refs`. */
export function lessonEvidenceRefs(lesson: AgentLesson): Record<string, unknown> {
  return {
    source: LESSON_SOURCE,
    stage: lesson.stage,
    why: lesson.why,
    applies_to: lesson.appliesTo,
    since: lesson.since,
    issues: lesson.evidence.issues,
    prs: lesson.evidence.prs,
    files: lesson.evidence.files,
  };
}

export async function agentLessonsReady(db: SqlTag): Promise<boolean> {
  const [row] = await db`
    SELECT to_regclass('public.agent_lessons') IS NOT NULL
       AND to_regclass('public.agent_registry') IS NOT NULL AS ready
  `;
  return row?.ready === true;
}

export async function syncAgentLessons({
  db,
  dryRun = false,
  lessons = ALL_AGENT_LESSONS,
}: {
  db: SqlTag;
  dryRun?: boolean;
  lessons?: readonly AgentLesson[];
}): Promise<LessonSyncResult> {
  const result: LessonSyncResult = {
    ready: false, dryRun, repoLessons: lessons.length, inserted: 0, updated: 0, unchanged: 0,
    superseded: [], skippedAgents: [], perAgent: {},
  };
  if (!(await agentLessonsReady(db))) return result;
  result.ready = true;

  const agents = [...new Set(lessons.map((lesson) => lesson.agent))];
  const registeredRows = agents.length
    ? await db`SELECT agent_name FROM agent_registry WHERE agent_name = ANY(${agents}::text[])`
    : [];
  const registered = new Set(registeredRows.map((row) => String(row.agent_name)));
  for (const agent of agents) {
    const count = lessons.filter((lesson) => lesson.agent === agent).length;
    if (registered.has(agent)) result.perAgent[agent] = count;
    else result.skippedAgents.push({ agent, lessons: count });
  }
  const synced = lessons.filter((lesson) => registered.has(lesson.agent));
  const keys = synced.map((lesson) => `${lesson.agent}:${lesson.id}`);

  if (dryRun) {
    const retired = await db`
      SELECT agent_name, lesson_name FROM agent_lessons
       WHERE evidence_refs->>'source' = ${LESSON_SOURCE} AND superseded_by IS NULL
         AND NOT ((agent_name || ':' || lesson_name) = ANY(${keys}::text[]))
    `;
    result.superseded = retired.map((row) => `${row.agent_name}:${row.lesson_name}`);
    return result;
  }

  for (const lesson of synced) {
    const rows = await db`
      INSERT INTO agent_lessons (agent_name, lesson_name, description, evidence_refs)
      VALUES (${lesson.agent}, ${lesson.id}, ${lesson.lesson}, ${JSON.stringify(lessonEvidenceRefs(lesson))}::jsonb)
      ON CONFLICT (agent_name, lesson_name) DO UPDATE
         SET description = EXCLUDED.description,
             evidence_refs = EXCLUDED.evidence_refs,
             superseded_by = NULL
       WHERE agent_lessons.description IS DISTINCT FROM EXCLUDED.description
          OR agent_lessons.evidence_refs IS DISTINCT FROM EXCLUDED.evidence_refs
          OR agent_lessons.superseded_by IS NOT NULL
      RETURNING (xmax = 0) AS inserted
    `;
    if (rows.length === 0) result.unchanged += 1;
    else if (rows[0].inserted === true) result.inserted += 1;
    else result.updated += 1;
  }

  const retired = await db`
    UPDATE agent_lessons SET superseded_by = lesson_id
     WHERE evidence_refs->>'source' = ${LESSON_SOURCE} AND superseded_by IS NULL
       AND NOT ((agent_name || ':' || lesson_name) = ANY(${keys}::text[]))
    RETURNING agent_name, lesson_name
  `;
  result.superseded = retired.map((row) => `${row.agent_name}:${row.lesson_name}`);
  return result;
}

export function summarizeLessonSync(result: LessonSyncResult): string {
  if (!result.ready) return "Skipped the lesson sync: agent_lessons or agent_registry is not there.";
  const skipped = result.skippedAgents.filter((entry) => entry.lessons > 0);
  const skippedLine = skipped.length
    ? ` Skipped ${skipped.map((entry) => `${entry.lessons} for ${entry.agent}`).join(", ")} (no agent_registry row).`
    : "";
  if (result.dryRun) {
    return `Dry run: would sync ${result.repoLessons - skipped.reduce((sum, entry) => sum + entry.lessons, 0)} role lessons and retire ${result.superseded.length}; nothing written.${skippedLine}`;
  }
  return `Synced the agents' role lessons: ${result.inserted} new, ${result.updated} updated, ${result.unchanged} unchanged, ${result.superseded.length} retired.${skippedLine}`;
}

export function lessonSyncDetail(result: LessonSyncResult): Record<string, unknown> {
  return {
    ready: result.ready,
    dry_run: result.dryRun,
    repo_lessons: result.repoLessons,
    inserted: result.inserted,
    updated: result.updated,
    unchanged: result.unchanged,
    superseded: result.superseded,
    skipped_agents: result.skippedAgents,
    per_agent: result.perAgent,
  };
}

export interface StoredLesson {
  id: string;
  lesson: string;
  why: string | null;
  stage: string | null;
  since: string | null;
  issues: number[];
  prs: number[];
  files: string[];
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}

/** An agent's active lessons from `agent_lessons`, newest first. Null when the table is not there. */
export async function readAgentLessons(db: SqlTag, agent: string, limit = 20): Promise<StoredLesson[] | null> {
  if (!(await agentLessonsReady(db))) return null;
  const rows = await db`
    SELECT lesson_name, description, evidence_refs, created_at
      FROM agent_lessons
     WHERE agent_name = ${agent} AND superseded_by IS NULL
     ORDER BY COALESCE(evidence_refs->>'since', to_char(created_at, 'YYYY-MM-DD')) DESC, lesson_name DESC
     LIMIT ${limit}
  `;
  return rows.map((row) => {
    const refs = (typeof row.evidence_refs === "string" ? JSON.parse(row.evidence_refs) : row.evidence_refs ?? {}) as Record<string, unknown>;
    const plain = refs && !Array.isArray(refs) ? refs : {};
    return {
      id: String(row.lesson_name),
      lesson: String(row.description ?? ""),
      why: typeof plain.why === "string" ? plain.why : null,
      stage: typeof plain.stage === "string" ? plain.stage : null,
      since: typeof plain.since === "string" ? plain.since : row.created_at instanceof Date ? row.created_at.toISOString().slice(0, 10) : null,
      issues: numbers(plain.issues),
      prs: numbers(plain.prs),
      files: Array.isArray(plain.files) ? plain.files.map(String) : [],
    };
  });
}
