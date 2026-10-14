import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { feedbackSchemaReady, recordFeedback } from "@/lib/agents/learning/feedback";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { LINEUP_CATEGORY, lineupCorrections, type AccountLineup, type LineupCorrection } from "@/lib/agents/knox/lineup";

type SqlTag = typeof sql;

/**
 * Knox v55 stopped reading a monthly fee's lineup from its neighbours: the next account's fee
 * line, another account's clause of a one-line footnote, or a fee heading above an account
 * heading ("Early (Share) Savings Account Closing" over "Money Market"). Re-reads only fill
 * empty lineup fields, so values stored before v55 stay wrong. This step corrects them in place
 * from the stored text, with no model call (`lineupCorrections`): one row of `pipeline_feedback`
 * per changed field holds the old and new values, the UPDATE only lands while the field still
 * holds the old value, and no row is ever deleted.
 */
// v2 (9 Oct): names read from a "Learn more about ..." link or a lower-case tagline are corrected; every copy is looked at again.
export const LINEUP_CORRECT_STRATEGY = { strategy: "knox.lineup_correct", version: 2 } as const;
export const LINEUP_CORRECT_KIND = "lineup_corrected";
/** Documents per publish step: 779 current copies held a stored lineup value on 2026-10-09. */
export const LINEUP_CORRECT_DOCUMENT_LIMIT = 200;

const COLUMN: Record<keyof AccountLineup, string> = {
  productName: "product_name",
  minBalanceToAvoid: "min_balance_to_avoid",
  minOpeningDeposit: "min_opening_deposit",
  waiverText: "waiver_text",
};

export interface LineupRow {
  fee_raw_id: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  fee_name: string;
  conditions: string | null;
  product_name: string | null;
  min_balance_to_avoid: number | string | null;
  min_opening_deposit: number | string | null;
  waiver_text: string | null;
}

export interface RowCorrection {
  feeRawId: number;
  institutionId: number;
  sourceDocumentId: number;
  corrections: LineupCorrection[];
}

const toNumber = (value: number | string | null) => (value == null || value === "" ? null : Number(value));

/** Pure: the corrections for each stored row, read against its own document's text. */
export function planLineupCorrections(rows: LineupRow[], texts: Map<number, string>): RowCorrection[] {
  const planned: RowCorrection[] = [];
  for (const row of rows) {
    const text = texts.get(Number(row.source_document_id));
    const excerpt = excerptOf(row.conditions);
    if (!text || !excerpt) continue;
    const corrections = lineupCorrections(
      { feeName: row.fee_name, excerpt },
      {
        productName: row.product_name,
        minBalanceToAvoid: toNumber(row.min_balance_to_avoid),
        minOpeningDeposit: toNumber(row.min_opening_deposit),
        waiverText: row.waiver_text,
      },
      text,
    );
    if (corrections.length > 0) {
      planned.push({
        feeRawId: Number(row.fee_raw_id),
        institutionId: Number(row.institution_id),
        sourceDocumentId: Number(row.source_document_id),
        corrections,
      });
    }
  }
  return planned;
}

export interface LineupCorrectResult {
  dryRun: boolean;
  documentsChecked: number;
  rowsChecked: number;
  corrected: RowCorrection[];
}

const EMPTY: LineupCorrectResult = { dryRun: false, documentsChecked: 0, rowsChecked: 0, corrected: [] };

/** A document is looked at again when its text or the strategy changes. */
export function lineupCorrectFingerprint(textId: number | string): string {
  return `v${LINEUP_CORRECT_STRATEGY.version}:${textId}`;
}

