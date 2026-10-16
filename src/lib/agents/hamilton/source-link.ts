import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Every live fee links to the bank's own document (#1342). On Oct 15, 1,338 live catalog fees had
 * no source URL at any tier, all rows the April import (`raw_fee_observations.source =
 * 'migration_v10'`) wrote without a URL, published from Apr 18 to Aug 12. Nearly all name their own
 * `source_documents` row, which has the URL; 11 name no document at all. The institution page
 * showed the institution's general schedule link for them, or a dash. The publish rule still
 * accepted a stored file key with no link as lineage.
 *
 * Prevent: publish refuses a fee with no source document or no link (`sourceLinkSkipReason`), and
 * writes the document's URL when the verified row has none (`publishSourceLink`).
 * Repair (`repairSourceLinks`, step `source-link-repair`, started by hand, dry run first): a live
 * fee with no link takes its own document's URL when that document is the institution's and,
 * when the fee carries a stored file key, the same file. Any other is taken down with
 * `rolled_back_reason = 'source_link_untraceable: <why>'`. Every change is one `pipeline_feedback`
 * row (check `hamilton.source_link`), so it is reversed row by row: a fill by setting
 * `source_url` back to NULL (and the verified row's when `verified_filled`), a takedown by
 * clearing `rolled_back_at`, `rolled_back_by_batch_id` and `rolled_back_reason`.
 */
export const SOURCE_LINK_CHECK = "hamilton.source_link";
export const SOURCE_LINK_VERSION = 1;
export const SOURCE_LINK_TAKEDOWN_REASON = "source_link_untraceable";
export const SOURCE_LINK_REPAIR_LIMIT = 5_000;

/** The publish refusal for a fee that cannot be traced to the bank's document. */
export const NO_SOURCE_DOCUMENT_REASON = "No source document: the fee can't be traced to the bank's document";
export const NO_SOURCE_LINK_REASON = "No source link: the fee can't be traced to the bank's document";

function httpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/** The link a published fee carries: the verified row's own URL, else its source document's. */
export function publishSourceLink(row: { source_url?: string | null; document_url?: string | null }): string | null {
  return httpUrl(row.source_url) ?? httpUrl(row.document_url);
}

/**
 * Pure: why a fee may not publish for want of a source, or null. A row that names its document
 * field as null has none; a row read without that field (`undefined`) is judged on its link only.
 */
export function sourceLinkSkipReason(row: {
  source_url?: string | null;
  document_url?: string | null;
  source_document_id?: number | string | null;
}): string | null {
  if (row.source_document_id === null) return NO_SOURCE_DOCUMENT_REASON;
  if (!publishSourceLink(row)) return NO_SOURCE_LINK_REASON;
  return null;
}

export interface UnlinkedLiveFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  fee_raw_id: number | string | null;
  institution_id: number | string;
  canonical_fee_key: string;
  amount: number | string | null;
  /** The raw row's document; null when it names none. */
  source_document_id: number | string | null;
  document_institution_id: number | string | null;
  document_url: string | null;
  document_r2_key: string | null;
  /** The stored file key the fee itself carries (published, verified or raw tier). */
  fee_r2_key: string | null;
  /** True when the verified row has no URL either, so it takes the same fill. */
  verified_blank: boolean | null;
}

export interface SourceLinkFill {
  feePublishedId: number;
  feeVerifiedId: number | null;
  feeRawId: number | null;
  institutionId: number;
  sourceDocumentId: number;
  canonicalFeeKey: string;
  amount: number | null;
  url: string;
  verifiedBlank: boolean;
}

export interface SourceLinkTakedown {
  feePublishedId: number;
  feeVerifiedId: number | null;
  feeRawId: number | null;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  amount: number | null;
  reason: string;
}

export interface SourceLinkPlan {
  fills: SourceLinkFill[];
  takedowns: SourceLinkTakedown[];
}

function num(value: number | string | null | undefined): number | null {
  return value == null || value === "" ? null : Number(value);
}

