/**
 * Tracked-link visits (marketing_touches) and each lead's first tracked source
 * (leads.first_utm_*). No personal data is stored: see src/lib/marketing-touch.ts.
 */

import type { MarketingTouch } from "@/lib/marketing-touch";
import { sql } from "./connection";

/** Stores one tracked-link visit. */
export async function insertMarketingTouch(touch: MarketingTouch): Promise<void> {
  await sql`
    INSERT INTO marketing_touches
      (utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path, referrer_host)
    VALUES (
      ${touch.utm_source}, ${touch.utm_medium}, ${touch.utm_campaign}, ${touch.utm_content},
      ${touch.utm_term}, ${touch.landing_path}, ${touch.referrer_host}
    )`;
}

/**
 * Saves a lead's first tracked source. First touch wins: the row is written only while it
 * has no tracked source yet, and all five values come from one touch (never mixed).
 * Returns true when the lead took this touch.
 */
export async function recordLeadFirstTouch(leadId: number, touch: MarketingTouch): Promise<boolean> {
  const rows = await sql<{ id: number | string }[]>`
    UPDATE leads SET
      first_utm_source = ${touch.utm_source},
      first_utm_medium = ${touch.utm_medium},
      first_utm_campaign = ${touch.utm_campaign},
      first_utm_content = ${touch.utm_content},
      first_landing_path = ${touch.landing_path}
    WHERE id = ${leadId}
      AND first_utm_source IS NULL
      AND first_utm_medium IS NULL
      AND first_utm_campaign IS NULL
      AND first_utm_content IS NULL
      AND first_landing_path IS NULL
    RETURNING id`;
  return rows.length > 0;
}

type SqlTag = typeof sql;

/** True once marketing_touches and the leads.first_utm_* columns exist (migration 20270110000022). */
export async function touchSchemaReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db`
    SELECT to_regclass('public.marketing_touches') IS NOT NULL AS touches,
           (SELECT COUNT(*)::int FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'leads'
               AND column_name IN ('first_utm_campaign', 'first_utm_content')) AS lead_columns
  `;
  return row?.touches === true && Number(row?.lead_columns ?? 0) === 2;
}

/**
 * Tracked visits and leads for one link (campaign and content) in a window: sessions that
 * landed from it, and leads whose first tracked source was it.
 */
export async function countTrackedOutcomes(
  campaign: string,
  content: string,
  from: Date,
  to: Date,
  db: SqlTag = sql,
): Promise<{ visits: number; leads: number }> {
  const [row] = await db`
    SELECT
      (SELECT COUNT(*)::int FROM marketing_touches
        WHERE utm_campaign = ${campaign} AND utm_content = ${content}
          AND created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()}) AS visits,
      (SELECT COUNT(*)::int FROM leads
        WHERE first_utm_campaign = ${campaign} AND first_utm_content = ${content}
          AND created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()}) AS leads
  `;
  return { visits: Number(row?.visits ?? 0), leads: Number(row?.leads ?? 0) };
}
