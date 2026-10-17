import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { markRestoredForSourceCheck } from "@/lib/agents/hamilton/source-check";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

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
 * Re-source first (v2, #1342, `resourceSourceLinks` below): a fee with no traceable document
 * that a stored document of its own institution prints is linked to it, or restored if it was down.
 * Repair (`repairSourceLinks`, step `source-link-repair`, started by hand, dry run first): a live
 * fee with no link takes its own document's URL when that document is the institution's and,
 * when the fee carries a stored file key, the same file. Any other is taken down with
 * `rolled_back_reason = 'source_link_untraceable: <why>'`. Every change is one `pipeline_feedback`
 * row (check `hamilton.source_link`), so it is reversed row by row: a fill by setting
 * `source_url` back to NULL (and the verified row's when `verified_filled`), a takedown by
 * clearing `rolled_back_at`, `rolled_back_by_batch_id` and `rolled_back_reason`.
 */
export const SOURCE_LINK_CHECK = "hamilton.source_link";
/** v2 (#1342 re-source): a fee with no traceable document is first matched to a stored one. */
export const SOURCE_LINK_VERSION = 2;
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
  /** #1342: fees linked to, or restored from, a stored document of their own institution first. */
  resourced: SourceLinkResource[];
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
     -- Implied by the next line; filters the published rows first (60 ms instead of 390 ms, Oct 17).
     AND NULLIF(btrim(fp.source_url), '') IS NULL
     AND NULLIF(btrim(COALESCE(fp.source_url, fv.source_url, fr.source_url)), '') IS NULL`;

/** Writes each fill to the published row (and the verified row when it has no link). Returns those written. */
async function writeSourceLinkFills(scope: SqlTag, planned: SourceLinkFill[]): Promise<SourceLinkFill[]> {
  if (planned.length === 0) return [];
  const updated = await scope<{ fee_published_id: number | string }[]>`
    UPDATE published_fee_records fp
       SET source_url = v.url
      FROM unnest(${planned.map((fee) => fee.feePublishedId)}::bigint[], ${planned.map((fee) => fee.url)}::text[])
           AS v(fee_published_id, url)
     WHERE fp.fee_published_id = v.fee_published_id
       AND NULLIF(btrim(fp.source_url), '') IS NULL
       AND fp.rolled_back_at IS NULL
    RETURNING fp.fee_published_id
  `;
  const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
  const fills = planned.filter((fee) => ids.has(fee.feePublishedId));
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
  return fills;
}

/**
 * #1342 follow-up: the fill half of the repair, in every publish step. The repair ran once by
 * hand (run 6508, Oct 15). Fees down at that moment and restored later (the source check's
 * restore, `hamilton.restore`) came back live with no link: 14 on Oct 17, all imported rows, 13
 * of them naming a document of their own institution with a link. Each such fee takes its own
 * document's URL, exactly as the repair would give it (`planSourceLinkRepair`). This pass never
 * takes a fee down, holds it or changes its category: a fee with no traceable document stays live
 * and waits for the re-source pass or the hand-started repair. Every fill is one `pipeline_feedback`
 * row (check `hamilton.source_link`, action `filled`), undone by setting `source_url` back to NULL.
 * A dry run reports and writes nothing. A failed read or write changes nothing and is returned as
 * `error`, so the publish step carries on without the pass.
 *
 * Rollback: set SOURCE_LINK_FILL_ON to false.
 */
export const SOURCE_LINK_FILL_ON = true;
export const SOURCE_LINK_FILL_LIMIT = 500;

export interface SourceLinkFillResult {
  on: boolean;
  dryRun: boolean;
  /** Live fees with no link at any tier that this pass read. */
  scanned: number;
  /** Fills made (live) or planned (dry run). */
  fills: SourceLinkFill[];
  /** Live fees with no link whose own document cannot give one; left for the repair. */
  untraceable: number;
  error: string | null;
}

export async function fillSourceLinks(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<SourceLinkFillResult> {
  const result: SourceLinkFillResult = { on: SOURCE_LINK_FILL_ON, dryRun: options.dryRun, scanned: 0, fills: [], untraceable: 0, error: null };
  if (!SOURCE_LINK_FILL_ON) return result;
  const limit = Math.max(1, Math.min(options.limit ?? SOURCE_LINK_FILL_LIMIT, 2_000));
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
    console.error("fillSourceLinks read failed:", error);
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
  result.scanned = rows.length;
  const plan = planSourceLinkRepair(rows);
  result.untraceable = plan.takedowns.length;
  if (options.dryRun || plan.fills.length === 0) return { ...result, fills: plan.fills };

  try {
    result.fills = await inSavepoint(db, async (scope) => {
      const fills = await writeSourceLinkFills(scope, plan.fills);
      if (fills.length === 0) return fills;
      // The rollback records are written with the change, or neither is.
      await recordFeedback(scope as SqlTag, sourceLinkRecords({ fills, takedowns: [] }, options.runId, options.batchId));
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.source_link_fill', 'completed',
          ${`Linked ${fills.length} live fee(s) with no link to their own document`},
          ${JSON.stringify({
            batch_id: options.batchId,
            version: SOURCE_LINK_VERSION,
            scanned: rows.length,
            filled: fills.length,
            untraceable_left_live: plan.takedowns.length,
            fills: fills.map((fee) => ({ fee_published_id: fee.feePublishedId, source_document_id: fee.sourceDocumentId, url: fee.url })),
          })}::jsonb
        )
      `;
      return fills;
    });
  } catch (error) {
    console.error("fillSourceLinks write failed:", error);
    result.error = error instanceof Error ? error.message : String(error);
    result.fills = [];
    return result;
  }
  if (result.fills.length > 0) invalidatePublicReadCache();
  return result;
}

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
  const result: SourceLinkRepairResult = { scanned: 0, fills: [], takedowns: [], resourced: [], dryRun: options.dryRun };
  // #1342: a fee a stored document of its own institution prints is linked to it (or put back)
  // before anything is taken down as untraceable.
  const resource = await resourceSourceLinks(db, {
    runId: options.runId,
    batchId: options.batchId,
    dryRun: options.dryRun,
    institutionId: options.institutionId,
  });
  // #1349: a failed write fails the hand-started step, never a "completed" step that hides it.
  if (resource.error) throw new Error(resource.error);
  result.resourced = resource.resources;
  const resourcedIds = new Set(resource.resources.map((fee) => fee.feePublishedId));
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
  // A live run has written those links already; a dry run leaves its would-be links out here.
  rows = rows.filter((row) => !resourcedIds.has(Number(row.fee_published_id)));
  result.scanned = rows.length;
  const plan = planSourceLinkRepair(rows);
  if (options.dryRun) return { ...result, ...plan };

  try {
    const written = await inSavepoint(db, async (scope) => {
      const fills = await writeSourceLinkFills(scope, plan.fills);
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

/**
 * #1342 re-source (James, Oct 16: "they need to be resourced and then find the ones that we
 * can't find"). The repair of Oct 15 (run 6508) took down 13 imported fees whose raw row names no
 * document; 9 of them are printed, at the same amount, in a document already stored for the same
 * institution. Before a fee comes down as untraceable, and for every fee already down as
 * `source_link_untraceable`, this looks for a stored document of the fee's own institution
 * whose newest text is completed and states the fee's name at its amount under the shared
 * `checkFeeAgainstSource`. Found: the raw row takes that document (`source_document_id`, and its
 * URL when it has none), the published and verified rows take its URL when they have none, and a
 * fee that was down comes back live (rollback fields cleared, queued for the source check like
 * every restore). Not found: nothing changes, and the repair takes it down as before.
 *
 * Only an imported fee is re-sourced: a Knox fee answers to the document Knox read it from
 * (`traceLiveFee`). A document of another institution, one replaced by a newer copy, one whose
 * newest text is not completed, one with no http(s) link, one that holds another imported row of
 * the same name (the import's unique key), or one whose file differs from the file the fee
 * carries, never matches. A fee whose name and price are already live at the institution stays
 * down. Every change is one `pipeline_feedback` row (check `hamilton.source_link`, action
 * `resourced` or `restored`) naming the earlier document, so it is undone row by row.
 *
 * Rollback: set this to false; the repair then takes such fees down as before and the publish
 * step skips the pass.
 */
export const SOURCE_LINK_RESOURCE_ON = true;
export const SOURCE_LINK_RESOURCE_LIMIT = 500;

export interface ResourceCandidateRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  fee_raw_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  amount_kind?: string | null;
  rate_percent?: number | string | null;
  /** The raw row's source; only an imported (not Knox) fee is re-sourced. */
  source: string | null;
  /** The raw row's document today (null, another institution's, or one with no link). */
  source_document_id: number | string | null;
  /** The stored file key the fee itself carries, at any tier. */
  fee_r2_key: string | null;
  /** The raw row's own document, when it names one. */
  document_institution_id: number | string | null;
  document_url: string | null;
  document_r2_key: string | null;
  /** True when the fee is down as `source_link_untraceable`, so a match restores it. */
  taken_down: boolean;
  rolled_back_reason: string | null;
  verified_blank: boolean | null;
  raw_url_blank: boolean | null;
  /** Documents already holding another raw row of the same source and name. */
  taken_document_ids: Array<number | string> | null;
  /** True when a live row of the institution already shows this name at this price and category. */
  same_fee_live: boolean | null;
}

export interface InstitutionDocumentText {
  source_document_id: number | string;
  institution_id: number | string;
  document_url: string | null;
  document_r2_key: string | null;
  /** True when a newer copy replaced this document. */
  superseded: boolean | null;
  /** The status of the document's newest text. */
  status: string | null;
  normalized_text: string | null;
}

export interface SourceLinkResource {
  feePublishedId: number;
  feeVerifiedId: number;
  feeRawId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number;
  fromDocumentId: number | null;
  sourceDocumentId: number;
  url: string;
  sourceLine: string | null;
  restore: boolean;
  previousReason: string | null;
  verifiedBlank: boolean;
  rawUrlBlank: boolean;
}

export interface SourceLinkResourceMiss {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  amount: number | null;
  takenDown: boolean;
  why: string;
}

/**
 * Pure: another stored document of the fee's own institution that prints it, or why there is
 * none. Newest document first. The fee's own document is never re-sourced: it is the reason the
 * fee has no traceable document.
 */
export function findResourceDocument(
  fee: ResourceCandidateRow,
  texts: InstitutionDocumentText[],
): { sourceDocumentId: number; url: string; sourceLine: string | null } | { why: string } {
  if (fee.source === "knox") return { why: "knox_fee" };
  if (fee.amount == null || fee.amount === "" || fee.rate_percent != null || fee.amount_kind === "percent") return { why: "no_dollar_amount" };
  const amount = Number(fee.amount);
  if (!Number.isFinite(amount) || amount < 0) return { why: "no_dollar_amount" };
  const taken = new Set((fee.taken_document_ids ?? []).map(Number));
  const own = num(fee.source_document_id);
  const feeKey = fee.fee_r2_key?.trim() || null;
  const ordered = [...texts].sort((a, b) => Number(b.source_document_id) - Number(a.source_document_id));
  let why = "no_stored_document";
  for (const text of ordered) {
    const documentId = Number(text.source_document_id);
    if (Number(text.institution_id) !== Number(fee.institution_id)) continue;
    if (text.status !== "completed" || !text.normalized_text?.trim()) continue;
    if (text.superseded) continue;
    const url = httpUrl(text.document_url);
    if (!url) continue;
    if (documentId === own) continue;
    if (taken.has(documentId)) {
      // The import keeps one row per (source, document, name): this document already holds one.
      if (why === "no_stored_document") why = "document_holds_same_name_import";
      continue;
    }
    if (feeKey && feeKey !== text.document_r2_key?.trim()) continue;
    const verdict = checkFeeAgainstSource(text.normalized_text, fee.fee_name, amount, ".", fee.canonical_fee_key);
    if (verdict.ok) return { sourceDocumentId: documentId, url, sourceLine: verdict.sourceLine ?? null };
    why = `not_in_stored_documents:${verdict.reason}`;
  }
  return { why };
}

/** Pure: the re-source for each candidate, or why it has none. */
export function planSourceLinkResource(
  rows: ResourceCandidateRow[],
  texts: InstitutionDocumentText[],
): { resources: SourceLinkResource[]; misses: SourceLinkResourceMiss[] } {
  const byInstitution = new Map<number, InstitutionDocumentText[]>();
  for (const text of texts) {
    const id = Number(text.institution_id);
    byInstitution.set(id, [...(byInstitution.get(id) ?? []), text]);
  }
  const resources: SourceLinkResource[] = [];
  const misses: SourceLinkResourceMiss[] = [];
  // One imported row per (document, source, name): two fees of one name never take one document.
  const claimed = new Map<string, number[]>();
  for (const row of rows) {
    // A live fee its own document can link is the repair's fill, not a re-source.
    if (!row.taken_down && untraceableWhy(row) == null) continue;
    const institutionId = Number(row.institution_id);
    const miss = (why: string) => misses.push({
      feePublishedId: Number(row.fee_published_id),
      institutionId,
      canonicalFeeKey: row.canonical_fee_key,
      amount: num(row.amount),
      takenDown: Boolean(row.taken_down),
      why,
    });
    if (row.taken_down && row.same_fee_live) {
      miss("same_fee_live");
      continue;
    }
    const nameKey = `${row.source ?? ""}:${row.fee_name}`;
    const found = findResourceDocument(
      { ...row, taken_document_ids: [...(row.taken_document_ids ?? []), ...(claimed.get(nameKey) ?? [])] },
      byInstitution.get(institutionId) ?? [],
    );
    if ("why" in found) {
      miss(found.why);
      continue;
    }
    claimed.set(nameKey, [...(claimed.get(nameKey) ?? []), found.sourceDocumentId]);
    resources.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.fee_verified_id),
      feeRawId: Number(row.fee_raw_id),
      institutionId,
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount: Number(row.amount),
      fromDocumentId: num(row.source_document_id),
      sourceDocumentId: found.sourceDocumentId,
      url: found.url,
      sourceLine: found.sourceLine,
      restore: Boolean(row.taken_down),
      previousReason: row.taken_down ? row.rolled_back_reason : null,
      verifiedBlank: Boolean(row.verified_blank),
      rawUrlBlank: Boolean(row.raw_url_blank),
    });
  }
  return { resources, misses };
}

