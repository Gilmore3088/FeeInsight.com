import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { feedbackSchemaReady, recordFeedback } from "@/lib/agents/learning/feedback";
import { ANCILLARY_PRODUCT_FLAG, withAncillaryProduct } from "@/lib/agents/knox/ancillary-product";

type SqlTag = typeof sql;

/**
 * #1911 current-data recovery. Knox's ancillary ownership (`withAncillaryProduct`,
 * `ancillary_product:v1`) labels only newly inserted raw rows: an insert conflict keeps the
 * existing row "for explicit recovery" (extract.ts), so a live fee read before the rule landed keeps
 * a NULL product. This step is that explicit recovery. It re-reads the current text of each
 * document with a live Knox fee whose raw row has no product, and when the document names one
 * primary product (`primaryAncillaryProduct`) and the fee's own name and price are witnessed in that
 * product's fee block (the same `withAncillaryProduct` test a new read takes), it fills
 * `product_name` and adds the `ancillary_product:v1` flag. Deterministic, no model call.
 *
 * - Only rows whose `product_name` is still NULL change, and only while name and amount are as read;
 *   a row that already holds a product is never touched. Nothing is deleted.
 * - One `pipeline_feedback` row per change keeps the old (NULL) and new values.
 * - Applying is off unless `KNOX_ANCILLARY_OWNER_CORRECT_LIVE` is set (1 or true); off, the step is a
 *   dry run that only counts and lists what it would change, and writes nothing.
 * - Applied, each document checked is recorded as an attempt keyed by version and text id, so it is
 *   looked at again only when its text or this version changes.
 */
export const ANCILLARY_OWNER_CORRECT_STRATEGY = { strategy: "knox.ancillary_owner_correct", version: 1 } as const;
export const ANCILLARY_OWNER_CORRECT_KIND = "ancillary_owner_corrected";
export const ANCILLARY_OWNER_CORRECT_SWITCH = "KNOX_ANCILLARY_OWNER_CORRECT_LIVE";
/** Documents per extract step. On 2026-10-26 one document (U.S. Bank's Safe Debit, 33344) qualified. */
export const ANCILLARY_OWNER_CORRECT_DOCUMENT_LIMIT = 100;
/** Changes kept on the step detail and the run event. */
const SAMPLE_LIMIT = 50;

/** The switch reads on for "1" or "true", allowing for stray spaces, quotes and capitals. */
export function ancillaryOwnerCorrectLive(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ANCILLARY_OWNER_CORRECT_SWITCH];
  if (raw == null) return false;
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return value === "1" || value === "true";
}

export interface AncillaryOwnerRow {
  fee_raw_id: number | string;
  fee_published_id: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  fee_name: string;
  amount: number | string | null;
  canonical_fee_key: string;
  product_name: string | null;
}

export interface AncillaryOwnerSource {
  textId: number;
  text: string;
  institutionName: string | null;
}

export interface AncillaryOwnerCorrection {
  feeRawId: number;
  feePublishedId: number;
  institutionId: number;
  sourceDocumentId: number;
  textId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string;
  old: null;
  new: string;
  title: string;
  ownLine: string;
}

