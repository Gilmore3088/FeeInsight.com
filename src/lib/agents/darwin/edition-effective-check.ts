import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { normalizedFeeName } from "@/lib/agents/hamilton/publish";
import {
  EDITION_LATE_HEADING_LIVE,
  editionStarts,
  editionTakesOver,
  editionWindowSql,
  isoDay,
  notYetEffective,
} from "@/lib/agents/hamilton/schedule-edition";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of schedule editions (#1915; decision 2026-10-15, "Darwin re-checks every
 * live fee against today's rules"). Avidia Bank (institution 450) posted its next consumer schedule,
 * "Effective December 1, 2026" (document 31094), in September. It was read on Oct 12 and its rows
 * went live beside the current March 2024 schedule (document 253): overdraft and NSF at $35 beside
 * today's $30, and the $35 was the page's headline. Nothing held a schedule back until its date.
 *
 * Each Darwin step, against the edition each document's heading states (`editionStarts`, the stored
 * text's first `EDITION_HEAD_CHARS` characters; v2, T1: with `EDITION_LATE_HEADING_LIVE` also the
 * schedule's own edition line past a web page's menu, `lateEdition`, which until then is a count only,
 * `late_heading_would_hold`):
 * - hold: a live fee read from a schedule not yet in effect (`notYetEffective`) is rolled back with
 *   `not_yet_effective: <date> #<doc>`. Its verified row is left as it is; Hamilton's publish step
 *   holds it too (`notYetEffectiveHolds` in publish.ts), so it waits instead of coming back.
 * - restore: on the effective date a fee held that way is live again (its rollback cleared), unless
 *   its verified row was rejected since or another live row already carries it.
 * - takeover: once the newer edition is in effect, the older edition's line of the same fee (same
 *   institution, category, name and audience, a schedule for the same audience on another document)
 *   comes down as `older_edition: #<doc> effective <date>`, its verified row rejected with the
 *   `older_edition` flag so publish does not bring it back. The two never sit side by side.
 *
 * Nothing is deleted. A dry run, or the switch off, reports and writes nothing.
 */
export const EDITION_CHECK = "darwin.edition_effective_check";
export const EDITION_CHECK_VERSION = 2;
export const EDITION_CHECK_LIVE = true;
export const NOT_YET_EFFECTIVE_REASON = "not_yet_effective";
export const OLDER_EDITION_REASON = "older_edition";
export const OLDER_EDITION_FLAG = "older_edition";
export const EDITION_CHECK_SAMPLES = 20;

export interface EditionRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  fee_audience: string | null;
  /** Live now; a not-live row is one this check held. */
  live: boolean;
  /** The verified row is still verified or approved. */
  verified_ok: boolean;
  source_document_id: number | string;
  document_url: string | null;
  /** The head of the document's latest stored text. */
  head: string | null;
  /** The day the document's text was first stored, YYYY-MM-DD. */
  first_read: string | null;
}

export interface EditionAction {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  sourceDocumentId: number;
  reason: string;
}

export interface EditionFindings {
  checked: number;
  holds: EditionAction[];
  restores: EditionAction[];
  takeovers: EditionAction[];
  institutions: number[];
}