/** Pure: one rollback record per re-sourced fee (`pipeline_feedback`, check `hamilton.source_link`). */
export function sourceLinkResourceRecords(resources: SourceLinkResource[], runId: number, batchId: string): FeedbackRow[] {
  return resources.map((fee): FeedbackRow => ({
    aboutStage: "publish",
    signal: fee.restore ? "restored" : "wrong",
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
    evidence: {
      action: fee.restore ? "restored" : "resourced",
      previous_reason: fee.previousReason,
      from_source_document_id: fee.fromDocumentId,
      to_source_document_id: fee.sourceDocumentId,
      url: fee.url,
      source_line: fee.sourceLine,
      fee_name: fee.feeName,
      verified_filled: fee.verifiedBlank,
      raw_url_filled: fee.rawUrlBlank,
      batch_id: batchId,
    },
    runId,
    dedupeKey: `${SOURCE_LINK_CHECK}:${fee.restore ? "restore" : "resource"}:${fee.feePublishedId}`,
  }));
}

/** Imported live fees with no link, and fees down as `source_link_untraceable`. */
export const RESOURCE_CANDIDATES_SQL = `
  SELECT fp.fee_published_id, fv.fee_verified_id, fr.fee_raw_id, fp.institution_id, fp.canonical_fee_key,
         fp.fee_name, fp.amount, fp.amount_kind, fp.rate_percent, fr.source, fr.source_document_id,
         sd.institution_id AS document_institution_id, sd.document_url, sd.document_r2_key,
         NULLIF(btrim(COALESCE(fp.document_r2_key, fv.document_r2_key, fr.document_r2_key)), '') AS fee_r2_key,
         (fp.rolled_back_at IS NOT NULL) AS taken_down, fp.rolled_back_reason,
         (NULLIF(btrim(fv.source_url), '') IS NULL) AS verified_blank,
         (NULLIF(btrim(fr.source_url), '') IS NULL) AS raw_url_blank,
         ARRAY(
           SELECT other.source_document_id FROM raw_fee_observations other
            WHERE other.institution_id = fr.institution_id
              AND other.source = fr.source
              AND other.fee_name = fr.fee_name
              AND other.fee_raw_id <> fr.fee_raw_id
              AND other.source_document_id IS NOT NULL
         ) AS taken_document_ids,
         EXISTS (
           SELECT 1 FROM published_fee_records live
            WHERE live.rolled_back_at IS NULL
              AND live.quarantined_at IS NULL
              AND live.institution_id = fp.institution_id
              AND live.canonical_fee_key = fp.canonical_fee_key
              AND live.amount IS NOT DISTINCT FROM fp.amount
              AND lower(btrim(live.fee_name)) = lower(btrim(fp.fee_name))
              AND live.fee_published_id <> fp.fee_published_id
         ) AS same_fee_live
    FROM published_fee_records fp
    JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
    LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
    JOIN institution_sources inst ON inst.id = fp.institution_id
   WHERE fp.quarantined_at IS NULL
     AND fr.source <> 'knox'
     AND (
       (fp.rolled_back_at IS NULL AND NULLIF(btrim(COALESCE(fp.source_url, fv.source_url, fr.source_url)), '') IS NULL)
       OR (fp.rolled_back_at IS NOT NULL
           AND fp.rolled_back_reason LIKE '${SOURCE_LINK_TAKEDOWN_REASON}:%'
           AND COALESCE(fv.review_status, '') <> 'rejected')
     )
     AND ($2::bigint IS NULL OR fp.institution_id = $2::bigint)
     AND ($3::text IS NULL OR upper(btrim(inst.state_code)) = $3::text)
   ORDER BY fp.fee_published_id
   LIMIT $1`;

