import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { feedbackSchemaReady, recordFeedback } from "@/lib/agents/learning/feedback";
import { ACCOUNT_PRICED_CATEGORIES } from "@/lib/fee-product";
import { accountSubjectProduct, withLineupFromText, type AccountLineup } from "@/lib/agents/knox/lineup";

type SqlTag = typeof sql;

/**
 * #1912 current-data recovery. Since v125 Knox records, as a last resort, the account a monthly
 * maintenance or minimum balance read's own sentence names as subject (`accountSubjectProduct`,
 * "The M&T Preferred Money Market account has a $20 monthly maintenance charge."). A live fee read
 * before v125 keeps its NULL product, and a re-read of the same document meets the raw-row insert
 * conflict and keeps the existing row. This step is the explicit recovery, the sibling of
 * `ancillary-owner-correct.ts`: it re-reads the current text of each document with a live Knox
 * monthly maintenance or minimum balance fee whose raw row has no product, and when today's lineup
 * read of the fee's own excerpt records exactly the subject's account, it fills `product_name`.
 * Deterministic, no model call.
 *
 * - Only rows whose `product_name` is still NULL change, and only while name and amount are as read;
 *   a row that already holds a product is never touched. Nothing is deleted.
 * - One `pipeline_feedback` row per change keeps the old (NULL) and new values.
 * - Applying is off unless `KNOX_ACCOUNT_SUBJECT_CORRECT_LIVE` is set (1 or true); off, the step is a
 *   dry run that only counts and lists what it would change, and writes nothing.
 * - Only a step scoped to one bank or one state lane runs it; an unscoped step skips it.
 * - Applied, each document checked is recorded as an attempt keyed by version and text id, so it is
 *   looked at again only when its text or this version changes.
 */
export const ACCOUNT_SUBJECT_CORRECT_STRATEGY = { strategy: "knox.account_subject_correct", version: 1 } as const;
export const ACCOUNT_SUBJECT_CORRECT_KIND = "account_subject_corrected";
export const ACCOUNT_SUBJECT_CORRECT_SWITCH = "KNOX_ACCOUNT_SUBJECT_CORRECT_LIVE";
/** Documents per extract step. */
export const ACCOUNT_SUBJECT_CORRECT_DOCUMENT_LIMIT = 100;
/** Changes kept on the step detail and the run event. */
const SAMPLE_LIMIT = 50;
/** Texts the screen reads; a product page is far smaller. */
const MAX_TEXT_BYTES = 800_000;

/** The switch reads on for "1" or "true", allowing for stray spaces, quotes and capitals. */
export function accountSubjectCorrectLive(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ACCOUNT_SUBJECT_CORRECT_SWITCH];
  if (raw == null) return false;
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return value === "1" || value === "true";
}

/** The excerpt Knox stored in its extraction note (`... excerpt="<line>"`); null when none. */
export function noteExcerpt(note: string | null | undefined): string | null {
  const match = note?.match(/excerpt="([\s\S]*)"\s*$/);
  return match && match[1].trim() ? match[1] : null;
}

export interface AccountSubjectRow {
  fee_raw_id: number | string;
  fee_published_id: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  fee_name: string;
  amount: number | string | null;
  canonical_fee_key: string;
  product_name: string | null;
  /** Knox's audit note; rows whose note has not moved yet keep it in `conditions` (extraction-note.ts). */
  extraction_note: string | null;
  conditions?: string | null;
}

export interface AccountSubjectSource {
  textId: number;
  text: string;
  institutionName: string | null;
}

export interface AccountSubjectCorrection {
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
  excerpt: string;
}

/**
 * Pure: the rows whose own excerpt's sentence (or the line just above it) names the account as
 * subject at the fee's own price, and whose whole lineup read today records that same account.
 */
