import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Whether the fees Knox pulled from Rosetta's text held up (learning plan steps 1 to 4).
 *
 * For each document's current completed text, Rosetta counts the published fees Knox
 * extracted from it since that text first appeared: how many are live, and how many
 * Hamilton took down for a reason the text itself can cause (the fee is not reproduced
 * from the text, its name is not in the text, the amount is not the fee's, or no amount).
 * Each count is one judgement in the shared learning store (`pipeline_feedback`), about
 * the reader that wrote the text:
 *   - `right` / `text_held_up`, weight = live fees, or
 *   - `wrong` / `text_lost_fees`, weight = lost fees, when at least
 *     `TEXT_LOSS_MIN_FEES` were lost and they are `TEXT_LOSS_MIN_SHARE` of the judged fees.
 * Category and range takedowns are Knox's and Darwin's, not the text's, and are left out.
 *
 * The read step uses these rows to pick the next reader up the ladder (`nextReaderRung`)
 * for a document whose text lost fees, and for a bank whose texts from one reader keep
 * losing them. The paid pass takes PDFs whose text lost fees.
 */

export const TEXT_SURVIVAL_CHECK = "rosetta.text_survival";
export const TEXT_SURVIVAL_VERSION = 1;
/** Takedown reasons Rosetta's text can cause (`published_fee_records.rolled_back_reason`). */
export const TEXT_LOSS_REASONS = [
  "rules_recheck_unreproduced",
  "source_check_untraceable:name_not_in_text",
  "source_check_untraceable:amount_not_the_fee",
  "source_check_untraceable:no_amount",
];
export const TEXT_LOSS_MIN_FEES = 3;
export const TEXT_LOSS_MIN_SHARE = 0.25;
/** The scores are rebuilt at most this often; the query reads every published fee. */
export const TEXT_SURVIVAL_REFRESH_HOURS = 20;

export const PRIMARY_READERS = {
  pdf: "read.pdf_layout",
  html: "read.html_dom",
} as const;
/**
 * The free reader one rung up from each primary reader. A PDF with a text layer has none:
 * free OCR reads only page images, and of 96 text-layer PDFs sent to it (Oct 6 to 7) it
 * replaced none of their texts, so a PDF whose text lost fees goes to the paid pass.
 */
export const ALTERNATE_READERS: Partial<Record<keyof typeof PRIMARY_READERS, string>> = {
  html: "read.js_fallback",
};

/** Texts written before readers were recorded. */
export function legacyReader(documentType: string | null): string {
  return `legacy.${documentType || "unknown"}`;
}

export function textLostFees(live: number, lost: number): boolean {
  return lost >= TEXT_LOSS_MIN_FEES && lost / Math.max(1, live + lost) >= TEXT_LOSS_MIN_SHARE;
}

/** One reader's record at one bank, from its `text_survival` rows. */
export interface ReaderRecord {
  held: number;
  lost: number;
}

/**
 * The reader a document should be read with, given the reader its last text came from
 * and the bank's record per reader:
 *   - a legacy text (no reader recorded) that lost fees → the current primary reader;
 *   - a primary-reader text that lost fees → the free alternate (the JavaScript
 *     fallbacks for a web page; a PDF has none and goes to the paid pass);
 *   - a new document at a bank where the primary reader lost fees at least as often as
 *     it held → the alternate as well.
 * Otherwise null: the normal reader. The alternate's text replaces the primary's only
 * when it is a fee page with at least as many amounts (see `read.ts`).
 */
export function nextReaderRung(
  format: "pdf" | "html" | string,
  options: { lastReader?: string | null; lastTextLost?: boolean; bankRecord?: Record<string, ReaderRecord> | null },
): string | null {
  if (format !== "pdf" && format !== "html") return null;
  const primary = PRIMARY_READERS[format];
  const alternate = ALTERNATE_READERS[format];
  if (!alternate) return null;
  if (options.lastTextLost) {
    if (options.lastReader === legacyReader(format)) return null; // The primary reader re-reads it.
    if (options.lastReader === primary) return alternate;
  }
  const record = options.bankRecord?.[primary];
  if (record && record.lost > 0 && record.lost >= record.held) return alternate;
  return null;
}

export interface TextSurvivalResult {
  ready: boolean;
  /** False when the scores were rebuilt less than `TEXT_SURVIVAL_REFRESH_HOURS` ago. */
  refreshed: boolean;
  texts: number;
  held: number;
  lost: number;
  written: number;
}

interface SurvivalRow {
  text_id: number | string;
  source_document_id: number | string;
  institution_id: number | string;
  source_url: string | null;
  text_hash: string;
  reader: string;
  live: number | string;
  lost: number | string;
  other_down: number | string;
  reasons: Record<string, number> | null;
}

/**
 * Rebuilds the per-text judgements at most once per `TEXT_SURVIVAL_REFRESH_HOURS`. Read-only
 * on every table but `pipeline_feedback`; a dry run computes and writes nothing.
 */
export async function syncTextSurvival(
  db: SqlTag,
  options: { runId: number | null; dryRun?: boolean; force?: boolean },
): Promise<TextSurvivalResult> {
  const result: TextSurvivalResult = { ready: false, refreshed: false, texts: 0, held: 0, lost: 0, written: 0 };
  if (options.dryRun || !(await feedbackSchemaReady(db))) return result;
  result.ready = true;
  if (!options.force) {
    const [recent] = await db`
      SELECT EXISTS (
        SELECT 1 FROM pipeline_feedback
         WHERE check_name = ${TEXT_SURVIVAL_CHECK}
           AND updated_at > NOW() - make_interval(hours => ${TEXT_SURVIVAL_REFRESH_HOURS})
      ) AS fresh
    `;
    if (recent?.fresh === true) return result;
  }
  result.refreshed = true;
  const rows = await inSavepoint(db, (scope) => scope<SurvivalRow[]>`
    WITH texts AS (
      SELECT adt.id AS text_id, adt.source_document_id, adt.institution_id, adt.source_url, adt.text_hash,
             COALESCE(adt.reader, 'legacy.' || COALESCE(adt.document_type, 'unknown')) AS reader,
             -- Fees count from the time this exact text first appeared (its first page check).
             COALESCE((
               SELECT MIN(pc.created_at) FROM pipeline_attempts pc
                WHERE pc.input_fingerprint = adt.text_hash AND pc.strategy = 'read.page_check'
             ), '-infinity'::timestamptz) AS text_since
        FROM agent_source_texts adt
       WHERE adt.status = 'completed' AND adt.text_hash IS NOT NULL
    ),
    fees AS (
      SELECT t.text_id, fp.rolled_back_at IS NULL AS live, fp.rolled_back_reason
        FROM texts t
        JOIN raw_fee_observations fr
          ON fr.source = 'knox' AND fr.source_document_id = t.source_document_id AND fr.created_at >= t.text_since
        JOIN verified_fee_observations fv ON fv.fee_raw_id = fr.fee_raw_id
        JOIN published_fee_records fp ON fp.lineage_ref = fv.fee_verified_id
    ),
    reasons AS (
      SELECT text_id, jsonb_object_agg(rolled_back_reason, n) AS reasons
        FROM (
          SELECT text_id, rolled_back_reason, COUNT(*) AS n FROM fees
           WHERE NOT live AND rolled_back_reason = ANY(${TEXT_LOSS_REASONS}::text[])
           GROUP BY 1, 2
        ) grouped
       GROUP BY text_id
    )
    SELECT t.text_id, t.source_document_id, t.institution_id, t.source_url, t.text_hash, t.reader,
           COUNT(*) FILTER (WHERE f.live) AS live,
           COUNT(*) FILTER (WHERE f.rolled_back_reason = ANY(${TEXT_LOSS_REASONS}::text[])) AS lost,
           COUNT(*) FILTER (WHERE NOT f.live AND f.rolled_back_reason <> ALL(${TEXT_LOSS_REASONS}::text[])) AS other_down,
           r.reasons
      FROM texts t
      JOIN fees f USING (text_id)
      LEFT JOIN reasons r USING (text_id)
     GROUP BY t.text_id, t.source_document_id, t.institution_id, t.source_url, t.text_hash, t.reader, r.reasons
  `);

  const feedback: FeedbackRow[] = [];
  for (const row of rows) {
    const live = Number(row.live);
    const lost = Number(row.lost);
    if (live + lost === 0) continue;
    const wrong = textLostFees(live, lost);
    result.texts += 1;
    if (wrong) result.lost += 1;
    else result.held += 1;
    feedback.push({
      aboutStage: "read",
      aboutStrategy: row.reader,
      signal: wrong ? "wrong" : "right",
      kind: wrong ? "text_lost_fees" : "text_held_up",
      reportedBy: "rosetta",
      checkName: TEXT_SURVIVAL_CHECK,
      institutionId: Number(row.institution_id),
      sourceDocumentId: Number(row.source_document_id),
      sourceUrl: row.source_url,
      weight: wrong ? lost : live,
      evidence: {
        text_id: Number(row.text_id),
        text_hash: row.text_hash,
        live,
        lost,
        other_taken_down: Number(row.other_down),
        reasons: row.reasons ?? {},
        version: TEXT_SURVIVAL_VERSION,
      },
      runId: options.runId,
      // One judgement per text: a new text from another reader gets its own row.
      dedupeKey: `${TEXT_SURVIVAL_CHECK}:doc:${row.source_document_id}:${row.text_hash}`,
    });
  }
  result.written = await inSavepoint(db, (scope) => recordFeedback(scope, feedback));
  return result;
}

export interface ReaderScore {
  reader: string;
  texts: number;
  held: number;
  lost: number;
  liveFees: number;
  lostFees: number;
  /** Share of judged fees still live, 0 to 1; null with no judged fee. */
  survival: number | null;
}

/** Each reader's score across all banks, from the current judgements. Read-only. */
export async function readReaderScores(db: SqlTag): Promise<ReaderScore[]> {
  if (!(await feedbackSchemaReady(db))) return [];
  const rows = await db<Array<{ reader: string; texts: number | string; held: number | string; lost: number | string; live_fees: number | string; lost_fees: number | string }>>`
    SELECT about_strategy AS reader,
           COUNT(*) AS texts,
           COUNT(*) FILTER (WHERE signal = 'right') AS held,
           COUNT(*) FILTER (WHERE signal = 'wrong') AS lost,
           COALESCE(SUM((evidence->>'live')::numeric), 0) AS live_fees,
           COALESCE(SUM((evidence->>'lost')::numeric), 0) AS lost_fees
      FROM pipeline_feedback
     WHERE check_name = ${TEXT_SURVIVAL_CHECK}
     GROUP BY about_strategy
     ORDER BY COUNT(*) DESC
  `;
  return rows.map((row) => {
    const liveFees = Number(row.live_fees);
    const lostFees = Number(row.lost_fees);
    return {
      reader: row.reader,
      texts: Number(row.texts),
      held: Number(row.held),
      lost: Number(row.lost),
      liveFees,
      lostFees,
      survival: liveFees + lostFees > 0 ? liveFees / (liveFees + lostFees) : null,
    };
  });
}
