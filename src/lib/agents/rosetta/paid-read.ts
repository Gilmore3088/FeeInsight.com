import { sql } from "@/lib/data-store/connection";
import { EmergencyStopActiveError } from "@/lib/automation-control";
import { ProviderBudgetBlockedError } from "@/lib/ai-provider-usage";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { documentVaultSchemaReady, getDocumentVault, type DocumentVault } from "@/lib/agents/document-vault";
import { FEE_PAGE_CHECK_VERSION, scoreFeePage } from "@/lib/agents/learning/fee-page";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { detectFormat } from "@/lib/agents/learning/format";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import {
  emptyPaidPassResult,
  PAID_PASS_ITEMS_PER_RUN,
  PAID_PASS_MODELS,
  paidModelCall,
  paidResponseText,
  type PaidMessageCreator,
  type PaidPassResult,
  type PaidStepOptions,
} from "@/lib/agents/paid-pass";
import {
  AUXILIARY_READ_STRATEGIES,
  hashText,
  loadDocumentBytes,
  normalizeWhitespace,
  PAGE_CHECK_STRATEGY,
  recordReadResult,
  ROSETTA_READ_VERSION,
  rungTextNotWorse,
  sendBackToMagellan,
  type ReadResult,
} from "@/lib/agents/rosetta/read";
import { ALTERNATE_READERS, PRIMARY_READERS, TEXT_SURVIVAL_CHECK } from "@/lib/agents/rosetta/text-survival";
import {
  ROSETTA_TABLE_ROWS_VERSION,
  rosettaTextColumnsReady,
  rowsInText,
  TABLE_ROWS_STRATEGY,
  tableRowsFromText,
} from "@/lib/agents/rosetta/table-rows";

type SqlTag = typeof sql;

/**
 * `read.paid_transcribe`, Rosetta's pass 3. Scans that free OCR could not read (too many
 * pages, no page images, low confidence, timeout) go to the model as the PDF itself and
 * come back as a faithful plain-text transcription, table rows one per line with cells
 * joined by " | ". The text is stored like any other read, so Knox extracts it with the
 * same rules. Every call is budget-checked and cost-logged by paidModelCall; a budget cap
 * or the automation stop ends the step cleanly.
 *
 * Learning plan step 4: a text PDF whose fees did not hold up after both free readers had
 * it (the layout reader, then free OCR) comes here too. Its transcription replaces the
 * stored text only when it lists at least as many fees with an amount; otherwise the
 * earlier text stays and the attempt is logged `low_yield`, so it is not paid for again.
 *
 * JavaScript-only pages are not sent here: with no headless browser configured, the free
 * read hands them to Magellan's paid finder (see AGENTS.md).
 */

export const PAID_READ_STRATEGY = "read.paid_transcribe";
export const ROSETTA_PAID_READ_VERSION = 1;
/** The Messages API reads PDFs up to 100 pages. */
export const PAID_READ_MAX_PAGES = 100;
const PAID_READ_MAX_TOKENS = 16_000;
/** Outcomes that may succeed on a later try; any other paid attempt settles the document. */
const RETRYABLE_OUTCOMES: AttemptOutcome[] = ["timeout", "http_429", "http_5xx", "network_error"];
const NO_TEXT = "NO_TEXT";

export const PAID_READ_PROMPT = [
  "This PDF is a bank or credit union document, scanned as images. Transcribe it faithfully as plain text.",
  "Rules:",
  "- Copy the words and numbers exactly as printed. Do not summarize, explain, correct, or add anything.",
  "- Keep reading order. One line per printed line.",
  "- Write each table row on one line, with its cells separated by \" | \" (space, pipe, space), left to right.",
  "- Keep dollar signs, decimals, percentages and footnote markers as printed.",
  "- Mark a word you cannot read as [illegible]. Do not guess amounts.",
  `- If the document has no readable text, reply with exactly ${NO_TEXT}.`,
  "Reply with the transcription only.",
].join("\n");

interface PaidReadRow {
  source_document_id: number | string;
  institution_id: number | string;
  institution_name: string;
  document_url: string | null;
  content_hash: string;
  document_r2_key?: string | null;
  stored_content_type?: string | null;
  /** `needs_ocr` for a scan; `completed` for a text whose fees did not hold up. */
  text_status?: string | null;
  /** The stored text of a completed document, to compare the transcription with. */
  current_text?: string | null;
}

