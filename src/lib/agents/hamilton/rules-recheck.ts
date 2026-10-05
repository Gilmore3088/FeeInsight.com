import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { FAMILY_EXPERTS } from "@/lib/agents/knox/families";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { KNOX_TABLE_STRATEGY } from "@/lib/agents/knox/table-rows";

type SqlTag = typeof sql;

/** Documents re-checked per publish step; later steps pick up the rest. */
export const RULES_RECHECK_DOCUMENT_LIMIT = 25;
export const RULES_RECHECK_REASON = "rules_recheck_unreproduced";
export const RULES_RECHECK_STRATEGY = { strategy: "hamilton.rules_recheck", version: 1 } as const;
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
  const result = runFreeSpecialists(text);
  const fees = new Set<string>();
  for (const candidate of result.candidates) {
    if (passesDarwinChecks(candidate.canonicalHint, candidate.feeName, candidate.amount)) {
      fees.add(feeKey(candidate.canonicalHint, candidate.amount));
    }
  }
  for (const held of result.held) {
    if (held.shape === "zero" && held.canonicalHint && passesDarwinChecks(held.canonicalHint, held.feeName, 0)) {
      fees.add(feeKey(held.canonicalHint, 0));
    }
  }
  return fees;
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
}

interface DocumentText {
  source_document_id: number | string;
  text_hash: string | null;
  normalized_text: string;
}

const EMPTY_RESULT: RulesRecheckResult = { documentsChecked: 0, documentsWithoutText: 0, liveFeesChecked: 0, rollbacks: [] };

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
  const params: Array<number | string> = [documentLimit, RULES_RECHECK_STRATEGY.strategy, RULES_RECHECK_STRATEGY.version, signature];
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
                 fp.canonical_fee_key, fp.fee_name, fp.amount
            FROM published_fee_records fp
            JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
            JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
            JOIN institution_sources inst ON inst.id = fp.institution_id
           WHERE fp.rolled_back_at IS NULL
             AND fr.source = 'knox'
             AND fr.source_document_id IS NOT NULL
             AND NOT (COALESCE(fr.outlier_flags, '[]'::jsonb) ? 'knox_paid_extraction')
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

  const result: RulesRecheckResult = { documentsChecked: 0, documentsWithoutText: 0, liveFeesChecked: 0, rollbacks: [] };
  const checked: Array<{ institutionId: number; sourceDocumentId: number; checked: number; rolledBack: number; missing?: number }> = [];
  for (const [documentId, documentRows] of rowsByDocument) {
    const documentTexts = textsByDocument.get(documentId) ?? [];
    const institutionId = Number(documentRows[0].institution_id);
    result.documentsChecked += 1;
    if (documentTexts.length === 0) {
      // Nothing to re-check against: leave its fees live and record the attempt so the
      // document does not hold a place in every later batch.
      result.documentsWithoutText += 1;
      checked.push({ institutionId, sourceDocumentId: documentId, checked: 0, rolledBack: 0 });
      continue;
    }
    const latest = documentTexts[documentTexts.length - 1];
    const reproducedByHash = new Map<string, Set<string>>();
    let rolledBack = 0;
    // One document states a fee once: when a re-extraction publishes the same category and
    // price under a better name ("Negative $25 or less" for "Negative or less"), the newest
    // row stays and older copies are rolled back.
    const keptKeys = new Set<string>();
    const newestFirst = [...documentRows].sort((a, b) => Number(b.fee_published_id) - Number(a.fee_published_id));
    for (const row of newestFirst) {
      const text = documentTexts.find((candidate) => candidate.text_hash === row.text_hash) ?? latest;
      const hash = text.text_hash ?? `document:${documentId}`;
      let reproduced = reproducedByHash.get(hash);
      if (!reproduced) {
        reproduced = reproducibleFees(text.normalized_text);
        reproducedByHash.set(hash, reproduced);
      }
      result.liveFeesChecked += 1;
      const amount = row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100;
      const key = amount == null ? null : feeKey(row.canonical_fee_key, amount);
      if (key != null && reproduced.has(key) && !keptKeys.has(key)) {
        keptKeys.add(key);
        continue;
      }
      rolledBack += 1;
      result.rollbacks.push({
        feePublishedId: Number(row.fee_published_id),
        feeVerifiedId: Number(row.lineage_ref),
        institutionId,
        sourceDocumentId: documentId,
        canonicalFeeKey: row.canonical_fee_key,
        feeName: row.fee_name,
        amount,
      });
    }
    // Fees today's rules read from the latest text that are not live (Texar's $20 and $35
    // tiers, missed by an older version): Knox extracts this text again (MISSING_FEES_DETAIL).
    const live = new Set(
      documentRows.filter((row) => row.amount != null).map((row) => feeKey(row.canonical_fee_key, Number(row.amount))),
    );
    const latestHash = latest.text_hash ?? `document:${documentId}`;
    const latestReproduced = reproducedByHash.get(latestHash) ?? reproducibleFees(latest.normalized_text);
    const missing = [...latestReproduced].filter((key) => !live.has(key)).length;
    checked.push({ institutionId, sourceDocumentId: documentId, checked: documentRows.length, rolledBack, missing });
  }

  result.rollbacks.sort((a, b) => a.feePublishedId - b.feePublishedId);
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
          detail: { live_fees_checked: document.checked, rolled_back: document.rolledBack, [MISSING_FEES_DETAIL]: document.missing ?? 0 },
          foldIntoPlaybook: false,
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.rules_recheck', 'completed',
          ${`Re-checked ${result.liveFeesChecked} live fee(s) in ${result.documentsChecked} document(s) against today's rules; rolled back ${result.rollbacks.length}`},
          ${JSON.stringify({
            batch_id: options.batchId,
            signature,
            documents_checked: result.documentsChecked,
            documents_without_text: result.documentsWithoutText,
            live_fees_checked: result.liveFeesChecked,
            rolled_back: result.rollbacks.length,
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
    return { ...result, rollbacks: [] };
  }
  if (result.rollbacks.length > 0) invalidatePublicReadCache();
  return result;
}
