import { recordAttempt } from "@/lib/agents/learning/attempts";
import { isArticleUrl } from "@/lib/agents/learning/fee-page";
import type { sql } from "@/lib/data-store/connection";

import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { FEE_PAGE_NAME_SQL, isArticleLink, isSingleProductDisclosureLink } from "./link-coverage";

type SqlTag = typeof sql;

/**
 * Puts a bank's own fee page back as its main link when that page was set aside for
 * reading blank and Magellan then swapped in a weaker page.
 *
 * Rosetta sets aside a page that reads no dollar amounts or needs JavaScript; with no
 * main link the bank goes back to Magellan, which saves whatever page next passes the
 * fee-page check. For a page named "Fee Schedule" that was usually worse: Five Rivers
 * Bank's fee page (built by JavaScript) became a 12-month time-deposit disclosure on
 * Oct 5. Rosetta now reads more of those pages (embedded data, linked and embedded PDF
 * viewers), so the named page gets one more read: it becomes the main link again, the
 * page found in its place is kept beside it as a companion (unless it is an article or
 * one product's disclosure), and a `discover`/`restore_fee_page` attempt records the
 * swap. Only a link that names the schedule itself counts (`namesFeeSchedulePage`), and a
 * found page that is a PDF or already gives 8 or more live fees is left alone. Once per bank and version: a page that still reads blank is set aside by
 * Rosetta as before and the bank is not restored again at this version.
 */
export const RESTORE_FEE_PAGE_VERSION = 1;
export const RESTORE_FEE_PAGE_STRATEGY = "restore_fee_page";
const RESTORE_LIMIT = 25;
/** Rosetta's reasons for setting aside a page that read blank, not a wrong page. */
/**
 * A link that names the bank's fee schedule itself ("/fee-schedule", "schedule-of-charges",
 * "/rates-and-fees/"), not a page that merely mentions fees ("no-overdraft-fees-no-worries").
 */
const FEE_SCHEDULE_PAGE =
  /(fee-?schedule|schedule-?of-?(fees|charges|service-charges)|fees-?and-?charges|service-?charges|fee-?disclosure|\/(rates-and-|additional-services-and-)?fees(\.html?)?\/?$)/i;
/** A link already giving this many live fees is kept: it is doing the job. */
const KEEP_LIVE_FEES = 8;
const PDF_LINK_SQL = "\\.pdf($|\\?)";
const BLANK_READ_REASON_SQL = "(only 0 dollar amounts|built by javascript)";

interface RestoreRow {
  institution_id: number | string;
  current_url: string;
  fee_url: string;
  reason: string | null;
  current_live_fees: number | string;
}

/** True when the link's path names the fee schedule itself and is not an article. */
export function namesFeeSchedulePage(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    return FEE_SCHEDULE_PAGE.test(path) && !isArticleUrl(url) && !isArticleLink(url);
  } catch {
    return false;
  }
}

export interface RestoreFeePagesResult {
  checked: number;
  restored: number;
  dryRun: boolean;
  samples: Array<{ institutionId: number; from: string; to: string }>;
}

