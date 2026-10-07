/**
 * The content queue (content_drafts): posts the content workflows draft for James to
 * approve, edit or skip. Nothing here posts anywhere; "posted" is set by hand after
 * James posts an approved draft himself.
 */

import { sql } from "./connection";

type SqlTag = typeof sql;

export type ContentDraftStatus = "draft" | "approved" | "skipped" | "posted";
export const CONTENT_DRAFT_STATUSES: readonly ContentDraftStatus[] = ["draft", "approved", "skipped", "posted"];

export interface ContentDraft {
  id: number;
  workflow: string;
  channel: string;
  subjectKey: string;
  title: string;
  caption: string;
  facts: Record<string, unknown>;
  asOf: string;
  status: ContentDraftStatus;
  agentRunId: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  postedAt: string | null;
  createdAt: string;
}

export interface NewContentDraft {
  workflow: string;
  channel?: string;
  subjectKey: string;
  title: string;
  caption: string;
  facts: Record<string, unknown>;
  asOf: Date;
  agentRunId: number | null;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toDraft(row: Record<string, unknown>): ContentDraft {
  return {
    id: Number(row.id),
    workflow: String(row.workflow),
    channel: String(row.channel),
    subjectKey: String(row.subject_key),
    title: String(row.title),
    caption: String(row.caption),
    facts: (typeof row.facts === "string" ? JSON.parse(row.facts) : row.facts ?? {}) as Record<string, unknown>,
    asOf: iso(row.as_of) ?? "",
    status: String(row.status) as ContentDraftStatus,
    agentRunId: row.agent_run_id === null || row.agent_run_id === undefined ? null : Number(row.agent_run_id),
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: iso(row.reviewed_at),
    postedAt: iso(row.posted_at),
    createdAt: iso(row.created_at) ?? "",
  };
}

export async function contentSchemaReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db`SELECT to_regclass('public.content_drafts') IS NOT NULL AS ready`;
  return row?.ready === true;
}

export async function insertContentDraft(draft: NewContentDraft, db: SqlTag = sql): Promise<number> {
  const [row] = await db`
    INSERT INTO content_drafts (workflow, channel, subject_key, title, caption, facts, as_of, agent_run_id)
    VALUES (${draft.workflow}, ${draft.channel ?? "linkedin"}, ${draft.subjectKey}, ${draft.title}, ${draft.caption},
            ${JSON.stringify(draft.facts)}::jsonb, ${draft.asOf.toISOString()}, ${draft.agentRunId})
    RETURNING id
  `;
  return Number(row.id);
}

/** Subjects a workflow drafted in the last `days` days, skipped ones included, so a skip isn't re-proposed next week. */
export async function recentSubjects(workflow: string, days: number, db: SqlTag = sql): Promise<Set<string>> {
  const rows = await db`
    SELECT DISTINCT subject_key FROM content_drafts
     WHERE workflow = ${workflow} AND created_at >= now() - make_interval(days => ${days}::int)
  `;
  return new Set(rows.map((row) => String(row.subject_key)));
}

export async function listContentDrafts(limit = 60, db: SqlTag = sql): Promise<ContentDraft[]> {
  const rows = await db`SELECT * FROM content_drafts ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
  return rows.map((row) => toDraft(row as Record<string, unknown>));
}

export async function getContentDraft(id: number, db: SqlTag = sql): Promise<ContentDraft | null> {
  const [row] = await db`SELECT * FROM content_drafts WHERE id = ${id}`;
  return row ? toDraft(row as Record<string, unknown>) : null;
}

export async function setContentDraftStatus(id: number, status: ContentDraftStatus, reviewer: string, db: SqlTag = sql): Promise<void> {
  await db`
    UPDATE content_drafts
       SET status = ${status},
           reviewed_by = ${reviewer},
           reviewed_at = now(),
           posted_at = CASE WHEN ${status} = 'posted' THEN now() ELSE posted_at END
     WHERE id = ${id}
  `;
}

export async function updateContentDraftCaption(id: number, caption: string, reviewer: string, db: SqlTag = sql): Promise<void> {
  await db`
    UPDATE content_drafts SET caption = ${caption}, reviewed_by = ${reviewer}, reviewed_at = now()
     WHERE id = ${id} AND status IN ('draft', 'approved')
  `;
}