export interface RosettaPaidReadOptions extends PaidStepOptions {
  /** Test seams. */
  create?: PaidMessageCreator;
  fetchImpl?: typeof fetch;
  vault?: DocumentVault;
  pageCounter?: (bytes: Uint8Array) => Promise<number>;
}

async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    return Number(pdf.numPages ?? 0);
  } finally {
    await pdf.destroy?.();
  }
}

/**
 * Scans still `needs_ocr` after the current free reader (and its OCR) had them, and (with
 * the text-survival record) text PDFs whose fees did not hold up after free OCR had them
 * too, with no settled paid attempt for these bytes. Scans come first.
 */
async function selectPaidReadCandidates(
  db: SqlTag,
  limit: number,
  stateCode: string | undefined,
  vaultSchema: boolean,
  textSurvival = false,
): Promise<PaidReadRow[]> {
  const params: Array<number | string | string[]> = [];
  const limitParam = `$${params.push(limit)}`;
  const versionParam = `$${params.push(ROSETTA_READ_VERSION)}`;
  const auxiliaryParam = `$${params.push(AUXILIARY_READ_STRATEGIES)}`;
  const paidParam = `$${params.push(PAID_READ_STRATEGY)}`;
  const retryableParam = `$${params.push(RETRYABLE_OUTCOMES)}`;
  let stateFilter = "";
  const normalizedState = normalizeStateCode(stateCode);
  if (normalizedState) stateFilter = `AND upper(btrim(inst.state_code)) = $${params.push(normalizedState)}`;
  const vaultColumns = vaultSchema ? ", doc.document_r2_key, doc.content_type AS stored_content_type" : "";
  let lostAfterFreeReaders = "FALSE";
  if (textSurvival) {
    const survivalParam = `$${params.push(TEXT_SURVIVAL_CHECK)}`;
    const ocrParam = `$${params.push(ALTERNATE_READERS.pdf)}`;
    const layoutParam = `$${params.push(PRIMARY_READERS.pdf)}`;
    lostAfterFreeReaders = `(
             adt.status = 'completed'
             AND adt.document_type = 'pdf'
             AND EXISTS (
               SELECT 1 FROM pipeline_feedback lost
                WHERE lost.check_name = ${survivalParam}
                  AND lost.signal = 'wrong'
                  AND lost.source_document_id = adt.source_document_id
                  AND lost.evidence->>'text_hash' = adt.text_hash
             )
             AND (
               adt.reader = ${ocrParam}
               OR (
                 adt.reader = ${layoutParam}
                 AND EXISTS (
                   SELECT 1 FROM pipeline_attempts rung
                    WHERE rung.stage = 'read'
                      AND rung.institution_id = doc.institution_id
                      AND rung.input_fingerprint = doc.content_hash
                      AND rung.strategy = ${ocrParam}
                 )
               )
             )
           )`;
  }
  return db.unsafe<PaidReadRow[]>(
    `
      SELECT doc.id AS source_document_id,
             doc.institution_id,
             inst.institution_name,
             doc.document_url,
             doc.content_hash,
             adt.status AS text_status,
             CASE WHEN adt.status = 'completed' THEN adt.normalized_text END AS current_text${vaultColumns}
        FROM agent_source_texts adt
        JOIN source_documents doc
          ON doc.id = adt.source_document_id
         AND doc.content_hash = adt.source_hash
        JOIN institution_sources inst ON inst.id = doc.institution_id
       WHERE doc.status = 'success'
         AND doc.document_url IS NOT NULL
         ${stateFilter}
         AND (
           (
             adt.status = 'needs_ocr'
             AND EXISTS (
               -- Free first: the current reader (which escalates to free OCR) already tried.
               SELECT 1 FROM pipeline_attempts free_read
                WHERE free_read.stage = 'read'
                  AND free_read.institution_id = doc.institution_id
                  AND free_read.input_fingerprint = doc.content_hash
                  AND free_read.strategy <> ALL(${auxiliaryParam}::text[])
                  AND free_read.strategy_version >= ${versionParam}
             )
           )
           OR ${lostAfterFreeReaders}
         )
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts paid
            WHERE paid.stage = 'read'
              AND paid.institution_id = doc.institution_id
              AND paid.input_fingerprint = doc.content_hash
              AND paid.strategy = ${paidParam}
              AND paid.outcome <> ALL(${retryableParam}::text[])
         )
       ORDER BY (adt.status = 'needs_ocr') DESC, adt.updated_at DESC, adt.id DESC
       LIMIT ${limitParam}
    `,
    params,
  );
}