export async function restoreSwappedFeePages(options: {
  db: SqlTag;
  runId: number;
  stepId?: number | null;
  stateCode?: string | null;
  dryRun?: boolean;
  limit?: number;
}): Promise<RestoreFeePagesResult> {
  const { db } = options;
  const dryRun = options.dryRun ?? false;
  const limit = Math.max(0, options.limit ?? RESTORE_LIMIT);
  const normalizedState = normalizeStateCode(options.stateCode ?? undefined);
  const rows = limit === 0 ? [] : await db<RestoreRow[]>`
    -- fee pages swapped out after a blank read
    SELECT DISTINCT ON (inst.id)
           inst.id AS institution_id,
           inst.fee_schedule_url AS current_url,
           entry->>'url' AS fee_url,
           entry->>'reason' AS reason,
           (SELECT count(*) FROM published_fee_catalog live
             WHERE live.institution_id = inst.id
               AND (live.source_url = inst.fee_schedule_url OR live.document_url = inst.fee_schedule_url)) AS current_live_fees
      FROM institution_sources inst
      JOIN institution_source_profiles profile
        ON profile.institution_id = inst.id
     CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(profile.rejected_source_urls) = 'array'
                THEN profile.rejected_source_urls ELSE '[]'::jsonb END
         ) entry
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND inst.fee_schedule_url IS NOT NULL
       AND btrim(inst.fee_schedule_url) <> ''
       AND lower(inst.fee_schedule_url) !~ ${FEE_PAGE_NAME_SQL}
       AND lower(inst.fee_schedule_url) !~ ${PDF_LINK_SQL}
       AND COALESCE(inst.document_type, 'html') <> 'pdf'
       AND lower(entry->>'url') ~ ${FEE_PAGE_NAME_SQL}
       AND lower(COALESCE(entry->>'reason', '')) ~ ${BLANK_READ_REASON_SQL}
       AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
       AND COALESCE(profile.locked_by_correction, FALSE) IS FALSE
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'discover'
            AND pa.strategy = ${RESTORE_FEE_PAGE_STRATEGY}
            AND pa.strategy_version = ${RESTORE_FEE_PAGE_VERSION}
       )
     ORDER BY inst.id, entry->>'at' DESC NULLS LAST
     LIMIT ${limit}
  `;

  const result: RestoreFeePagesResult = { checked: rows.length, restored: 0, dryRun, samples: [] };
  for (const row of rows) {
    const institutionId = Number(row.institution_id);
    // A page already giving the bank its fees stays, unless it is one product's disclosure.
    const keep = !namesFeeSchedulePage(row.fee_url)
      ? "set-aside page does not name the fee schedule"
      : Number(row.current_live_fees) >= KEEP_LIVE_FEES && !isSingleProductDisclosureLink(row.current_url)
        ? `current link gives ${Number(row.current_live_fees)} live fees`
        : null;
    if (keep) {
      // Logged so the bank is not picked again at this version.
      if (!dryRun) await logRestore(db, options, institutionId, row, "unchanged", { kept_current: keep });
      continue;
    }
    if (result.samples.length < 10) result.samples.push({ institutionId, from: row.current_url, to: row.fee_url });
    if (dryRun) {
      result.restored += 1;
      continue;
    }
    const swapped = await db`
      UPDATE institution_sources
         SET fee_schedule_url = ${row.fee_url}
       WHERE id = ${institutionId}
         AND fee_schedule_url = ${row.current_url}
      RETURNING id
    `;
    if (swapped.length === 0) {
      await logRestore(db, options, institutionId, row, "unchanged", { kept_current: "link changed while checking" });
      continue;
    }
    await db`
      UPDATE institution_source_profiles
         SET rejected_source_urls = (
               SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
                 FROM jsonb_array_elements(COALESCE(rejected_source_urls, '[]'::jsonb)) entry
                WHERE entry->>'url' IS DISTINCT FROM ${row.fee_url}
             ),
             canonical_source_url = ${row.fee_url},
             updated_at = NOW()
       WHERE institution_id = ${institutionId}
    `;
    const keepAsCompanion = !isArticleLink(row.current_url) && !isSingleProductDisclosureLink(row.current_url);
    if (keepAsCompanion) {
      await db`
        INSERT INTO institution_additional_sources
          (institution_id, url, document_type, document_role, found_by_strategy, strategy_version, agent_run_id, reason)
        VALUES
          (${institutionId}, ${row.current_url}, 'html', 'account_page', ${`discover.${RESTORE_FEE_PAGE_STRATEGY}`},
           ${RESTORE_FEE_PAGE_VERSION}, ${options.runId},
           'Page found after the fee page read blank; kept beside the restored fee page')
        ON CONFLICT (institution_id, url) DO NOTHING
      `;
    }
    await logRestore(db, options, institutionId, row, "ok", { kept_as_companion: keepAsCompanion });
    result.restored += 1;
  }
  return result;
}

async function logRestore(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  institutionId: number,
  row: RestoreRow,
  outcome: "ok" | "unchanged",
  extra: Record<string, unknown>,
): Promise<void> {
  await recordAttempt(db, {
    institutionId,
    stage: "discover",
    strategy: RESTORE_FEE_PAGE_STRATEGY,
    version: RESTORE_FEE_PAGE_VERSION,
    fingerprint: row.fee_url,
    outcome,
    yieldCount: outcome === "ok" ? 1 : 0,
    costMicrousd: 0,
    runId: options.runId,
    stepId: options.stepId ?? null,
    detail: { from: row.current_url, to: row.fee_url, set_aside_reason: row.reason, ...extra },
    foldIntoPlaybook: false,
  });
}
