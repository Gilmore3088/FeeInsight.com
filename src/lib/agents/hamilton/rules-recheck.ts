import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { passesDarwinChecks, tidyFeeName } from "@/lib/agents/knox/layout";
import { refileCategory } from "@/lib/fee-category-guard";
import { FAMILY_EXPERTS } from "@/lib/agents/knox/families";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { KNOX_TABLE_STRATEGY } from "@/lib/agents/knox/table-rows";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

type SqlTag = typeof sql;

/** Documents re-checked per publish step; later steps pick up the rest. */
export const RULES_RECHECK_DOCUMENT_LIMIT = 25;
export const RULES_RECHECK_REASON = "rules_recheck_unreproduced";
// Version 2: a fee an earlier re-check took down is restored when today's rules read it
// again (same text, name, category and price), which Knox's raw-row dedupe would block.
// Version 3: a read is filed under the category Darwin files it under (refileCategory), so
// a fee Darwin re-filed (an "Insufficient Funds Transfer (Savings Overdraft)" Knox hinted as
// overdraft is an overdraft protection transfer) is no longer taken down as unreproduced.
// The bump re-checks every document once, which restores those it took down.
export const RULES_RECHECK_STRATEGY = { strategy: "hamilton.rules_recheck", version: 3 } as const;
/** Attempt detail key: fees today's rules read from the document that are not live. */
export const MISSING_FEES_DETAIL = "missing_fees";

/**
 * The free extractor team's versions. A document is re-checked once per signature, so
 * a new Knox rules version re-checks every live fee it once published.
 */
export function knoxFreeSignature(): string {
  return [KNOX_RULES_STRATEGY, KNOX_TABLE_STRATEGY, ...FAMILY_EXPERTS]
    .map((specialist) => `${specialist.strategy}@${specialist.version}`)
    .join(",");
}

function feeKey(canonicalKey: string, amount: number): string {
  return `${canonicalKey}:${Math.round(amount * 100)}`;
}

/**
 * Every fee (category and price) today's free Knox team reads from a text and Darwin's
 * rule checks would accept. Pure.
 */
export function reproducibleFees(text: string): Set<string> {
  return new Set(reproducibleReads(text).keys());
}

/**
 * The same reads as `reproducibleFees`, with the names (lowercased) each fee was read
 * under. Pure.
 */
export function reproducibleReads(text: string): Map<string, Set<string>> {
  const result = runFreeSpecialists(text);
  const reads = new Map<string, Set<string>>();
  const add = (key: string, name: string) => reads.set(key, (reads.get(key) ?? new Set()).add(name.toLowerCase()));
  // The category Darwin files a read under, as its verify step does.
  const filedAs = (hint: string, name: string) => refileCategory(hint, name) ?? hint;
  for (const candidate of result.candidates) {
    const key = filedAs(candidate.canonicalHint, candidate.feeName);
    if (passesDarwinChecks(key, candidate.feeName, candidate.amount)) {
      add(feeKey(key, candidate.amount), candidate.feeName);
    }
  }
  for (const held of result.held) {
    if (held.shape !== "zero" || !held.canonicalHint) continue;
    const key = filedAs(held.canonicalHint, held.feeName);
    if (passesDarwinChecks(key, held.feeName, 0)) add(feeKey(key, 0), held.feeName);
  }
  return reads;
}

export interface RulesRecheckRollback {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
}

export interface RulesRecheckResult {
  documentsChecked: number;
  documentsWithoutText: number;
  liveFeesChecked: number;
  rollbacks: RulesRecheckRollback[];
  /** Fees an earlier re-check took down that today's rules read again. */
  restores: RulesRecheckRollback[];
}

interface LiveKnoxRow {
  fee_published_id: number | string;
  lineage_ref: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  text_hash: string | null;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  /** The raw row's name: Knox's raw-row dedupe is keyed on it. */
  raw_fee_name?: string | null;
  /** Taken down by an earlier re-check; restored when today's rules read it again. */
  pulled?: boolean | null;
  /** `knox_lesson:<wrong>-><right>`: Knox's learning reader re-filed the rules' read (knox/lessons.ts). */
  lesson_flag?: string | null;
}