export async function correctStoredLineups(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; documentLimit?: number },
): Promise<LineupCorrectResult> {
  const limit = options.documentLimit ?? LINEUP_CORRECT_DOCUMENT_LIMIT;
  const hint = `%canonical_hint=${LINEUP_CATEGORY};%`;
  let due: { source_document_id: number | string; institution_id: number | string; text_id: number | string; normalized_text: string }[];
  let rows: LineupRow[];
  try {
    if (!(await inSavepoint(db, (scope) => feedbackSchemaReady(scope)))) return { ...EMPTY, dryRun: options.dryRun };
    due = await inSavepoint(db, (scope) => scope<typeof due>`
      SELECT doc.source_document_id, doc.institution_id, txt.id AS text_id, txt.normalized_text
        FROM (
          SELECT DISTINCT fr.source_document_id, fr.institution_id
            FROM raw_fee_observations fr
            JOIN source_documents copy ON copy.id = fr.source_document_id AND copy.superseded_by_id IS NULL
           WHERE fr.source = 'knox'
             AND fr.conditions LIKE ${hint}
             AND (fr.product_name IS NOT NULL OR fr.min_balance_to_avoid IS NOT NULL
                  OR fr.min_opening_deposit IS NOT NULL OR fr.waiver_text IS NOT NULL)
             AND (${options.institutionId ?? null}::bigint IS NULL OR fr.institution_id = ${options.institutionId ?? null}::bigint)
        ) doc
        JOIN LATERAL (
          SELECT t.id, t.normalized_text
            FROM agent_source_texts t
           WHERE t.source_document_id = doc.source_document_id
             AND t.status = 'completed'
             AND t.normalized_text IS NOT NULL
           ORDER BY t.id DESC
           LIMIT 1
        ) txt ON true
       WHERE NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.stage = 'extract'
            AND pa.strategy = ${LINEUP_CORRECT_STRATEGY.strategy}
            AND pa.source_document_id = doc.source_document_id
            AND pa.input_fingerprint = 'v' || ${LINEUP_CORRECT_STRATEGY.version}::text || ':' || txt.id::text
       )
       ORDER BY doc.source_document_id
       LIMIT ${limit}
    `);
    if (due.length === 0) return { ...EMPTY, dryRun: options.dryRun };
    const documentIds = due.map((doc) => Number(doc.source_document_id));
    rows = await inSavepoint(db, (scope) => scope<LineupRow[]>`
      SELECT fee_raw_id, institution_id, source_document_id, fee_name, conditions,
             product_name, min_balance_to_avoid, min_opening_deposit, waiver_text
        FROM raw_fee_observations
       WHERE source = 'knox'
         AND source_document_id = ANY(${documentIds}::bigint[])
         AND conditions LIKE ${hint}
         AND (product_name IS NOT NULL OR min_balance_to_avoid IS NOT NULL
              OR min_opening_deposit IS NOT NULL OR waiver_text IS NOT NULL)
    `);
  } catch (error) {
    // A failed correction must never block publishing.
    console.error("correctStoredLineups select failed:", error);
    return { ...EMPTY, dryRun: options.dryRun };
  }

  const texts = new Map(due.map((doc) => [Number(doc.source_document_id), doc.normalized_text]));
  const corrected = planLineupCorrections(rows, texts);
  const result: LineupCorrectResult = { dryRun: options.dryRun, documentsChecked: due.length, rowsChecked: rows.length, corrected };
  if (options.dryRun) return result;

  const applied: RowCorrection[] = [];
  try {
    await inSavepoint(db, async (scope) => {
      if (corrected.length > 0) {
        await recordFeedback(
          scope,
          corrected.flatMap((row) =>
            row.corrections.map((fix) => ({
              aboutStage: "extract" as const,
              aboutStrategy: LINEUP_CORRECT_STRATEGY.strategy,
              aboutVersion: LINEUP_CORRECT_STRATEGY.version,
              signal: "right" as const,
              kind: LINEUP_CORRECT_KIND,
              reportedBy: "knox" as const,
              checkName: LINEUP_CORRECT_STRATEGY.strategy,
              institutionId: row.institutionId,
              sourceDocumentId: row.sourceDocumentId,
              feeRawId: row.feeRawId,
              canonicalFeeKey: LINEUP_CATEGORY,
              // A correction is housekeeping, not a judgement on the read: it carries no weight in lessons.
              weight: 0,
              evidence: { field: COLUMN[fix.field], old: fix.old, new: fix.new, knox_rules_version: 55 },
              runId: options.runId,
              dedupeKey: `${LINEUP_CORRECT_STRATEGY.strategy}:raw:${row.feeRawId}:${COLUMN[fix.field]}`,
            })),
          ),
        );
        for (const row of corrected) {
          let landed = false;
          for (const fix of row.corrections) {
            const column = COLUMN[fix.field];
            // Only while the field still holds the value judged wrong.
            const cast = typeof fix.old === "number" ? "numeric" : "text";
            const updated = await scope.unsafe(
              `UPDATE raw_fee_observations SET ${column} = $1 WHERE fee_raw_id = $2 AND ${column} = $3::${cast} RETURNING fee_raw_id`,
              [fix.new, row.feeRawId, String(fix.old)] as never[],
            );
            if (updated.length > 0) landed = true;
          }
          if (landed) applied.push(row);
        }
      }
      for (const doc of due) {
        const documentId = Number(doc.source_document_id);
        const fixes = applied.filter((row) => row.sourceDocumentId === documentId);
        await recordAttempt(scope, {
          institutionId: Number(doc.institution_id),
          sourceDocumentId: documentId,
          stage: "extract",
          strategy: LINEUP_CORRECT_STRATEGY.strategy,
          version: LINEUP_CORRECT_STRATEGY.version,
          fingerprint: lineupCorrectFingerprint(doc.text_id),
          outcome: fixes.length > 0 ? "ok" : "unchanged",
          yieldCount: fixes.length,
          costMicrousd: 0,
          runId: options.runId,
          foldIntoPlaybook: false,
          detail: { rows_corrected: fixes.length },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${LINEUP_CORRECT_STRATEGY.strategy}, 'completed',
          ${`Corrected the stored lineup of ${applied.length} monthly fee row(s) on ${due.length} document(s) that Knox v55 reads differently; old values kept in pipeline_feedback`},
          ${JSON.stringify({
            version: LINEUP_CORRECT_STRATEGY.version,
            documents_checked: due.length,
            rows_checked: rows.length,
            rows_corrected: applied.length,
            samples: applied.slice(0, 20).map((row) => ({ fee_raw_id: row.feeRawId, corrections: row.corrections })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("correctStoredLineups write failed:", error);
    return { ...result, corrected: [] };
  }
  if (applied.length > 0) invalidatePublicReadCache();
  return { ...result, corrected: applied };
}
