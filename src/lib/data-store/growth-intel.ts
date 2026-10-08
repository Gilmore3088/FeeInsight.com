/**
 * Reads for SHERLOCK's daily market brief (`src/lib/agents/growth/sherlock.ts`) and NORMAN's
 * weekly conversion check (`src/lib/agents/growth/norman.ts`). Read-only, except that the brief
 * itself goes into the growth queue through `insertContentDraft`.
 */

import { sql } from "./connection";

type SqlTag = typeof sql;

export interface RegulatorItem {
  /** `CFPB`, `FDIC`, `state:NY`, `open_states`, ... */
  source: string;
  title: string;
  link: string;
  /** Two-letter state for a state item, null for a federal one. */
  stateCode: string | null;
  publishedOn: string | null;
}

/**
 * Regulator releases (`reg_articles`) and tracked bills and rules (`reg_tracker_items`) first
 * seen in the last `hours` hours, newest first.
 */
export async function listNewRegulatorItems(hours: number, limit: number, db: SqlTag = sql): Promise<RegulatorItem[]> {
  const [articles, tracked] = await Promise.all([
    db`
      SELECT source, title, link, published_at
        FROM reg_articles
       WHERE created_at >= now() - make_interval(hours => ${hours}::int)
       ORDER BY created_at DESC
       LIMIT ${limit}`,
    db`
      SELECT source, title, url, jurisdiction, published_on
        FROM reg_tracker_items
       WHERE first_seen_at >= now() - make_interval(hours => ${hours}::int)
       ORDER BY first_seen_at DESC
       LIMIT ${limit}`,
  ]);
  const stateOf = (value: unknown): string | null => {
    const match = /^(?:STATE:)?([A-Z]{2})$/.exec(String(value ?? "").trim().toUpperCase());
    return match ? match[1] : null;
  };
  return [
    ...articles.map((row) => ({
      source: String(row.source),
      title: String(row.title ?? ""),
      link: String(row.link ?? ""),
      stateCode: String(row.source).startsWith("state:") ? stateOf(row.source) : null,
      publishedOn: row.published_at ? String(row.published_at).slice(0, 10) : null,
    })),
    ...tracked.map((row) => ({
      source: String(row.source),
      title: String(row.title ?? ""),
      link: String(row.url ?? ""),
      stateCode: stateOf(row.jurisdiction),
      publishedOn: row.published_on ? new Date(row.published_on as string).toISOString().slice(0, 10) : null,
    })),
  ].filter((item) => item.title && item.link);
}

/** Links a growth workflow's queue items cited in the last `days` days, so a finding isn't repeated. */
export async function recentlyCitedLinks(workflow: string, days: number, db: SqlTag = sql): Promise<Set<string>> {
  const rows = await db`
    SELECT facts FROM content_drafts
     WHERE workflow = ${workflow}
       AND created_at >= now() - make_interval(days => ${days}::int)`;
  const links = new Set<string>();
  for (const row of rows) {
    const facts = (typeof row.facts === "string" ? JSON.parse(row.facts) : row.facts) as { links?: unknown } | null;
    if (Array.isArray(facts?.links)) for (const link of facts.links) if (typeof link === "string") links.add(link);
  }
  return links;
}

/** The detail a step key's newest completed run recorded (its `step.finished` event), or null. */
export async function lastStepDetail(stepKey: string, db: SqlTag = sql): Promise<Record<string, unknown> | null> {
  const [row] = await db`
    SELECT e.detail
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = ${stepKey} AND s.status = 'completed' AND e.event_type = 'step.finished'
     ORDER BY e.created_at DESC
     LIMIT 1`;
  if (!row?.detail) return null;
  const detail = typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail;
  return detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : null;
}

/** The funnel counts NORMAN compares week over week, all from our own tables. */
export interface FunnelCounts {
  /** Sessions that landed from a tracked (utm) link. */
  trackedVisits: number;
  snapshotOpened: number;
  snapshotReportClicks: number;
  /** Lead rows from a report request form. */
  reportRequests: number;
  /** Lead rows of any kind. */
  leads: number;
  quotesSent: number;
  paidReports: number;
}

/** Funnel counts for [from, to). A table that doesn't exist yet counts as null, not zero. */
export async function funnelCounts(from: Date, to: Date, db: SqlTag = sql): Promise<{ [K in keyof FunnelCounts]: number | null }> {
  const [ready] = await db`
    SELECT to_regclass('public.marketing_touches') IS NOT NULL AS touches,
           to_regclass('public.snapshot_events') IS NOT NULL AS snapshots`;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const [leads] = await db`
    SELECT COUNT(*)::int AS leads,
           COUNT(*) FILTER (WHERE source ILIKE '%report%')::int AS report_requests,
           COUNT(*) FILTER (WHERE quote_sent_at >= ${fromIso} AND quote_sent_at < ${toIso})::int AS quotes,
           COUNT(*) FILTER (WHERE paid_at >= ${fromIso} AND paid_at < ${toIso})::int AS paid
      FROM leads
     WHERE (created_at >= ${fromIso} AND created_at < ${toIso})
        OR (quote_sent_at >= ${fromIso} AND quote_sent_at < ${toIso})
        OR (paid_at >= ${fromIso} AND paid_at < ${toIso})`;
  const touches = ready?.touches
    ? Number((await db`SELECT COUNT(*)::int AS n FROM marketing_touches WHERE created_at >= ${fromIso} AND created_at < ${toIso}`)[0]?.n ?? 0)
    : null;
  let opened: number | null = null;
  let reportClicks: number | null = null;
  if (ready?.snapshots) {
    const [row] = await db`
      SELECT COUNT(*) FILTER (WHERE event = 'opened')::int AS opened,
             COUNT(*) FILTER (WHERE event = 'report_click')::int AS report_clicks
        FROM snapshot_events
       WHERE created_at >= ${fromIso} AND created_at < ${toIso}`;
    opened = Number(row?.opened ?? 0);
    reportClicks = Number(row?.report_clicks ?? 0);
  }
  return {
    trackedVisits: touches,
    snapshotOpened: opened,
    snapshotReportClicks: reportClicks,
    reportRequests: Number(leads?.report_requests ?? 0),
    leads: Number(leads?.leads ?? 0),
    quotesSent: Number(leads?.quotes ?? 0),
    paidReports: Number(leads?.paid ?? 0),
  };
}

/** Outreach drafts not yet sent (draft or approved) and the link each one promises. */
export async function unsentOutreachLinks(limit: number, db: SqlTag = sql): Promise<Array<{ draftId: number; title: string; link: string }>> {
  const rows = await db`
    SELECT id, title, facts->>'link' AS link
      FROM content_drafts
     WHERE kind = 'outreach_email' AND status IN ('draft', 'approved') AND facts->>'link' IS NOT NULL
     ORDER BY id
     LIMIT ${limit}`;
  return rows.map((row) => ({ draftId: Number(row.id), title: String(row.title), link: String(row.link) }));
}