function isBudgetStop(error: unknown): boolean {
  return error instanceof ProviderBudgetBlockedError || error instanceof EmergencyStopActiveError;
}

function callFailureOutcome(error: unknown): AttemptOutcome {
  const status = Number((error as { status?: unknown })?.status);
  return classifyFetchFailure(Number.isFinite(status) && status > 0 ? status : null, error);
}

/** Pass 3 for Rosetta: read scans that the free readers could not. */
export async function runRosettaPaidRead(options: RosettaPaidReadOptions): Promise<PaidPassResult> {
  const dryRun = Boolean(options.dryRun);
  const result = emptyPaidPassResult(dryRun);
  const db = options.db ?? sql;
  // The selection is driven by the attempt log; without it there is nothing to pick safely.
  if (!(await learningSchemaReady(db))) return result;
  const vaultSchema = await documentVaultSchemaReady(db);
  const vault = vaultSchema ? options.vault ?? getDocumentVault() : null;
  const textColumns = !dryRun && (await rosettaTextColumnsReady(db));
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? PAID_PASS_ITEMS_PER_RUN)), PAID_PASS_ITEMS_PER_RUN);
  // The text-survival record needs the shared store and the reader column.
  // A dry run lists these too: the selection only reads.
  const textSurvival = (await rosettaTextColumnsReady(db)) && (await feedbackSchemaReady(db));
  const rows = await selectPaidReadCandidates(db, limit, options.stateCode, vaultSchema, textSurvival);
  result.selected = rows.length;
  if (dryRun) {
    result.results = rows.map((row) => ({ source_document_id: Number(row.source_document_id), institution_id: Number(row.institution_id), would_send: true }));
    return result;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const pageCounter = options.pageCounter ?? countPdfPages;
  const model = PAID_PASS_MODELS.read();

  for (const row of rows) {
    const startedAt = Date.now();
    const institutionId = Number(row.institution_id);
    const sourceDocumentId = Number(row.source_document_id);
    const sourceUrl = row.document_url ?? "";
    const record = async (outcome: AttemptOutcome, costMicrousd: number, yieldCount: number, detail: Record<string, unknown>) => {
      await recordAttempt(db, {
        institutionId,
        sourceDocumentId,
        stage: "read",
        strategy: PAID_READ_STRATEGY,
        version: ROSETTA_PAID_READ_VERSION,
        fingerprint: row.content_hash,
        outcome,
        yieldCount,
        costMicrousd,
        durationMs: Date.now() - startedAt,
        runId: options.runId,
        stepId: options.stepId ?? null,
        detail: { url: sourceUrl, model, ...detail },
      });
    };
    const fail = async (outcome: AttemptOutcome, error: string, costMicrousd = 0) => {
      result.processed += 1;
      result.failed += 1;
      result.costMicrousd += costMicrousd;
      result.results.push({ source_document_id: sourceDocumentId, institution_id: institutionId, outcome, error, cost_microusd: costMicrousd });
      await record(outcome, costMicrousd, 0, { error });
    };

    const loaded = await loadDocumentBytes(
      { sourceUrl, vaultKey: row.document_r2_key, storedContentType: row.stored_content_type },
      fetchImpl,
      vault,
    );
    if (!loaded.ok) {
      await fail(loaded.outcome, loaded.error);
      continue;
    }
    if (detectFormat(loaded.bytes, loaded.contentType, loaded.finalUrl) !== "pdf") {
      await fail("unsupported_format", "Stored document is no longer a PDF");
      continue;
    }
    let pages: number | null = null;
    try {
      pages = await pageCounter(loaded.bytes);
    } catch {
      pages = null; // Let the model try; it reads some PDFs pdf.js cannot.
    }
    if (pages != null && pages > PAID_READ_MAX_PAGES) {
      await fail("too_large", `${pages} pages; the paid reader takes at most ${PAID_READ_MAX_PAGES}`);
      continue;
    }

    let text: string;
    let costMicrousd: number;
    let truncated: boolean;
    try {
      const call = await paidModelCall({
        agent: "rosetta",
        operation: "paid_read",
        runId: options.runId,
        create: options.create,
        metadata: { institution_id: institutionId, source_document_id: sourceDocumentId, pages },
        params: {
          model,
          max_tokens: PAID_READ_MAX_TOKENS,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: { type: "base64", media_type: "application/pdf", data: Buffer.from(loaded.bytes).toString("base64") },
                },
                { type: "text", text: PAID_READ_PROMPT },
              ],
            },
          ],
        },
      });
      text = normalizeWhitespace(paidResponseText(call.message));
      costMicrousd = call.costMicrousd;
      truncated = call.message.stop_reason === "max_tokens";
    } catch (error) {
      if (isBudgetStop(error)) {
        // Nothing was spent on this document; it stays queued for the next budget window.
        result.budgetStopped = true;
        result.budgetReason = error instanceof Error ? error.message : String(error);
        break;
      }
      await fail(callFailureOutcome(error), `Paid read failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (!text || text === NO_TEXT) {
      await fail("empty", "The model found no readable text", costMicrousd);
      continue;
    }

    // A text PDF already has a stored text with live fees: keep it unless this one is no thinner.
    const replacesText = row.text_status === "completed";
    if (replacesText && !rungTextNotWorse(text, row.current_text ?? "")) {
      result.processed += 1;
      result.succeeded += 1;
      result.costMicrousd += costMicrousd;
      result.results.push({ source_document_id: sourceDocumentId, institution_id: institutionId, outcome: "low_yield", chars: text.length, pages, cost_microusd: costMicrousd });
      await record("low_yield", costMicrousd, text.length, { pages, truncated, kept_earlier_text: true });
      continue;
    }

    const pageCheck = vaultSchema ? scoreFeePage(text) : null;
    const wrong = pageCheck?.verdict === "wrong_document";
    const rows = rowsInText(tableRowsFromText(text, "paid_transcription"), text);
    const textHash = hashText(text);
    const read: ReadResult = {
      sourceDocumentId,
      institutionId,
      institutionName: String(row.institution_name),
      sourceUrl: row.document_url,
      status: wrong ? "wrong_document" : "completed",
      documentType: "pdf",
      contentType: loaded.contentType,
      sourceHash: row.content_hash,
      textHash,
      charCount: text.length,
      error: wrong ? pageCheck.reason : null,
      attemptOutcome: wrong ? "wrong_document" : truncated ? "ok_partial" : "ok",
      strategy: PAID_READ_STRATEGY,
      format: replacesText ? "pdf_text" : "pdf_scanned",
      routerReason: replacesText ? "fees from the free readers' texts did not hold up" : null,
      fromVault: loaded.fromVault,
      pageCheck,
      tableRows: rows.length,
      rows,
      reader: PAID_READ_STRATEGY,
      followUps: [],
      handoff: null,
      reread: false,
      durationMs: Date.now() - startedAt,
    };
    await recordReadResult(db, options.runId, read, text, textColumns);
    if (wrong) {
      await sendBackToMagellan(db, {
        institutionId,
        sourceDocumentId,
        url: row.document_url,
        reason: pageCheck.reason,
      });
    }
    result.processed += 1;
    result.succeeded += 1;
    result.costMicrousd += costMicrousd;
    result.results.push({
      source_document_id: sourceDocumentId,
      institution_id: institutionId,
      outcome: read.attemptOutcome,
      chars: text.length,
      table_rows: rows.length,
      pages,
      cost_microusd: costMicrousd,
    });
    await record(read.attemptOutcome!, costMicrousd, text.length, { pages, table_rows: rows.length, truncated, page_check: pageCheck });
    if (textColumns && rows.length > 0) {
      await recordAttempt(db, {
        institutionId,
        sourceDocumentId,
        stage: "read",
        strategy: TABLE_ROWS_STRATEGY,
        version: ROSETTA_TABLE_ROWS_VERSION,
        fingerprint: textHash,
        outcome: "ok",
        yieldCount: rows.length,
        costMicrousd: 0,
        runId: options.runId,
        stepId: options.stepId ?? null,
        detail: { origins: ["paid_transcription"] },
      });
    }
    if (vaultSchema) {
      await recordAttempt(db, {
        institutionId,
        sourceDocumentId,
        stage: "read",
        strategy: PAGE_CHECK_STRATEGY,
        version: FEE_PAGE_CHECK_VERSION,
        fingerprint: textHash,
        outcome: wrong ? "wrong_document" : "ok",
        yieldCount: pageCheck?.feeLines ?? 0,
        costMicrousd: 0,
        runId: options.runId,
        stepId: options.stepId ?? null,
        detail: { url: row.document_url, ...(pageCheck ?? {}) },
      });
    }
  }
  return result;
}
