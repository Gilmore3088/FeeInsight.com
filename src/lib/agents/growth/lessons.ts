import type { sql } from "@/lib/data-store/connection";
import type { ContentDraft } from "@/lib/data-store/content-drafts";
import { feedbackSchemaReady, recordFeedback } from "@/lib/agents/learning/feedback";

type SqlTag = typeof sql;

/**
 * Skip reasons become lessons (growth-os BUILD-PLAN 1.13). When James skips a queue item and
 * says why, the reason is written to the shared learning store (`pipeline_feedback`) as a
 * `wrong` judgement by growth about stage `marketing`, keyed to the agent that drafted it
 * (`about_strategy` = the queue row's agent). `recentLessons` reads them back so that agent's
 * next brief carries them: the weekly content run leaves a skipped subject out of its next
 * drafts for the lesson window and lists the lessons in its step result, and a
 * scheduled session reads them from `GET /api/admin/growth/intake?agent=<name>`.
 *
 * Sending a skipped item back to review marks its lesson `restored`, so it drops out of the
 * briefs; skipping it again with a reason makes it a lesson again.
 */

export const SKIP_LESSON_KIND = "skipped_by_james";
export const SKIP_LESSON_CHECK = "growth.skip_reason";
/** How far back a brief looks, and how many lessons it carries. */
export const LESSON_WINDOW_DAYS = 90;
export const LESSON_LIMIT = 10;

export function skipLessonKey(draftId: number): string {
  return `growth.skip:draft:${draftId}`;
}

export interface GrowthLesson {
  draftId: number;
  agent: string;
  kind: string;
  workflow: string | null;
  /** The skipped draft's subject (a metro, fee and metro, or slug), so its writer can leave it out. */
  subjectKey: string | null;
  title: string;
  reason: string;
  /** When James skipped it (the lesson's last write). */
  at: string;
}

/** Writes the lesson for a skip. A skip without a reason teaches nothing and writes nothing. */
export async function recordSkipLesson(db: SqlTag, draft: ContentDraft, reason: string | null | undefined): Promise<number> {
  const text = (reason ?? "").trim();
  if (!text) return 0;
  if (!(await feedbackSchemaReady(db))) return 0;
  return recordFeedback(db, [
    {
      aboutStage: "marketing",
      aboutStrategy: draft.agent,
      signal: "wrong",
      kind: SKIP_LESSON_KIND,
      reportedBy: "growth",
      checkName: SKIP_LESSON_CHECK,
      evidence: {
        draft_id: draft.id,
        agent: draft.agent,
        kind: draft.kind,
        workflow: draft.workflow,
        subject_key: draft.subjectKey,
        title: draft.title,
        reason: text,
      },
      runId: draft.agentRunId,
      dedupeKey: skipLessonKey(draft.id),
    },
  ]);
}

/** A skipped item sent back to review: its lesson no longer holds. */
export async function withdrawSkipLesson(db: SqlTag, draftId: number): Promise<void> {
  if (!(await feedbackSchemaReady(db))) return;
  await db`
    UPDATE pipeline_feedback SET signal = 'restored', updated_at = NOW()
     WHERE dedupe_key = ${skipLessonKey(draftId)} AND signal = 'wrong'
  `;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? "");
}

/** The agent's standing lessons, newest first. Empty before `pipeline_feedback` exists. */
export async function recentLessons(
  db: SqlTag,
  agent: string,
  options: { days?: number; limit?: number } = {},
): Promise<GrowthLesson[]> {
  if (!(await feedbackSchemaReady(db))) return [];
  const rows = await db`
    SELECT evidence, updated_at
      FROM pipeline_feedback
     WHERE reported_by = 'growth' AND about_stage = 'marketing' AND about_strategy = ${agent}
       AND kind = ${SKIP_LESSON_KIND} AND signal = 'wrong'
       AND updated_at >= NOW() - make_interval(days => ${options.days ?? LESSON_WINDOW_DAYS}::int)
     ORDER BY updated_at DESC, id DESC
     LIMIT ${options.limit ?? LESSON_LIMIT}
  `;
  return rows.map((row) => {
    const evidence = (typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence ?? {}) as Record<string, unknown>;
    return {
      draftId: Number(evidence.draft_id),
      agent: String(evidence.agent ?? agent),
      kind: String(evidence.kind ?? ""),
      workflow: evidence.workflow ? String(evidence.workflow) : null,
      subjectKey: evidence.subject_key ? String(evidence.subject_key) : null,
      title: String(evidence.title ?? ""),
      reason: String(evidence.reason ?? ""),
      at: iso(row.updated_at),
    };
  });
}

/** Subjects James skipped, with a reason, in one workflow: its writer leaves them out for the lesson window. */
export function skippedSubjects(lessons: GrowthLesson[], workflow: string): Set<string> {
  return new Set(lessons.filter((lesson) => lesson.workflow === workflow && lesson.subjectKey).map((lesson) => lesson.subjectKey!));
}

/** One line for a step summary: how many lessons the brief carried. */
export function lessonsLine(lessons: GrowthLesson[]): string {
  if (!lessons.length) return "";
  return lessons.length === 1 ? "Read 1 lesson from a skipped draft." : `Read ${lessons.length} lessons from skipped drafts.`;
}

/** The lessons as brief lines, e.g. for a session prompt: `- "<title>" skipped: <reason>`. */
export function lessonsBrief(lessons: GrowthLesson[]): string[] {
  return lessons.map((lesson) => `- "${lesson.title}" skipped: ${lesson.reason}`);
}