/**
 * The key today's rules read for a fee Knox's learning reader re-filed: a row stored
 * under the lesson's verified category is reproduced by a read under the rejected one.
 * Only the category is excused: the read must have the row's own price, and Knox's reads
 * already pass the shared source check (its self-check), so a wrong amount still goes.
 * Rate rows never reach this (the live query keeps `amount_kind = 'flat'`). No strategy
 * bump: lesson rows come from new reads, and new rules versions change the fingerprint.
 */
function lessonReadKey(row: LiveKnoxRow, amount: number): string | null {
  const match = /^knox_lesson:([a-z_]+)->([a-z_]+)$/.exec(row.lesson_flag ?? "");
  return match && match[2] === row.canonical_fee_key ? feeKey(match[1], amount) : null;
}

interface DocumentText {
  source_document_id: number | string;
  text_hash: string | null;
  normalized_text: string;
}

const EMPTY_RESULT: RulesRecheckResult = { documentsChecked: 0, documentsWithoutText: 0, liveFeesChecked: 0, rollbacks: [], restores: [] };

/**
 * Hamilton repair: roll back live fees Knox's free rules extracted that today's rules
 * no longer read from the same document text. After a rules fix (a size row read as an
 * overdraft fee, a cap read as a price), the fees published before it stay live until
 * something re-checks them; this does, one document at a time. Knox's paid fees and
 * fees from other sources are never touched.
 *
 * A live fee survives when the current free team, run on the text it came from (or
 * the document's latest text when that one is gone), finds the same category at the
 * same price and Darwin's rule checks pass. Otherwise it is rolled back (kept, with
 * `rolled_back_at`, the batch id and the reason) and its verified row is rejected so
 * the next publish does not bring it back. Each document is re-checked once per Knox
 * version signature (attempt log). A dry run reports what it would roll back and
 * writes nothing.
 *
 * It also undoes itself. A fee an earlier re-check took down comes back when today's rules
 * read it again from its text under the same name, category and price, its name and price
 * still trace to that text (`checkFeeAgainstSource`), and no live fee of the institution
 * already has that category and price. That is exactly the fee Knox cannot bring back on
 * its own: re-extracting the text would insert the same raw row, which Knox's raw-row
 * dedupe (document, name, price) refuses. A fee read again under a new name returns the
 * normal way, as a new raw row through Darwin. Documents whose live fees were all taken
 * down are re-checked too.
 */