function action(row: EditionRow, reason: string): EditionAction {
  return {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: row.fee_verified_id == null ? null : Number(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    feeName: row.fee_name ?? "",
    amount: row.amount == null ? null : Number(row.amount),
    canonicalFeeKey: row.canonical_fee_key,
    sourceDocumentId: Number(row.source_document_id),
    reason,
  };
}

/**
 * Pure: what the check does to each row on `today` (YYYY-MM-DD). See the module note. `lateHeading`
 * also reads an edition line past the page's menu (`lateEdition`, T1); it follows
 * `EDITION_LATE_HEADING_LIVE` unless a shadow count asks for it.
 */
export function judgeEditions(rows: EditionRow[], today: string, lateHeading = EDITION_LATE_HEADING_LIVE): EditionFindings {
  const holds: EditionAction[] = [];
  const restores: EditionAction[] = [];
  const current: EditionRow[] = [];
  for (const row of rows) {
    const future = notYetEffective(row.head, today, lateHeading);
    if (row.live && future) holds.push(action(row, `${NOT_YET_EFFECTIVE_REASON}: ${future} #${row.source_document_id}`));
    else if (!row.live && !future && row.verified_ok) {
      restores.push(action(row, "restored: edition in effect"));
      current.push(row);
    } else if (row.live) current.push(row);
  }
  const groups = new Map<string, EditionRow[]>();
  for (const row of current) {
    const key = [row.institution_id, row.canonical_fee_key ?? "", normalizedFeeName(row.fee_name), row.fee_audience ?? "unknown"].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const takeovers: EditionAction[] = [];
  for (const group of groups.values()) {
    for (const older of group) {
      const newer = group.find((other) =>
        String(other.source_document_id) !== String(older.source_document_id) &&
        editionTakesOver({
          olderUrl: older.document_url, newerUrl: other.document_url, olderText: older.head, newerText: other.head,
          newerFirstRead: other.first_read, today, lateHeading,
        }));
      if (newer) takeovers.push(action(older, `${OLDER_EDITION_REASON}: #${newer.source_document_id} effective ${editionStarts(newer.head, lateHeading)}`));
    }
  }
  // A restored row an even newer edition replaces stays down.
  const replaced = new Set(takeovers.map((fee) => fee.feePublishedId));
  const kept = restores.filter((fee) => !replaced.has(fee.feePublishedId));
  const liveTakeovers = takeovers.filter((fee) => !restores.some((restore) => restore.feePublishedId === fee.feePublishedId));
  const institutions = [...new Set([...holds, ...kept, ...liveTakeovers].map((fee) => fee.institutionId))].sort((a, b) => a - b);
  return { checked: rows.length, holds, restores: kept, takeovers: liveTakeovers, institutions };
}

/**
 * Read-only: live fees, and fees this check held, read from documents whose stored text says
 * "effective" in its heading or on a late edition line (`editionWindowSql`). The same read the step
 * makes; run it in a dry run for the count. A document's text comes once, on its first fee's row
 * (`head` is null on the rest), so a long late window is not sent once per fee; `readEditionRows`
 * copies it onto every row.
 */
export function editionRowsSql(db: SqlTag, options: { institutionId?: number; today?: string } = {}) {
  const scoped = options.institutionId != null;
  const window = editionWindowSql("t.normalized_text", options.today ?? isoDay(new Date()));
  return db<EditionRow[]>`
    WITH fees AS MATERIALIZED (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key,
             fp.fee_audience, (fp.rolled_back_at IS NULL) AS live,
             (fv.review_status IN ('verified', 'approved')) AS verified_ok, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.quarantined_at IS NULL
         AND (fp.rolled_back_at IS NULL OR fp.rolled_back_reason LIKE ${`${NOT_YET_EFFECTIVE_REASON}:%`})
         AND fr.source_document_id IS NOT NULL
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
    ),
    latest AS MATERIALIZED (
      SELECT DISTINCT ON (t.source_document_id) t.source_document_id, t.id
        FROM agent_source_texts t
       WHERE t.status = 'completed'
         AND t.source_document_id IN (SELECT DISTINCT source_document_id FROM fees)
       ORDER BY t.source_document_id, t.id DESC
    ),
    heads AS MATERIALIZED (
      SELECT l.source_document_id, ${db.unsafe(window)} AS head
        FROM latest l
        JOIN agent_source_texts t ON t.id = l.id
    ),
    dated AS MATERIALIZED (
      SELECT h.source_document_id, h.head, to_char(MIN(first.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS first_read
        FROM heads h
        JOIN agent_source_texts first ON first.source_document_id = h.source_document_id AND first.status = 'completed'
       WHERE h.head ~* 'effective'
       GROUP BY h.source_document_id, h.head
    )
    SELECT r.fee_published_id, r.fee_verified_id, r.institution_id, r.fee_name, r.amount, r.canonical_fee_key,
           r.fee_audience, r.live, r.verified_ok, r.source_document_id, r.document_url,
           CASE WHEN r.nth = 1 THEN h.head END AS head, h.first_read
      FROM (
        SELECT f.*, btrim(sd.document_url) AS document_url,
               row_number() OVER (PARTITION BY f.source_document_id ORDER BY f.fee_published_id) AS nth
          FROM fees f
          JOIN source_documents sd ON sd.id = f.source_document_id
         WHERE f.source_document_id IN (SELECT source_document_id FROM dated)
      ) r
      JOIN dated h ON h.source_document_id = r.source_document_id
     ORDER BY r.fee_published_id
  `;
}

/** The rows `editionRowsSql` returns, each with its document's text (sent once per document). */
export function withDocumentHeads(rows: EditionRow[]): EditionRow[] {
  const heads = new Map<string, string>();
  for (const row of rows) if (row.head != null) heads.set(String(row.source_document_id), row.head);
  return rows.map((row) => (row.head != null ? row : { ...row, head: heads.get(String(row.source_document_id)) ?? null }));
}

/** Read-only: `editionRowsSql` with every row's document text in place. */
export async function readEditionRows(db: SqlTag, options: { institutionId?: number; today?: string } = {}): Promise<EditionRow[]> {
  return withDocumentHeads(await editionRowsSql(db, options));
}

/** Of `shadow`'s holds and retirements, those `found` does not make: what the late edition line adds while its switch is off. */
export function lateHeadingOnly(found: EditionFindings, shadow: EditionFindings): EditionAction[] {
  const acted = new Set([...found.holds, ...found.takeovers].map((fee) => fee.feePublishedId));
  return [...shadow.holds, ...shadow.takeovers].filter((fee) => !acted.has(fee.feePublishedId));
}

export interface EditionCheckResult {
  live: boolean;
  dryRun: boolean;
  today: string;
  checked: number;
  holds: number;
  restores: number;
  takeovers: number;
  institutions: number[];
  held: number[];
  restored: number[];
  retired: number[];
  samples: EditionAction[];
  /** T1: whether a late edition line (`lateEdition`) is read for real (`EDITION_LATE_HEADING_LIVE`). */
  lateHeadingLive: boolean;
  /** While that switch is off: live fees a late edition line would also hold or retire. Nothing is written for them. */
  lateHeadingWouldHold: number;
  lateHeadingSamples: EditionAction[];
}

/** One step's re-check (see the module note). Never throws: a failed read checks nothing, a failed write changes nothing. */
export async function recheckScheduleEditions(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; now?: Date },
): Promise<EditionCheckResult> {
  const live = options.live ?? EDITION_CHECK_LIVE;
  const today = isoDay(options.now ?? new Date());
  const result: EditionCheckResult = {
    live, dryRun: options.dryRun, today, checked: 0, holds: 0, restores: 0, takeovers: 0, institutions: [],
    held: [], restored: [], retired: [], samples: [],
    lateHeadingLive: EDITION_LATE_HEADING_LIVE, lateHeadingWouldHold: 0, lateHeadingSamples: [],
  };
  let rows: EditionRow[];
  try {
    rows = await inSavepoint(db, (scope) => readEditionRows(scope, { institutionId: options.institutionId, today }));
  } catch (error) {
    console.warn("[darwin] edition effective check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const found = judgeEditions(rows, today);
  const lateOnly = EDITION_LATE_HEADING_LIVE ? [] : lateHeadingOnly(found, judgeEditions(rows, today, true));
  Object.assign(result, {
    checked: found.checked, holds: found.holds.length, restores: found.restores.length, takeovers: found.takeovers.length,
    institutions: found.institutions,
    samples: [...found.holds, ...found.takeovers, ...found.restores].slice(0, EDITION_CHECK_SAMPLES),
    lateHeadingWouldHold: lateOnly.length,
    lateHeadingSamples: lateOnly.slice(0, EDITION_CHECK_SAMPLES),
  });
  if (!live || options.dryRun) return result;
  const batchId = `darwin-edition-${options.runId}`;
  try {
    await inSavepoint(db, async (scope) => {
      result.held = await rollBack(scope, batchId, found.holds);
      result.restored = await restore(scope, found.restores);
      result.retired = await rollBack(scope, batchId, found.takeovers);
      const rejected = found.takeovers.filter((fee) => result.retired.includes(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (rejected.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${OLDER_EDITION_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${OLDER_EDITION_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${rejected.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${EDITION_CHECK}, 'completed',
          ${`Schedule editions on ${today}: held ${result.held.length} live fee(s) from schedules not yet in effect, restored ${result.restored.length} now in effect, retired ${result.retired.length} older-edition line(s)`},
          ${JSON.stringify(editionCheckDetail(result))}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("[darwin] edition effective check write failed", error instanceof Error ? error.message : error);
    return { ...result, held: [], restored: [], retired: [] };
  }
  if (result.held.length + result.restored.length + result.retired.length > 0) invalidatePublicReadCache();
  return result;
}

async function rollBack(db: SqlTag, batchId: string, fees: EditionAction[]): Promise<number[]> {
  if (fees.length === 0) return [];
  const updated = await db<{ fee_published_id: number | string }[]>`
    UPDATE published_fee_records fp
       SET rolled_back_at = NOW(), rolled_back_by_batch_id = ${batchId}, rolled_back_reason = v.reason
      FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[]) AS v(fee_published_id, reason)
     WHERE fp.fee_published_id = v.fee_published_id
       AND fp.rolled_back_at IS NULL
    RETURNING fp.fee_published_id
  `;
  return updated.map((row) => Number(row.fee_published_id));
}

/** Clears this check's own hold, never another rollback, and never beside a live row of the same verified fee. */
async function restore(db: SqlTag, fees: EditionAction[]): Promise<number[]> {
  if (fees.length === 0) return [];
  const updated = await db<{ fee_published_id: number | string }[]>`
    UPDATE published_fee_records fp
       SET rolled_back_at = NULL, rolled_back_by_batch_id = NULL, rolled_back_reason = NULL
     WHERE fp.fee_published_id = ANY(${fees.map((fee) => fee.feePublishedId)}::bigint[])
       AND fp.rolled_back_at IS NOT NULL
       AND fp.rolled_back_reason LIKE ${`${NOT_YET_EFFECTIVE_REASON}:%`}
       AND NOT EXISTS (
         SELECT 1 FROM published_fee_records other
          WHERE other.lineage_ref = fp.lineage_ref AND other.rolled_back_at IS NULL
       )
    RETURNING fp.fee_published_id
  `;
  return updated.map((row) => Number(row.fee_published_id));
}

/** The step's detail for the run ledger. */
export function editionCheckDetail(result: EditionCheckResult) {
  return {
    check: EDITION_CHECK,
    version: EDITION_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    today: result.today,
    checked: result.checked,
    would_hold: result.holds,
    would_restore: result.restores,
    would_retire_older_edition: result.takeovers,
    institutions: result.institutions,
    held: result.held,
    restored: result.restored,
    retired: result.retired,
    samples: result.samples,
    late_heading_live: result.lateHeadingLive,
    late_heading_would_hold: result.lateHeadingWouldHold,
    late_heading_samples: result.lateHeadingSamples,
  };
}