/** Pure: why a live fee's own document cannot give it a link, or null when it can. */
export function untraceableWhy(row: UnlinkedLiveFeeRow): string | null {
  if (row.source_document_id == null) return "no source document";
  if (row.document_institution_id == null || Number(row.document_institution_id) !== Number(row.institution_id)) {
    return "source document belongs to another institution";
  }
  if (!httpUrl(row.document_url)) return "source document has no URL";
  const feeKey = row.fee_r2_key?.trim();
  if (feeKey && feeKey !== row.document_r2_key?.trim()) return "stored file differs from the source document's";
  return null;
}

/** Pure: the fill or takedown for each live fee with no link. */
export function planSourceLinkRepair(rows: UnlinkedLiveFeeRow[]): SourceLinkPlan {
  const plan: SourceLinkPlan = { fills: [], takedowns: [] };
  for (const row of rows) {
    const base = {
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      feeRawId: num(row.fee_raw_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      amount: num(row.amount),
    };
    const why = untraceableWhy(row);
    if (why) {
      plan.takedowns.push({ ...base, sourceDocumentId: num(row.source_document_id), reason: `${SOURCE_LINK_TAKEDOWN_REASON}: ${why}` });
    } else {
      plan.fills.push({
        ...base,
        sourceDocumentId: Number(row.source_document_id),
        url: httpUrl(row.document_url)!,
        verifiedBlank: Boolean(row.verified_blank),
      });
    }
  }
  return plan;
}

export interface SourceLinkRepairResult extends SourceLinkPlan {
  scanned: number;
  dryRun: boolean;
}

/** Pure: one rollback record per changed row (`pipeline_feedback`, check `hamilton.source_link`). */
export function sourceLinkRecords(plan: SourceLinkPlan, runId: number, batchId: string): FeedbackRow[] {
  return [
    ...plan.fills.map((fee): FeedbackRow => ({
      aboutStage: "publish",
      signal: "wrong",
      kind: "missing_lineage",
      reportedBy: "gutenberg",
      checkName: SOURCE_LINK_CHECK,
      aboutVersion: SOURCE_LINK_VERSION,
      institutionId: fee.institutionId,
      sourceDocumentId: fee.sourceDocumentId,
      sourceUrl: fee.url,
      feeRawId: fee.feeRawId,
      feeVerifiedId: fee.feeVerifiedId,
      feePublishedId: fee.feePublishedId,
      canonicalFeeKey: fee.canonicalFeeKey,
      amount: fee.amount,
      evidence: { action: "filled", from: null, to: fee.url, verified_filled: fee.verifiedBlank, batch_id: batchId },
      runId,
      dedupeKey: `${SOURCE_LINK_CHECK}:fill:${fee.feePublishedId}`,
    })),
    ...plan.takedowns.map((fee): FeedbackRow => ({
      aboutStage: "publish",
      signal: "wrong",
      kind: "missing_lineage",
      reportedBy: "gutenberg",
      checkName: SOURCE_LINK_CHECK,
      aboutVersion: SOURCE_LINK_VERSION,
      institutionId: fee.institutionId,
      sourceDocumentId: fee.sourceDocumentId,
      feeRawId: fee.feeRawId,
      feeVerifiedId: fee.feeVerifiedId,
      feePublishedId: fee.feePublishedId,
      canonicalFeeKey: fee.canonicalFeeKey,
      amount: fee.amount,
      evidence: { action: "taken_down", reason: fee.reason, batch_id: batchId },
      runId,
      dedupeKey: `${SOURCE_LINK_CHECK}:takedown:${fee.feePublishedId}`,
    })),
  ];
}

/** Live published rows with no source URL at any tier, with their own document. */
export const UNLINKED_LIVE_FEES_SQL = `
  SELECT fp.fee_published_id, fv.fee_verified_id, fr.fee_raw_id, fp.institution_id, fp.canonical_fee_key, fp.amount,
         fr.source_document_id, sd.institution_id AS document_institution_id, sd.document_url,
         sd.document_r2_key,
         NULLIF(btrim(COALESCE(fp.document_r2_key, fv.document_r2_key, fr.document_r2_key)), '') AS fee_r2_key,
         (fv.fee_verified_id IS NOT NULL AND NULLIF(btrim(fv.source_url), '') IS NULL) AS verified_blank
    FROM published_fee_records fp
    LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
    LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
   WHERE fp.rolled_back_at IS NULL
     AND fp.quarantined_at IS NULL
     AND NULLIF(btrim(COALESCE(fp.source_url, fv.source_url, fr.source_url)), '') IS NULL`;

/**
 * Gives each live fee with no link its own document's URL, or takes it down when it has no
 * traceable document. A dry run reports and writes nothing. A live write that fails throws, so
 * the step fails with the error and its transaction rolls back (#1349).
 */
export async function repairSourceLinks(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<SourceLinkRepairResult> {
  const limit = Math.max(1, Math.min(options.limit ?? SOURCE_LINK_REPAIR_LIMIT, 10_000));
  const result: SourceLinkRepairResult = { scanned: 0, fills: [], takedowns: [], dryRun: options.dryRun };
  let rows: UnlinkedLiveFeeRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<UnlinkedLiveFeeRow[]>(
      `${UNLINKED_LIVE_FEES_SQL}
       ${options.institutionId ? "AND fp.institution_id = $2" : ""}
       ORDER BY fp.fee_published_id
       LIMIT $1`,
      options.institutionId ? [limit, options.institutionId] : [limit],
    ));
  } catch (error) {
    console.error("repairSourceLinks read failed:", error);
    return result;
  }
  result.scanned = rows.length;
  const plan = planSourceLinkRepair(rows);
  if (options.dryRun) return { ...result, ...plan };

  try {
    const written = await inSavepoint(db, async (scope) => {
      let fills: SourceLinkFill[] = [];
      if (plan.fills.length > 0) {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET source_url = v.url
            FROM unnest(${plan.fills.map((fee) => fee.feePublishedId)}::bigint[], ${plan.fills.map((fee) => fee.url)}::text[])
                 AS v(fee_published_id, url)
           WHERE fp.fee_published_id = v.fee_published_id
             AND NULLIF(btrim(fp.source_url), '') IS NULL
             AND fp.rolled_back_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        fills = plan.fills.filter((fee) => ids.has(fee.feePublishedId));
        // The verified row takes the same link, so a republish or refresh keeps it.
        const verified = fills.filter((fee) => fee.verifiedBlank && fee.feeVerifiedId != null);
        if (verified.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET source_url = v.url
              FROM unnest(${verified.map((fee) => fee.feeVerifiedId!)}::bigint[], ${verified.map((fee) => fee.url)}::text[])
                   AS v(fee_verified_id, url)
             WHERE fv.fee_verified_id = v.fee_verified_id
               AND NULLIF(btrim(fv.source_url), '') IS NULL
          `;
        }
      }
      let takedowns: SourceLinkTakedown[] = [];
      if (plan.takedowns.length > 0) {
        const closed = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = v.reason
            FROM unnest(${plan.takedowns.map((fee) => fee.feePublishedId)}::bigint[], ${plan.takedowns.map((fee) => fee.reason)}::text[])
                 AS v(fee_published_id, reason)
           WHERE fp.fee_published_id = v.fee_published_id
             AND NULLIF(btrim(fp.source_url), '') IS NULL
             AND fp.rolled_back_at IS NULL
             AND fp.quarantined_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(closed.map((row) => Number(row.fee_published_id)));
        takedowns = plan.takedowns.filter((fee) => ids.has(fee.feePublishedId));
      }
      // The rollback records are written with the change, or neither is.
      await recordFeedback(scope as SqlTag, sourceLinkRecords({ fills, takedowns }, options.runId, options.batchId));
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.source_link_repair', 'completed',
          ${`Linked ${fills.length} live fee(s) to their own document; took down ${takedowns.length} with no traceable document`},
          ${JSON.stringify({
            batch_id: options.batchId,
            version: SOURCE_LINK_VERSION,
            scanned: rows.length,
            filled: fills.length,
            taken_down: takedowns.length,
            takedowns: takedowns.map((fee) => ({ fee_published_id: fee.feePublishedId, reason: fee.reason })),
          })}::jsonb
        )
      `;
      return { fills, takedowns };
    });
    result.fills = written.fills;
    result.takedowns = written.takedowns;
  } catch (error) {
    // #1349: a failed live write fails the step (the run's transaction rolls back), never a
    // "completed" step that reads as "Linked 0 of ...".
    throw new Error(`source link repair write failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  if (result.fills.length > 0 || result.takedowns.length > 0) invalidatePublicReadCache();
  return result;
}