export function planAccountSubjectCorrections(
  rows: AccountSubjectRow[],
  sources: Map<number, AccountSubjectSource>,
): AccountSubjectCorrection[] {
  const planned: AccountSubjectCorrection[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(Number(row.fee_raw_id))) continue;
    if (row.product_name != null && row.product_name.trim() !== "") continue;
    if (!ACCOUNT_PRICED_CATEGORIES.has(row.canonical_fee_key)) continue;
    const source = sources.get(Number(row.source_document_id));
    const amount = row.amount == null || row.amount === "" ? null : Number(row.amount);
    // Knox's note: `extraction_note`, or `conditions` on a row whose note has not moved (extraction-note.ts).
    const excerpt = noteExcerpt(row.extraction_note ?? row.conditions ?? null);
    if (!source || !excerpt || amount == null || !Number.isFinite(amount) || amount < 0) continue;
    const subject = accountSubjectProduct(source.text, excerpt, amount, source.institutionName);
    if (!subject) continue;
    // The subject is the last resort: a row, table, heading or name that today's read prefers wins,
    // and then this step leaves the row to the lineup correction.
    const read = withLineupFromText(
      { canonicalHint: row.canonical_fee_key, feeName: row.fee_name, excerpt, amount, lineup: null as AccountLineup | null },
      source.text,
      { institutionName: source.institutionName },
    ).lineup?.productName;
    if (read !== subject) continue;
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
      new: subject,
      excerpt,
    });
  }
  return planned;
}

export interface AccountSubjectCorrectResult {
  /** The switch is on: a non-dry-run step applies. */
  live: boolean;
  /** Nothing written: the switch is off or the run is a dry run. */
  dryRun: boolean;
  documentsChecked: number;
  rowsChecked: number;
  /** Planned changes (dry run) or the changes that landed (applied). */
  corrected: AccountSubjectCorrection[];
  error: string | null;
}

/** A document is looked at again when its text or the strategy version changes. */
export function accountSubjectCorrectFingerprint(textId: number | string): string {
  return `v${ACCOUNT_SUBJECT_CORRECT_STRATEGY.version}:${textId}`;
}

