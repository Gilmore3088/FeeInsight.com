import type { sql } from "@/lib/data-store/connection";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import type { FeedbackRow } from "@/lib/agents/learning/feedback";
import { urlIdentity } from "./finders";

type SqlTag = typeof sql;

/**
 * A missed second schedule (#2070). Many banks price their fees in two or more documents (a general
 * schedule beside an overdraft disclosure, an account page, a consumer supplement), and Magellan's
 * companion finder (`second-document.ts`) looks for the others. Before this, a schedule it missed
 * left no trace any agent read: the answer key's document for the bank could sit on the bank's own
 * site while Magellan had never stored it, and nothing sent the bank back to look. The companion
 * finder also never ran in rescue mode (`discovery.ts`, `wantSecondDocuments`).
 *
 * Now a document known to price the bank's fees that Magellan has never stored is recorded as a
 * `missed_second_schedule` row (stage discover). Deming's answer-key replay writes it when the
 * key's own document is not among the bank's stored documents or companion pages
 * (`deming/knox-misses.ts`). The companion finder reads it (`loadMissedSchedules`): the bank goes to
 * the front of its next search, in discovery and in rescue mode alike, past the monthly recheck and
 * the thin-bank filter, and the missed address itself is checked first as a fee document. A row is
 * open until the companion finder has searched the bank since the row was first written; it closes
 * on that search whatever it found (the attempt log keeps what was checked), so a bank is sent back
 * once per missed document, not every day.
 */

export const MISSED_SECOND_SCHEDULE_KIND = "missed_second_schedule";
/** The answer key's document for the bank is not among its stored documents. */
export const MISSED_SCHEDULE_CHECK = "deming.answer_key_document";
/** Banks with an open row taken per companion step, before the thin banks. */
export const MISSED_SCHEDULE_BANKS_PER_STEP = 3;
/** Missed addresses checked first per bank. */
export const MISSED_SCHEDULE_URLS_PER_BANK = 3;

/** Pure: the document is not one Magellan stored or kept for the bank (same address, any copy). */
export function scheduleMissed(documentUrl: string, storedUrls: ReadonlyArray<string | null>): boolean {
  if (!documentUrl.trim()) return false;
  const target = urlIdentity(documentUrl);
  return !storedUrls.some((url) => url != null && urlIdentity(url) === target);
}

/** Pure: the row a missed document writes. One row per bank and address. */
export function missedScheduleFeedback(input: {
  institutionId: number;
  documentUrl: string;
  documentType?: string | null;
  /** The fee categories the document prices that the bank's stored documents do not give. */
  categories?: readonly string[];
  /** What showed the document prices the bank's fees (an answer-key fee id). */
  evidenceFeeIds?: readonly number[];
  runId?: number | null;
  checkName?: string;
}): FeedbackRow {
  return {
    aboutStage: "discover",
    aboutStrategy: "discover.second_document",
    signal: "missed",
    kind: MISSED_SECOND_SCHEDULE_KIND,
    reportedBy: "deming",
    checkName: input.checkName ?? MISSED_SCHEDULE_CHECK,
    institutionId: input.institutionId,
    sourceUrl: input.documentUrl,
    evidence: {
      document_url: input.documentUrl,
      document_type: input.documentType ?? null,
      categories: [...new Set(input.categories ?? [])].sort(),
      answer_key_fee_ids: [...(input.evidenceFeeIds ?? [])],
    },
    runId: input.runId ?? null,
    dedupeKey: `${MISSED_SECOND_SCHEDULE_KIND}:${input.institutionId}:${urlIdentity(input.documentUrl)}`,
  };
}

export interface MissedSchedules {
  /** Bank id to the missed addresses, newest first. */
  urls: Map<number, string[]>;
}

/**
 * The banks with an open missed-schedule row, oldest row first: no companion search
 * (`discover.second_document`, any version) has run for the bank since the row was first written.
 * Read-only. `stateCode` keeps a state lane to its state; rescue mode passes none.
 */
export async function loadMissedSchedules(
  db: SqlTag,
  options: { stateCode?: string | null; limit?: number; excludeIds?: number[] } = {},
): Promise<MissedSchedules> {
  const stateCode = normalizeStateCode(options.stateCode ?? undefined) ?? null;
  const limit = options.limit ?? MISSED_SCHEDULE_BANKS_PER_STEP;
  const excludeIds = options.excludeIds ?? [];
  const rows = await db<Array<{ institution_id: number | string; urls: string[] }>>`
    WITH open AS (
      SELECT f.institution_id, f.source_url, f.created_at
        FROM pipeline_feedback f
        JOIN institution_sources inst ON inst.id = f.institution_id
       WHERE f.kind = ${MISSED_SECOND_SCHEDULE_KIND}
         AND f.about_stage = 'discover'
         AND f.source_url IS NOT NULL
         AND COALESCE(inst.status, 'active') = 'active'
         AND inst.website_url IS NOT NULL AND btrim(inst.website_url) <> ''
         AND inst.fee_schedule_url IS NOT NULL AND btrim(inst.fee_schedule_url) <> ''
         AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode})
         AND f.institution_id <> ALL(${excludeIds}::bigint[])
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.institution_id = f.institution_id
              AND pa.stage = 'discover'
              AND pa.strategy = 'discover.second_document'
              AND pa.created_at > f.created_at
         )
    )
    SELECT institution_id, array_agg(source_url ORDER BY created_at DESC) AS urls
      FROM open
     GROUP BY institution_id
     ORDER BY min(created_at), institution_id
     LIMIT ${limit}
  `;
  return {
    urls: new Map(rows.map((row) => [Number(row.institution_id), (row.urls ?? []).slice(0, MISSED_SCHEDULE_URLS_PER_BANK)])),
  };
}

/** True when any bank has an open row, so rescue mode leaves the companion finder time to run. Read-only. */
export async function missedSchedulesPending(db: SqlTag): Promise<boolean> {
  const found = await loadMissedSchedules(db, { limit: 1 });
  return found.urls.size > 0;
}