/** Each stored document of these institutions, with its newest text whatever its status. */
export const INSTITUTION_DOCUMENT_TEXTS_SQL = `
  SELECT sd.id AS source_document_id, sd.institution_id, sd.document_url, sd.document_r2_key,
         (sd.superseded_by_id IS NOT NULL AND sd.superseded_by_id <> sd.id) AS superseded,
         newest.status, newest.normalized_text
    FROM source_documents sd
    JOIN LATERAL (
      SELECT ast.status, ast.normalized_text
        FROM agent_source_texts ast
       WHERE ast.source_document_id = sd.id
       ORDER BY ast.id DESC
       LIMIT 1
    ) newest ON TRUE
   WHERE sd.institution_id = ANY($1::bigint[])`;

export interface SourceLinkResourceResult {
  candidates: number;
  resources: SourceLinkResource[];
  misses: SourceLinkResourceMiss[];
  linked: number;
  restored: number;
  dryRun: boolean;
  on: boolean;
  /** A live write that failed and was rolled back (the publish step carries on without it). */
  error: string | null;
}

/**
 * Re-sources imported fees with no traceable document from a stored document of their own
 * institution that prints them, and restores those the repair already took down. Runs in every
 * publish step (19 candidates and a 0.39 s read on Oct 16) and before the repair's
 * takedowns. A dry run reports and writes nothing. A failed read changes nothing. A failed write
 * is rolled back with its savepoint and returned as `error`: the publish step carries on without
 * the pass, and the hand repair fails on it (#1349).
 */