/** The step detail: counts and the first changes, never the source text. */
export function accountSubjectCorrectDetail(result: AccountSubjectCorrectResult) {
  return {
    version: ACCOUNT_SUBJECT_CORRECT_STRATEGY.version,
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
export function accountSubjectCorrectNote(result: AccountSubjectCorrectResult): string {
  if (result.documentsChecked === 0 && result.corrected.length === 0) return "";
  const mode = result.dryRun ? (result.live ? "dry run" : "switch off, nothing written") : "live";
  return ` Account subject recovery (${mode}): ${result.rowsChecked.toLocaleString()} live monthly or minimum balance fees with no account on ${result.documentsChecked.toLocaleString()} documents; ${result.corrected.length.toLocaleString()} ${result.dryRun ? "would take" : "took"} the account their own sentence names.`;
}

const EMPTY = { documentsChecked: 0, rowsChecked: 0, corrected: [] as AccountSubjectCorrection[], error: null };

export async function correctAccountSubjects(
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
): Promise<AccountSubjectCorrectResult> {
  const live = options.live ?? accountSubjectCorrectLive();
  const dryRun = options.dryRun || !live;
  const limit = options.documentLimit ?? ACCOUNT_SUBJECT_CORRECT_DOCUMENT_LIMIT;
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const base = { ...EMPTY, live, dryRun };
  // The screen reads every candidate document's text, so it runs only in a step scoped to one bank
  // or one state lane, never in an unscoped one.
  if (institutionId == null && stateCode == null) return base;
  const categories = [...ACCOUNT_PRICED_CATEGORIES];
  let due: { source_document_id: number | string; institution_id: number | string; institution_name: string | null; text_id: number | string; normalized_text: string }[];
  let rows: AccountSubjectRow[];
  try {
    if (!(await inSavepoint(db, (scope) => feedbackSchemaReady(scope)))) return base;
    // Documents with a live Knox monthly maintenance or minimum balance fee whose raw row has no
    // product. The text test is a cheap prefilter for a subject sentence ("has a $N");
    // `accountSubjectProduct` decides.
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
             AND fp.canonical_fee_key = ANY(${categories}::text[])
             AND fr.source = 'knox'
             AND fr.product_name IS NULL
             AND fr.source_document_id IS NOT NULL
             AND fr.amount >= 0
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
       WHERE octet_length(txt.normalized_text) <= ${MAX_TEXT_BYTES}
         AND txt.normalized_text ~* '(has|carries|charges|includes|comes[[:space:]]+with|is[[:space:]]+subject[[:space:]]+to)[[:space:]]+an?[[:space:]]+[$]'
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.stage = 'extract'
              AND pa.strategy = ${ACCOUNT_SUBJECT_CORRECT_STRATEGY.strategy}
              AND pa.source_document_id = doc.source_document_id
              AND pa.input_fingerprint = 'v' || ${ACCOUNT_SUBJECT_CORRECT_STRATEGY.version}::text || ':' || txt.id::text
         )
       ORDER BY doc.source_document_id
       LIMIT ${limit}
    `);
    if (due.length === 0) return base;
    const documentIds = due.map((doc) => Number(doc.source_document_id));
    rows = await inSavepoint(db, (scope) => scope<AccountSubjectRow[]>`
      SELECT fr.fee_raw_id, fp.fee_published_id, fr.institution_id, fr.source_document_id, fr.fee_name,
             fr.amount, fp.canonical_fee_key, fr.product_name, fr.extraction_note, fr.conditions
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.canonical_fee_key = ANY(${categories}::text[])
         AND fr.source = 'knox'
         AND fr.product_name IS NULL
         AND fr.amount >= 0
         AND fr.source_document_id = ANY(${documentIds}::bigint[])
       ORDER BY fr.fee_raw_id
    `);
  } catch (error) {
    // A failed recovery must never block the extract step.
    console.error("correctAccountSubjects select failed:", error);
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }

  const sources = new Map(due.map((doc) => [Number(doc.source_document_id), {
    textId: Number(doc.text_id),
    text: doc.normalized_text,
    institutionName: doc.institution_name,
  }]));
  const planned = planAccountSubjectCorrections(rows, sources);
  const result: AccountSubjectCorrectResult = { ...base, documentsChecked: due.length, rowsChecked: rows.length, corrected: planned };
  if (dryRun) return result;

  const applied: AccountSubjectCorrection[] = [];
  try {
    await inSavepoint(db, async (scope) => {
      for (const fix of planned) {
        // Only while the product is still missing and the fee is still the one judged.
        const updated = await scope<{ fee_raw_id: number | string }[]>`
          UPDATE raw_fee_observations
             SET product_name = ${fix.new}
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
          aboutStrategy: ACCOUNT_SUBJECT_CORRECT_STRATEGY.strategy,
          aboutVersion: ACCOUNT_SUBJECT_CORRECT_STRATEGY.version,
          signal: "right" as const,
          kind: ACCOUNT_SUBJECT_CORRECT_KIND,
          reportedBy: "knox" as const,
          checkName: ACCOUNT_SUBJECT_CORRECT_STRATEGY.strategy,
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
            excerpt: fix.excerpt,
            text_id: fix.textId,
          },
          runId: options.runId,
          dedupeKey: `${ACCOUNT_SUBJECT_CORRECT_STRATEGY.strategy}:raw:${fix.feeRawId}:product_name`,
        })));
      }
      for (const doc of due) {
        const documentId = Number(doc.source_document_id);
        const fixes = applied.filter((fix) => fix.sourceDocumentId === documentId);
        await recordAttempt(scope, {
          institutionId: Number(doc.institution_id),
          sourceDocumentId: documentId,
          stage: "extract",
          strategy: ACCOUNT_SUBJECT_CORRECT_STRATEGY.strategy,
          version: ACCOUNT_SUBJECT_CORRECT_STRATEGY.version,
          fingerprint: accountSubjectCorrectFingerprint(doc.text_id),
          outcome: fixes.length > 0 ? "ok" : "unchanged",
          yieldCount: fixes.length,
          costMicrousd: 0,
          runId: options.runId,
          stepId: options.stepId ?? null,
          foldIntoPlaybook: false,
          detail: { rows_corrected: fixes.length },
        });
      }
      const detail = accountSubjectCorrectDetail({ ...result, corrected: applied });
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${ACCOUNT_SUBJECT_CORRECT_STRATEGY.strategy}, 'completed',
          ${`Gave ${applied.length} live monthly or minimum balance fee row(s) with no account the account their own sentence names (${due.length} document(s) checked); old values kept in pipeline_feedback`},
          ${JSON.stringify(detail)}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("correctAccountSubjects write failed:", error);
    return { ...result, corrected: [], error: error instanceof Error ? error.message : String(error) };
  }
  if (applied.length > 0) invalidatePublicReadCache();
  return { ...result, corrected: applied };
}