export async function rollBackUnreproducedFees(
  db: SqlTag,
  options: {
    runId: number;
    batchId: string;
    dryRun: boolean;
    institutionId?: number;
    stateCode?: string | null;
    documentLimit?: number;
  },
): Promise<RulesRecheckResult> {
  const signature = knoxFreeSignature();
  const documentLimit = options.documentLimit ?? RULES_RECHECK_DOCUMENT_LIMIT;
  const params: Array<number | string> = [
    documentLimit,
    RULES_RECHECK_STRATEGY.strategy,
    RULES_RECHECK_STRATEGY.version,
    signature,
    RULES_RECHECK_REASON,
  ];
  const filters: string[] = [];
  if (options.institutionId) {
    params.push(options.institutionId);
    filters.push(`AND fp.institution_id = $${params.length}`);
  }
  if (options.stateCode) {
    params.push(options.stateCode);
    filters.push(`AND upper(btrim(inst.state_code)) = $${params.length}`);
  }

  let rows: LiveKnoxRow[];
  let texts: DocumentText[];
  try {
    rows = await inSavepoint(db, (scope) =>
      scope.unsafe<LiveKnoxRow[]>(
        `
        WITH live AS (
          SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fr.source_document_id,
                 substring(fr.conditions from 'text_hash=([^;]+);') AS text_hash,
                 fp.canonical_fee_key, fp.fee_name, fp.amount, fr.fee_name AS raw_fee_name,
                 fp.rolled_back_at IS NOT NULL AS pulled,
                 (SELECT flag FROM jsonb_array_elements_text(COALESCE(fr.outlier_flags, '[]'::jsonb)) flag
                   WHERE flag LIKE 'knox_lesson:%' LIMIT 1) AS lesson_flag
            FROM published_fee_records fp
            JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
            JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
            JOIN institution_sources inst ON inst.id = fp.institution_id
           WHERE (
                   fp.rolled_back_at IS NULL
                   OR (fp.rolled_back_reason = $5 AND fv.review_status = 'rejected' AND fv.outlier_flags ? $5)
                 )
             AND fr.source = 'knox'
             AND fr.source_document_id IS NOT NULL
             AND NOT (COALESCE(fr.outlier_flags, '[]'::jsonb) ? 'knox_paid_extraction')
             -- Knox's free rules read dollar amounts only; a rate is checked by the source
             -- check (checkRateAgainstSource), never rolled back for lacking a dollar read.
             AND fp.amount_kind = 'flat'
             ${filters.join("\n             ")}
        ),
        docs AS (
          SELECT DISTINCT live.source_document_id, live.institution_id
            FROM live
           WHERE NOT EXISTS (
             SELECT 1
               FROM pipeline_attempts pa
              WHERE pa.stage = 'publish'
                AND pa.strategy = $2
                AND pa.strategy_version = $3
                AND pa.institution_id = live.institution_id
                AND pa.source_document_id = live.source_document_id
                AND pa.input_fingerprint = $4
           )
           ORDER BY live.source_document_id
           LIMIT $1
        )
        SELECT live.*
          FROM live
          JOIN docs USING (source_document_id, institution_id)
        `,
        params,
      ),
    );
    const documentIds = [...new Set(rows.map((row) => Number(row.source_document_id)))];
    texts = documentIds.length === 0
      ? []
      : await inSavepoint(db, (scope) => scope<DocumentText[]>`
          SELECT DISTINCT ON (source_document_id, text_hash) source_document_id, text_hash, normalized_text
            FROM agent_source_texts
           WHERE source_document_id = ANY(${documentIds}::bigint[])
             AND status = 'completed'
             AND normalized_text IS NOT NULL
           ORDER BY source_document_id, text_hash, id DESC
        `);
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("rollBackUnreproducedFees select failed:", error);
    return EMPTY_RESULT;
  }

  const textsByDocument = new Map<number, DocumentText[]>();
  for (const text of texts) {
    const id = Number(text.source_document_id);
    textsByDocument.set(id, [...(textsByDocument.get(id) ?? []), text]);
  }
  const rowsByDocument = new Map<number, LiveKnoxRow[]>();
  for (const row of rows) {
    const id = Number(row.source_document_id);
    rowsByDocument.set(id, [...(rowsByDocument.get(id) ?? []), row]);
  }

  const result: RulesRecheckResult = { ...EMPTY_RESULT, rollbacks: [], restores: [] };
  const checked: Array<{ institutionId: number; sourceDocumentId: number; checked: number; rolledBack: number; missing?: number }> = [];
  // One restore per institution, category and price in a batch.
  const restoredKeys = new Set<string>();
  for (const [documentId, documentRows] of rowsByDocument) {
    const documentTexts = textsByDocument.get(documentId) ?? [];
    const institutionId = Number(documentRows[0].institution_id);
    const liveRows = documentRows.filter((row) => !row.pulled);
    result.documentsChecked += 1;
    if (documentTexts.length === 0) {
      // Nothing to re-check against: leave its fees live and record the attempt so the
      // document does not hold a place in every later batch.
      result.documentsWithoutText += 1;
      checked.push({ institutionId, sourceDocumentId: documentId, checked: 0, rolledBack: 0 });
      continue;
    }
    const latest = documentTexts[documentTexts.length - 1];
    const readsByHash = new Map<string, Map<string, Set<string>>>();
    const textFor = (row: LiveKnoxRow) => documentTexts.find((candidate) => candidate.text_hash === row.text_hash) ?? latest;
    const readsFrom = (text: DocumentText) => {
      const hash = text.text_hash ?? `document:${documentId}`;
      let reads = readsByHash.get(hash);
      if (!reads) {
        reads = reproducibleReads(text.normalized_text);
        readsByHash.set(hash, reads);
      }
      return reads;
    };
    const asFee = (row: LiveKnoxRow): RulesRecheckRollback => ({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.lineage_ref),
      institutionId,
      sourceDocumentId: documentId,
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount: row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100,
    });
    const newestFirst = (rows: LiveKnoxRow[]) => [...rows].sort((a, b) => Number(b.fee_published_id) - Number(a.fee_published_id));
    let rolledBack = 0;
    // One document states a fee once: when a re-extraction publishes the same category and
    // price under a better name ("Negative $25 or less" for "Negative or less"), the newest
    // row stays and older copies are rolled back.
    const keptKeys = new Set<string>();
    for (const row of newestFirst(liveRows)) {
      const reads = readsFrom(textFor(row));
      result.liveFeesChecked += 1;
      const fee = asFee(row);
      const key = fee.amount == null ? null : feeKey(row.canonical_fee_key, fee.amount);
      const lessonKey = fee.amount == null ? null : lessonReadKey(row, fee.amount);
      if (key != null && (reads.has(key) || (lessonKey != null && reads.has(lessonKey))) && !keptKeys.has(key)) {
        keptKeys.add(key);
        continue;
      }
      rolledBack += 1;
      result.rollbacks.push(fee);
    }
    for (const row of newestFirst(documentRows.filter((candidate) => candidate.pulled))) {
      const fee = asFee(row);
      if (fee.amount == null) continue;
      const key = feeKey(row.canonical_fee_key, fee.amount);
      if (keptKeys.has(key) || restoredKeys.has(`${institutionId}:${key}`)) continue;
      const text = textFor(row);
      // Knox reads names tidied; a row stored under an older untidy name is the same read.
      if (!readsFrom(text).get(key)?.has(tidyFeeName(row.raw_fee_name ?? row.fee_name).toLowerCase())) continue;
      const traced = checkFeeAgainstSource(text.normalized_text, row.fee_name, fee.amount, ".", row.canonical_fee_key);
      if (!traced.ok && traced.reason !== "tiered_fee") continue;
      keptKeys.add(key);
      restoredKeys.add(`${institutionId}:${key}`);
      result.restores.push(fee);
    }
    // Fees today's rules read from the latest text that are not live (Texar's $20 and $35
    // tiers, missed by an older version): Knox extracts this text again (MISSING_FEES_DETAIL).
    const live = new Set(
      liveRows.filter((row) => row.amount != null).map((row) => feeKey(row.canonical_fee_key, Number(row.amount))),
    );
    const missing = [...readsFrom(latest).keys()].filter((key) => !live.has(key) && !keptKeys.has(key)).length;
    checked.push({ institutionId, sourceDocumentId: documentId, checked: liveRows.length, rolledBack, missing });
  }

  result.rollbacks.sort((a, b) => a.feePublishedId - b.feePublishedId);
  result.restores.sort((a, b) => a.feePublishedId - b.feePublishedId);
  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      if (result.rollbacks.length > 0) {
        const publishedIds = result.rollbacks.map((rollback) => rollback.feePublishedId);
        const verifiedIds = result.rollbacks.map((rollback) => rollback.feeVerifiedId);
        await scope`
          UPDATE published_fee_records
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = ${RULES_RECHECK_REASON}
           WHERE fee_published_id = ANY(${publishedIds}::bigint[])
             AND rolled_back_at IS NULL
        `;
        await scope`
          UPDATE verified_fee_observations
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN outlier_flags ? ${RULES_RECHECK_REASON} THEN outlier_flags
                   ELSE COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([RULES_RECHECK_REASON])}::jsonb
                 END
           WHERE fee_verified_id = ANY(${verifiedIds}::bigint[])
             AND review_status IN ('verified', 'approved')
        `;
      }
      if (result.restores.length > 0) {
        // A restore never makes a second live copy of a category and price the
        // institution already shows.
        const restored = await scope<{ fee_published_id: number | string; lineage_ref: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NULL,
                 rolled_back_by_batch_id = NULL,
                 rolled_back_reason = NULL
           WHERE fp.fee_published_id = ANY(${result.restores.map((fee) => fee.feePublishedId)}::bigint[])
             AND fp.rolled_back_reason = ${RULES_RECHECK_REASON}
             AND NOT EXISTS (
               SELECT 1 FROM published_fee_records live
                WHERE live.rolled_back_at IS NULL
                  AND live.institution_id = fp.institution_id
                  AND live.canonical_fee_key = fp.canonical_fee_key
                  AND live.amount IS NOT DISTINCT FROM fp.amount
             )
          RETURNING fp.fee_published_id, fp.lineage_ref
        `;
        const restoredIds = new Set(restored.map((row) => Number(row.fee_published_id)));
        result.restores = result.restores.filter((fee) => restoredIds.has(fee.feePublishedId));
        if (restored.length > 0) {
          await scope`
            UPDATE verified_fee_observations
               SET review_status = 'verified',
                   outlier_flags = outlier_flags - ${RULES_RECHECK_REASON}
             WHERE fee_verified_id = ANY(${restored.map((row) => Number(row.lineage_ref))}::bigint[])
               AND review_status = 'rejected'
               AND outlier_flags ? ${RULES_RECHECK_REASON}
          `;
        }
      }
      for (const document of checked) {
        await recordAttempt(scope, {
          institutionId: document.institutionId,
          sourceDocumentId: document.sourceDocumentId,
          stage: "publish",
          strategy: RULES_RECHECK_STRATEGY.strategy,
          version: RULES_RECHECK_STRATEGY.version,
          fingerprint: signature,
          outcome: document.checked === 0 ? "empty" : document.rolledBack > 0 ? "ok_partial" : "ok",
          yieldCount: document.checked - document.rolledBack,
          costMicrousd: 0,
          runId: options.runId,
          detail: {
            live_fees_checked: document.checked,
            rolled_back: document.rolledBack,
            // What the write restored, not what was proposed: a live copy can win in between.
            restored: result.restores.filter((fee) => fee.sourceDocumentId === document.sourceDocumentId).length,
            [MISSING_FEES_DETAIL]: document.missing ?? 0,
          },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.rules_recheck', 'completed',
          ${`Re-checked ${result.liveFeesChecked} live fee(s) in ${result.documentsChecked} document(s) against today's rules; rolled back ${result.rollbacks.length}, restored ${result.restores.length}`},
          ${JSON.stringify({
            batch_id: options.batchId,
            signature,
            documents_checked: result.documentsChecked,
            documents_without_text: result.documentsWithoutText,
            live_fees_checked: result.liveFeesChecked,
            rolled_back: result.rollbacks.length,
            restored: result.restores.length,
            restored_samples: result.restores.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              amount: fee.amount,
            })),
            samples: result.rollbacks.slice(0, 20).map((rollback) => ({
              fee_published_id: rollback.feePublishedId,
              institution_id: rollback.institutionId,
              source_document_id: rollback.sourceDocumentId,
              canonical_fee_key: rollback.canonicalFeeKey,
              fee_name: rollback.feeName,
              amount: rollback.amount,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("rollBackUnreproducedFees write failed:", error);
    return { ...result, rollbacks: [], restores: [] };
  }
  if (result.rollbacks.length > 0 || result.restores.length > 0) invalidatePublicReadCache();
  return result;
}
