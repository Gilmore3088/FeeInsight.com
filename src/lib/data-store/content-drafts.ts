/**
 * The content queue (content_drafts): posts the content workflows draft for James to
 * approve, edit or skip. Nothing here posts anywhere; "posted" is set by hand after
 * James posts an approved draft himself. Since migration 20270110000025 it is one queue
 * for every growth agent: each row names its `agent` and `kind`, and can carry a skip
 * reason, a PR link and a score.
 */

import { sql } from "./connection";

type SqlTag = typeof sql;

export type ContentDraftStatus = "draft" | "approved" | "skipped" | "posted";
export const CONTENT_DRAFT_STATUSES: readonly ContentDraftStatus[] = ["draft", "approved", "skipped", "posted"];

/** Defaults the database gives rows that name no agent or kind (every row before 2026-10-08). */
export const DEFAULT_DRAFT_AGENT = "murrow";
export const DEFAULT_DRAFT_KIND = "linkedin_post";

export interface ContentDraft {
  id: number;
  /** The agent that drafted it, e.g. `murrow` for the LinkedIn workflows. */
  agent: string;
  /** What it is, e.g. `linkedin_post`, `email`, `pull_request`. */
  kind: string;
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
  /** Why James skipped it, when he said. */
  skipReason: string | null;
  /** The pull request an agent opened for it. */
  prUrl: string | null;
  score: number | null;
  scoredAt: string | null;
}

export interface NewContentDraft {
  /** Defaults to `murrow` in the database. */
  agent?: string;
  /** Defaults to `linkedin_post` in the database. */
  kind?: string;
  /** For a draft that is a code change. */
  prUrl?: string | null;
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
    agent: row.agent ? String(row.agent) : DEFAULT_DRAFT_AGENT,
    kind: row.kind ? String(row.kind) : DEFAULT_DRAFT_KIND,
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
    skipReason: row.skip_reason ? String(row.skip_reason) : null,
    prUrl: row.pr_url ? String(row.pr_url) : null,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    scoredAt: iso(row.scored_at),
  };
}

export async function contentSchemaReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db`SELECT to_regclass('public.content_drafts') IS NOT NULL AS ready`;
  return row?.ready === true;
}

export async function insertContentDraft(draft: NewContentDraft, db: SqlTag = sql): Promise<number> {
  // The queue columns are written only when a caller sets them, so the LinkedIn workflows
  // keep working before migration 20270110000025 is applied (the database defaults fill them after).
  if (draft.agent !== undefined || draft.kind !== undefined || draft.prUrl != null) {
    const [row] = await db`
      INSERT INTO content_drafts (workflow, channel, subject_key, title, caption, facts, as_of, agent_run_id, agent, kind, pr_url)
      VALUES (${draft.workflow}, ${draft.channel ?? "linkedin"}, ${draft.subjectKey}, ${draft.title}, ${draft.caption},
              ${JSON.stringify(draft.facts)}::jsonb, ${draft.asOf.toISOString()}, ${draft.agentRunId},
              ${draft.agent ?? DEFAULT_DRAFT_AGENT}, ${draft.kind ?? DEFAULT_DRAFT_KIND}, ${draft.prUrl ?? null})
      RETURNING id
    `;
    return Number(row.id);
  }
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

/** Longest skip reason kept. */
export const SKIP_REASON_MAX_LENGTH = 500;

export async function setContentDraftStatus(
  id: number,
  status: ContentDraftStatus,
  reviewer: string,
  db: SqlTag = sql,
  /** Why James skipped it; stored only with a skip. */
  skipReason?: string | null,
): Promise<void> {
  const reason = status === "skipped" ? (skipReason ?? "").trim().slice(0, SKIP_REASON_MAX_LENGTH) : "";
  if (reason) {
    await db`
      UPDATE content_drafts
         SET status = ${status},
             skip_reason = ${reason},
             reviewed_by = ${reviewer},
             reviewed_at = now()
       WHERE id = ${id}
    `;
    return;
  }
  await db`
    UPDATE content_drafts
       SET status = ${status},
           reviewed_by = ${reviewer},
           reviewed_at = now(),
           posted_at = CASE WHEN ${status} = 'posted' THEN now() ELSE posted_at END
     WHERE id = ${id}
  `;
}

/** True once migration 20270110000025 (agent, kind, skip_reason, pr_url, score, scored_at) is applied. */
export async function queueSchemaReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'content_drafts'
       AND column_name IN ('agent', 'kind', 'pr_url', 'score', 'scored_at')
  `;
  return Number(row?.n ?? 0) === 5;
}

/** The newest item an agent filed with this kind and subject in the last `days` days, so a retried filing is not queued twice. */
export async function findRecentQueueItem(
  agent: string,
  kind: string,
  subjectKey: string,
  days: number,
  db: SqlTag = sql,
): Promise<number | null> {
  const [row] = await db`
    SELECT id FROM content_drafts
     WHERE agent = ${agent} AND kind = ${kind} AND subject_key = ${subjectKey}
       AND created_at >= now() - make_interval(days => ${days}::int)
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `;
  return row ? Number(row.id) : null;
}

/**
 * Posted items with no score whose post date is at least `days` days old: the ones the weekly
 * scoring measures. `postedAt` falls back to the review time for rows marked posted before
 * posted_at was kept.
 */
export async function listUnscoredPosted(days: number, limit: number, db: SqlTag = sql): Promise<ContentDraft[]> {
  const rows = await db`
    SELECT * FROM content_drafts
     WHERE status = 'posted' AND score IS NULL AND scored_at IS NULL
       AND COALESCE(posted_at, reviewed_at, created_at) <= now() - make_interval(days => ${days}::int)
     ORDER BY COALESCE(posted_at, reviewed_at, created_at) ASC, id ASC
     LIMIT ${limit}
  `;
  return rows.map((row) => toDraft(row as Record<string, unknown>));
}

/** Items older than `days` days that were never posted, by status (they have nothing to score yet). */
export async function countUnpostedOlderThan(days: number, db: SqlTag = sql): Promise<Record<string, number>> {
  const rows = await db`
    SELECT status, COUNT(*)::int AS n FROM content_drafts
     WHERE status <> 'posted' AND score IS NULL
       AND created_at <= now() - make_interval(days => ${days}::int)
     GROUP BY status
  `;
  return Object.fromEntries(rows.map((row) => [String(row.status), Number(row.n)]));
}

/** Writes a measured score once; a row already scored keeps its first score. */
export async function setContentDraftScore(id: number, score: number, db: SqlTag = sql): Promise<void> {
  await db`UPDATE content_drafts SET score = ${score}, scored_at = now() WHERE id = ${id} AND score IS NULL`;
}

/**
 * Marks an item checked with no measure for its kind: `scored_at` set, `score` left null.
 * The reason is in that scoring run's step event. It is not checked again each week; when a
 * measure for its kind is built, clearing `scored_at` puts it back in line.
 */
export async function markContentDraftUnmeasured(id: number, db: SqlTag = sql): Promise<void> {
  await db`UPDATE content_drafts SET scored_at = now() WHERE id = ${id} AND score IS NULL AND scored_at IS NULL`;
}

export async function updateContentDraftCaption(id: number, caption: string, reviewer: string, db: SqlTag = sql): Promise<void> {
  await db`
    UPDATE content_drafts SET caption = ${caption}, reviewed_by = ${reviewer}, reviewed_at = now()
     WHERE id = ${id} AND status IN ('draft', 'approved')
  `;
}