export async function resourceSourceLinks(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; stateCode?: string | null; limit?: number },
): Promise<SourceLinkResourceResult> {
  const result: SourceLinkResourceResult = {
    candidates: 0, resources: [], misses: [], linked: 0, restored: 0, dryRun: options.dryRun, on: SOURCE_LINK_RESOURCE_ON, error: null,
  };
  if (!SOURCE_LINK_RESOURCE_ON) return result;
  const limit = Math.max(1, Math.min(options.limit ?? SOURCE_LINK_RESOURCE_LIMIT, 2_000));
  let rows: ResourceCandidateRow[];
  let texts: InstitutionDocumentText[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<ResourceCandidateRow[]>(
      RESOURCE_CANDIDATES_SQL,
      [limit, options.institutionId ?? null, options.stateCode?.trim().toUpperCase() || null],
    ));
    const institutions = [...new Set(rows.map((row) => Number(row.institution_id)))];
    texts = institutions.length === 0
      ? []
      : await inSavepoint(db, (scope) => scope.unsafe<InstitutionDocumentText[]>(INSTITUTION_DOCUMENT_TEXTS_SQL, [institutions]));
  } catch (error) {
    console.error("resourceSourceLinks read failed:", error);
    return result;
  }
  result.candidates = rows.length;
  const plan = planSourceLinkResource(rows, texts);
  result.resources = plan.resources;
  result.misses = plan.misses;
  if (options.dryRun || plan.resources.length === 0) return result;

  try {
    const written = await inSavepoint(db, async (scope) => {
      // The raw row takes the document first. The import's unique key (source, document, name)
      // is checked again here; a fee whose row cannot move is left as it was.
      const moved = await scope<{ fee_raw_id: number | string }[]>`
        UPDATE raw_fee_observations fr
           SET source_document_id = v.source_document_id,
               source_url = COALESCE(NULLIF(btrim(fr.source_url), ''), v.url)
          FROM unnest(
                 ${plan.resources.map((fee) => fee.feeRawId)}::bigint[],
                 ${plan.resources.map((fee) => fee.sourceDocumentId)}::bigint[],
                 ${plan.resources.map((fee) => fee.url)}::text[],
                 ${plan.resources.map((fee) => fee.fromDocumentId)}::bigint[]
               ) AS v(fee_raw_id, source_document_id, url, from_document_id)
         WHERE fr.fee_raw_id = v.fee_raw_id
           AND fr.source <> 'knox'
           AND fr.source_document_id IS NOT DISTINCT FROM v.from_document_id
           AND NOT EXISTS (
             SELECT 1 FROM raw_fee_observations other
              WHERE other.source = fr.source
                AND other.source_document_id = v.source_document_id
                AND other.fee_name = fr.fee_name
                AND other.fee_raw_id <> fr.fee_raw_id
           )
        RETURNING fr.fee_raw_id
      `;
      const movedIds = new Set(moved.map((row) => Number(row.fee_raw_id)));
      const ready = plan.resources.filter((fee) => movedIds.has(fee.feeRawId));
      const live = ready.filter((fee) => !fee.restore);
      const down = ready.filter((fee) => fee.restore);

      let linked: SourceLinkResource[] = [];
      if (live.length > 0) {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET source_url = v.url
            FROM unnest(${live.map((fee) => fee.feePublishedId)}::bigint[], ${live.map((fee) => fee.url)}::text[])
                 AS v(fee_published_id, url)
           WHERE fp.fee_published_id = v.fee_published_id
             AND NULLIF(btrim(fp.source_url), '') IS NULL
             AND fp.rolled_back_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        linked = live.filter((fee) => ids.has(fee.feePublishedId));
      }
      let restored: SourceLinkResource[] = [];
      if (down.length > 0) {
        // The codebase's restore: clear the rollback, never a second live copy of the same fee.
        const back = await scope<{ fee_published_id: number | string; institution_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NULL,
                 rolled_back_by_batch_id = NULL,
                 rolled_back_reason = NULL,
                 source_url = COALESCE(NULLIF(btrim(fp.source_url), ''), v.url)
            FROM unnest(${down.map((fee) => fee.feePublishedId)}::bigint[], ${down.map((fee) => fee.url)}::text[])
                 AS v(fee_published_id, url)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.rolled_back_reason LIKE ${`${SOURCE_LINK_TAKEDOWN_REASON}:%`}
             AND fp.quarantined_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM published_fee_records live
                WHERE live.rolled_back_at IS NULL
                  AND live.quarantined_at IS NULL
                  AND live.institution_id = fp.institution_id
                  AND live.canonical_fee_key = fp.canonical_fee_key
                  AND live.amount IS NOT DISTINCT FROM fp.amount
                  AND lower(btrim(live.fee_name)) = lower(btrim(fp.fee_name))
             )
          RETURNING fp.fee_published_id, fp.institution_id
        `;
        const ids = new Set(back.map((row) => Number(row.fee_published_id)));
        restored = down.filter((fee) => ids.has(fee.feePublishedId));
        // A restored fee is source-checked again on its institution's next check.
        await markRestoredForSourceCheck(scope, back, { runId: options.runId, restoredBy: `${SOURCE_LINK_CHECK}:resource` });
      }
      const done = [...linked, ...restored];
      // The verified row takes the same link, so a republish or refresh keeps it.
      const verified = done.filter((fee) => fee.verifiedBlank);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET source_url = v.url
            FROM unnest(${verified.map((fee) => fee.feeVerifiedId)}::bigint[], ${verified.map((fee) => fee.url)}::text[])
                 AS v(fee_verified_id, url)
           WHERE fv.fee_verified_id = v.fee_verified_id
             AND NULLIF(btrim(fv.source_url), '') IS NULL
        `;
      }
      // The rollback records are written with the change, or neither is.
      await recordFeedback(scope as SqlTag, sourceLinkResourceRecords(done, options.runId, options.batchId));
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.source_link_resource', 'completed',
          ${`Re-sourced ${done.length} fee(s) from a stored document of their own institution that prints them: linked ${linked.length} live, restored ${restored.length} taken down as untraceable; ${plan.misses.length} with no such document left as they are`},
          ${JSON.stringify({
            batch_id: options.batchId,
            version: SOURCE_LINK_VERSION,
            candidates: rows.length,
            linked: linked.length,
            restored: restored.length,
            not_moved: plan.resources.length - ready.length,
            changes: done.map((fee) => ({
              fee_published_id: fee.feePublishedId,
              action: fee.restore ? "restored" : "resourced",
              from_source_document_id: fee.fromDocumentId,
              source_document_id: fee.sourceDocumentId,
              url: fee.url,
              source_line: fee.sourceLine,
            })),
            misses: plan.misses.map((fee) => ({ fee_published_id: fee.feePublishedId, taken_down: fee.takenDown, why: fee.why })),
          })}::jsonb
        )
      `;
      return { linked, restored };
    });
    result.linked = written.linked.length;
    result.restored = written.restored.length;
    result.resources = [...written.linked, ...written.restored];
  } catch (error) {
    // The savepoint rolled the pass back. In the publish step a failed re-source must not stop
    // publishing; the step's detail carries the error, and the hand repair fails on it (#1349).
    console.error("resourceSourceLinks write failed:", error);
    result.error = `source link re-source write failed: ${error instanceof Error ? error.message : String(error)}`;
    return { ...result, resources: [], linked: 0, restored: 0 };
  }
  if (result.linked > 0 || result.restored > 0) invalidatePublicReadCache();
  return result;
}