/** Pure: the rows whose own document names one product and prints their fee in its block. */
export function planAncillaryOwnerCorrections(
  rows: AncillaryOwnerRow[],
  sources: Map<number, AncillaryOwnerSource>,
): AncillaryOwnerCorrection[] {
  const planned: AncillaryOwnerCorrection[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    // One raw row can feed more than one published row; it changes once.
    if (seen.has(Number(row.fee_raw_id))) continue;
    // A labelled row is someone's decision; this step only fills a missing product.
    if (row.product_name != null && row.product_name.trim() !== "") continue;
    const source = sources.get(Number(row.source_document_id));
    const amount = row.amount == null || row.amount === "" ? null : Number(row.amount);
    if (!source || amount == null || !Number.isFinite(amount)) continue;
    const owned = withAncillaryProduct(
      { feeName: row.fee_name, canonicalHint: row.canonical_fee_key, amount },
      source.text,
      source.institutionName,
    ).ancillaryProduct;
    if (!owned) continue;
    seen.add(Number(row.fee_raw_id));
    planned.push({
      feeRawId: Number(row.fee_raw_id),
      feePublishedId: Number(row.fee_published_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: Number(row.source_document_id),
      textId: source.textId,
      feeName: row.fee_name,
      amount,
      canonicalFeeKey: row.canonical_fee_key,
      old: null,
      new: owned.productName,
      title: owned.title,
      ownLine: owned.ownLine,
    });
  }
  return planned;
}

export interface AncillaryOwnerCorrectResult {
  /** The switch is on: a non-dry-run step applies. */
  live: boolean;
  /** Nothing written: the switch is off or the run is a dry run. */
  dryRun: boolean;
  documentsChecked: number;
  rowsChecked: number;
  /** Planned changes (dry run) or the changes that landed (applied). */
  corrected: AncillaryOwnerCorrection[];
  error: string | null;
}

/** A document is looked at again when its text or the strategy version changes. */
export function ancillaryOwnerCorrectFingerprint(textId: number | string): string {
  return `v${ANCILLARY_OWNER_CORRECT_STRATEGY.version}:${textId}`;
}

/** The step detail: counts and the first changes, never the source text. */
export function ancillaryOwnerCorrectDetail(result: AncillaryOwnerCorrectResult) {
  return {
    version: ANCILLARY_OWNER_CORRECT_STRATEGY.version,
    live: result.live,
    dry_run: result.dryRun,
    documents_checked: result.documentsChecked,
    rows_checked: result.rowsChecked,
    rows_corrected: result.corrected.length,
    error: result.error,
    samples: result.corrected.slice(0, SAMPLE_LIMIT).map((fix) => ({
      fee_raw_id: fix.feeRawId,
      fee_published_id: fix.feePublishedId,
      institution_id: fix.institutionId,
      source_document_id: fix.sourceDocumentId,
      text_id: fix.textId,
      fee_name: fix.feeName,
      amount: fix.amount,
      product_name: { old: fix.old, new: fix.new },
    })),
  };
}

/** One sentence for the extract step's summary. */
export function ancillaryOwnerCorrectNote(result: AncillaryOwnerCorrectResult): string {
  if (result.documentsChecked === 0 && result.corrected.length === 0) return "";
  const mode = result.dryRun ? (result.live ? "dry run" : "switch off, nothing written") : "live";
  return ` Ancillary product recovery (${mode}): ${result.rowsChecked.toLocaleString()} live fees with no product on ${result.documentsChecked.toLocaleString()} single-product documents; ${result.corrected.length.toLocaleString()} ${result.dryRun ? "would take" : "took"} the document's product.`;
}

const EMPTY = { documentsChecked: 0, rowsChecked: 0, corrected: [] as AncillaryOwnerCorrection[], error: null };

export async function correctAncillaryOwners(
  db: SqlTag,
  options: {
    runId: number;
    stepId?: number | null;
    dryRun: boolean;
    institutionId?: number | null;
    stateCode?: string | null;
    documentLimit?: number;
    /** Overrides the env switch (tests). */
    live?: boolean;
  },
): Promise<AncillaryOwnerCorrectResult> {
  const live = options.live ?? ancillaryOwnerCorrectLive();
  const dryRun = options.dryRun || !live;
  const limit = options.documentLimit ?? ANCILLARY_OWNER_CORRECT_DOCUMENT_LIMIT;
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const base = { ...EMPTY, live, dryRun };
  let due: { source_document_id: number | string; institution_id: number | string; institution_name: string | null; text_id: number | string; normalized_text: string }[];
  let rows: AncillaryOwnerRow[];
  try {
    if (!(await inSavepoint(db, (scope) => feedbackSchemaReady(scope)))) return base;
    // Documents with a live Knox fee whose raw row has no product. The text test is a cheap
    // prefilter on the head of the text (a primary title within 12 lines, the fee block heading
    // within 12 more); `primaryAncillaryProduct` decides.
    due = await inSavepoint(db, (scope) => scope<typeof due>`
      SELECT doc.source_document_id, doc.institution_id, doc.institution_name, txt.id AS text_id, txt.normalized_text
        FROM (
          SELECT DISTINCT fr.source_document_id, fr.institution_id, inst.institution_name
            FROM published_fee_records fp
            JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
            JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
            JOIN institution_sources inst ON inst.id = fr.institution_id
           WHERE fp.rolled_back_at IS NULL
             AND fp.quarantined_at IS NULL
             AND fr.source = 'knox'
             AND fr.product_name IS NULL
             AND fr.source_document_id IS NOT NULL
             AND fr.amount > 0
             AND (${institutionId}::bigint IS NULL OR fr.institution_id = ${institutionId}::bigint)
             AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
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
       WHERE octet_length(txt.normalized_text) <= 800000
         AND substr(txt.normalized_text, 1, 12000) ~* '(pricing[[:space:]]+and[[:space:]]+information|fee[[:space:]]+schedule|schedule[[:space:]]+of[[:space:]]+fees)'
         AND substr(txt.normalized_text, 1, 12000) ~* 'account[[:space:]]+terms[[:space:]]+and[[:space:]]+fees'
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.stage = 'extract'
              AND pa.strategy = ${ANCILLARY_OWNER_CORRECT_STRATEGY.strategy}
              AND pa.source_document_id = doc.source_document_id
              AND pa.input_fingerprint = 'v' || ${ANCILLARY_OWNER_CORRECT_STRATEGY.version}::text || ':' || txt.id::text
         )
       ORDER BY doc.source_document_id
       LIMIT ${limit}
    `);
    if (due.length === 0) return base;
    const documentIds = due.map((doc) => Number(doc.source_document_id));
    rows = await inSavepoint(db, (scope) => scope<AncillaryOwnerRow[]>`
      SELECT fr.fee_raw_id, fp.fee_published_id, fr.institution_id, fr.source_document_id, fr.fee_name,
             fr.amount, fp.canonical_fee_key, fr.product_name
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fr.source = 'knox'
         AND fr.product_name IS NULL
         AND fr.amount > 0
         AND fr.source_document_id = ANY(${documentIds}::bigint[])
       ORDER BY fr.fee_raw_id
    `);
  } catch (error) {
    // A failed recovery must never block the extract step.
    console.error("correctAncillaryOwners select failed:", error);
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }

  const sources = new Map(due.map((doc) => [Number(doc.source_document_id), {
    textId: Number(doc.text_id),
    text: doc.normalized_text,
    institutionName: doc.institution_name,
  }]));
  const planned = planAncillaryOwnerCorrections(rows, sources);
  const result: AncillaryOwnerCorrectResult = { ...base, documentsChecked: due.length, rowsChecked: rows.length, corrected: planned };
  if (dryRun) return result;

  const applied: AncillaryOwnerCorrection[] = [];
  try {
    await inSavepoint(db, async (scope) => {
      for (const fix of planned) {
        // Only while the product is still missing and the fee is still the one judged.
        const updated = await scope<{ fee_raw_id: number | string }[]>`
          UPDATE raw_fee_observations
             SET product_name = ${fix.new},
                 outlier_flags = CASE
                   WHEN COALESCE(outlier_flags, '[]'::jsonb) ? ${ANCILLARY_PRODUCT_FLAG}::text THEN outlier_flags
                   ELSE COALESCE(outlier_flags, '[]'::jsonb) || jsonb_build_array(${ANCILLARY_PRODUCT_FLAG}::text)
                 END
           WHERE fee_raw_id = ${fix.feeRawId}
             AND product_name IS NULL
             AND fee_name = ${fix.feeName}
             AND amount = ${fix.amount}::numeric
          RETURNING fee_raw_id
        `;
        if (updated.length > 0) applied.push(fix);
      }
      if (applied.length > 0) {
        await recordFeedback(scope, applied.map((fix) => ({
          aboutStage: "extract" as const,
          aboutStrategy: ANCILLARY_OWNER_CORRECT_STRATEGY.strategy,
          aboutVersion: ANCILLARY_OWNER_CORRECT_STRATEGY.version,
          signal: "right" as const,
          kind: ANCILLARY_OWNER_CORRECT_KIND,
          reportedBy: "knox" as const,
          checkName: ANCILLARY_OWNER_CORRECT_STRATEGY.strategy,
          institutionId: fix.institutionId,
          sourceDocumentId: fix.sourceDocumentId,
          feeRawId: fix.feeRawId,
          feePublishedId: fix.feePublishedId,
          canonicalFeeKey: fix.canonicalFeeKey,
          amount: fix.amount,
          // A recovery is housekeeping, not a judgement on the read: it carries no weight in lessons.
          weight: 0,
          evidence: {
            field: "product_name",
            old: fix.old,
            new: fix.new,
            flag_added: ANCILLARY_PRODUCT_FLAG,
            title: fix.title,
            own_line: fix.ownLine,
            text_id: fix.textId,
          },
          runId: options.runId,
          dedupeKey: `${ANCILLARY_OWNER_CORRECT_STRATEGY.strategy}:raw:${fix.feeRawId}:product_name`,
        })));
      }
      for (const doc of due) {
        const documentId = Number(doc.source_document_id);
        const fixes = applied.filter((fix) => fix.sourceDocumentId === documentId);
        await recordAttempt(scope, {
          institutionId: Number(doc.institution_id),
          sourceDocumentId: documentId,
          stage: "extract",
          strategy: ANCILLARY_OWNER_CORRECT_STRATEGY.strategy,
          version: ANCILLARY_OWNER_CORRECT_STRATEGY.version,
          fingerprint: ancillaryOwnerCorrectFingerprint(doc.text_id),
          outcome: fixes.length > 0 ? "ok" : "unchanged",
          yieldCount: fixes.length,
          costMicrousd: 0,
          runId: options.runId,
          stepId: options.stepId ?? null,
          foldIntoPlaybook: false,
          detail: { rows_corrected: fixes.length },
        });
      }
      const detail = ancillaryOwnerCorrectDetail({ ...result, corrected: applied });
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${ANCILLARY_OWNER_CORRECT_STRATEGY.strategy}, 'completed',
          ${`Gave ${applied.length} live fee row(s) with no product the single product their own document names (${due.length} document(s) checked); old values kept in pipeline_feedback`},
          ${JSON.stringify(detail)}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("correctAncillaryOwners write failed:", error);
    return { ...result, corrected: [], error: error instanceof Error ? error.message : String(error) };
  }
  if (applied.length > 0) invalidatePublicReadCache();
  return { ...result, corrected: applied };
}
