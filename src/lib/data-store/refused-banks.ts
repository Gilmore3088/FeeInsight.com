import { sql } from "./connection";
import { FINANCIAL_SOURCES } from "./financial-sources";
import { institutionDisplayName } from "@/lib/institution-display-name";
import { OPERATOR_SCHEDULE_STRATEGY } from "@/lib/agents/magellan/operator-schedules";
import { HAND_SUPPLIED_STRATEGY } from "@/lib/agents/magellan/hand-supplied";
import type { RefusedBank } from "@/lib/agents/magellan/hand-supplied-files";

type SqlTag = typeof sql;

/** Fetch outcomes that mean the site refused us, not that the page was wrong (as the hit list). */
export const REFUSED_OUTCOMES = ["http_403", "blocked_bot", "http_429"] as const;
/** Only refusals this recent count: an older one may have passed since. */
export const REFUSED_WINDOW_DAYS = 30;
export const REFUSED_LIST_DEFAULT_LIMIT = 100;

/**
 * The hand-download list (fix plan step 9, Oct 27): active banks with no live fees whose own site
 * still refuses us, largest deposits first, so a person downloads each schedule once in a browser
 * and loads it at /admin/magellan/hand-supplied. A bank is on it when, in the last
 * REFUSED_WINDOW_DAYS:
 * - `link`: the latest plain fetch of its fee link was refused and no paid fetch opened it since;
 * - `homepage`: it has no fee link and the latest read of its homepage was refused.
 * Read-only. A bank with a hand-supplied schedule already waiting is left off.
 */
export async function getRefusedBanks(options: { db?: SqlTag; limit?: number } = {}): Promise<RefusedBank[]> {
  const db = options.db ?? sql;
  const limit = Math.min(Math.max(Math.floor(options.limit ?? REFUSED_LIST_DEFAULT_LIMIT), 1), 1000);
  const refused = [...REFUSED_OUTCOMES];
  const sources = [...FINANCIAL_SOURCES];
  const rows = await db<
    Array<{
      id: number | string;
      institution_name: string;
      state_code: string | null;
      charter_type: string | null;
      deposits: number | string | null;
      asset_size: number | string | null;
      website_url: string | null;
      fee_schedule_url: string | null;
      refused_by: "link" | "homepage";
      refused_outcome: string;
    }>
  >`
    -- refused banks: the hand-download list
    WITH link_fetch AS MATERIALIZED (
      SELECT DISTINCT ON (pa.institution_id) pa.institution_id, pa.outcome, pa.created_at
        FROM pipeline_attempts pa
        JOIN institution_sources linked ON linked.id = pa.institution_id
       WHERE pa.stage = 'fetch' AND pa.strategy = 'fetch.http'
         -- Only fetches of the bank's current link, not of its companion pages.
         AND pa.detail->>'url' = btrim(linked.fee_schedule_url)
         AND pa.created_at > NOW() - make_interval(days => ${REFUSED_WINDOW_DAYS})
       ORDER BY pa.institution_id, pa.created_at DESC
    ),
    homepage AS MATERIALIZED (
      SELECT DISTINCT ON (pa.institution_id) pa.institution_id, pa.outcome, pa.created_at
        FROM pipeline_attempts pa
       WHERE pa.stage = 'discover' AND pa.strategy = 'discover.homepage_links'
         AND pa.created_at > NOW() - make_interval(days => ${REFUSED_WINDOW_DAYS})
       ORDER BY pa.institution_id, pa.created_at DESC
    ),
    refused AS (
      SELECT inst.id, inst.institution_name, inst.state_code, inst.charter_type, inst.asset_size, inst.website_url, inst.fee_schedule_url,
             CASE WHEN NULLIF(btrim(inst.fee_schedule_url), '') IS NOT NULL THEN 'link' ELSE 'homepage' END AS refused_by,
             CASE WHEN NULLIF(btrim(inst.fee_schedule_url), '') IS NOT NULL THEN link_fetch.outcome ELSE homepage.outcome END AS refused_outcome
        FROM institution_sources inst
        LEFT JOIN link_fetch ON link_fetch.institution_id = inst.id
        LEFT JOIN homepage ON homepage.institution_id = inst.id
       WHERE COALESCE(inst.status, 'active') = 'active'
         AND COALESCE(inst.regulatory_status, 'active') <> 'inactive'
         AND NOT EXISTS (SELECT 1 FROM published_fee_catalog live WHERE live.institution_id = inst.id)
         AND NOT EXISTS (
           SELECT 1 FROM institution_additional_sources hand
            WHERE hand.institution_id = inst.id AND hand.found_by_strategy = ${OPERATOR_SCHEDULE_STRATEGY.strategy}
              AND hand.status = 'found' AND hand.last_fetched_at IS NULL
         )
         -- A schedule someone already loaded by hand is not downloaded again.
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts supplied
            WHERE supplied.institution_id = inst.id AND supplied.stage = 'fetch'
              AND supplied.strategy = ${HAND_SUPPLIED_STRATEGY.strategy} AND supplied.outcome = 'ok'
         )
         AND (
           (NULLIF(btrim(inst.fee_schedule_url), '') IS NOT NULL
             AND link_fetch.outcome = ANY(${refused}::text[])
             AND NOT EXISTS (
               SELECT 1 FROM pipeline_attempts paid
                WHERE paid.institution_id = inst.id AND paid.stage = 'fetch'
                  AND paid.strategy LIKE 'fetch.paid_web_fetch%'
                  AND paid.outcome IN ('ok', 'unchanged')
                  AND paid.created_at >= link_fetch.created_at
             ))
           OR (NULLIF(btrim(inst.fee_schedule_url), '') IS NULL
             AND homepage.outcome = ANY(${refused}::text[]))
         )
    ),
    deposits AS (
      SELECT DISTINCT ON (f.institution_id) f.institution_id, f.total_deposits
        FROM institution_financial_records f
        JOIN refused ON refused.id = f.institution_id
       WHERE f.source = ANY(${sources}::text[]) AND f.total_deposits IS NOT NULL
       ORDER BY f.institution_id, f.report_date DESC
    )
    SELECT refused.*, deposits.total_deposits AS deposits
      FROM refused
      LEFT JOIN deposits ON deposits.institution_id = refused.id
     ORDER BY deposits.total_deposits DESC NULLS LAST, refused.id ASC
     LIMIT ${limit}::int
  `;
  return rows.map((row) => ({
    institutionId: Number(row.id),
    name: institutionDisplayName(String(row.institution_name)),
    stateCode: row.state_code ? String(row.state_code).trim().toUpperCase() : null,
    charterType: row.charter_type,
    deposits: row.deposits == null ? null : Number(row.deposits),
    assets: row.asset_size == null ? null : Number(row.asset_size),
    websiteUrl: row.website_url,
    feeScheduleUrl: row.fee_schedule_url && row.fee_schedule_url.trim() ? row.fee_schedule_url.trim() : null,
    refusedBy: row.refused_by,
    refusedOutcome: row.refused_outcome,
  }));
}
