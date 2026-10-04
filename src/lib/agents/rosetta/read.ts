import { createHash } from "crypto";

import { sql, stripNulChars } from "@/lib/data-store/connection";
import {
  normalizeStateCode,
  readStrategyFromDocumentType,
  sourceKindFromDocumentType,
} from "@/lib/agents/state-lane-memory";
import { crawlerUserAgent } from "@/lib/agents/crawler-identity";
import {
  documentVaultSchemaReady,
  getDocumentVault,
  isVaultKey,
  type DocumentVault,
} from "@/lib/agents/document-vault";
import { FEE_PAGE_CHECK_VERSION, scoreFeePage, type FeePageScore } from "@/lib/agents/learning/fee-page";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import {
  detectFormat,
  documentTypeForFormat,
  isLikelyScannedPdf,
  type DocumentFormat,
  type PlaybookFormat,
} from "@/lib/agents/learning/format";
import {
  classifyFetchFailure,
  countOutcomes,
  PERMANENT_OUTCOMES,
  type AttemptOutcome,
} from "@/lib/agents/learning/outcomes";
import { playbookFromRow } from "@/lib/agents/learning/playbook";
import { chooseStrategy, type StrategyCandidate } from "@/lib/agents/learning/router";
import { extractHtmlDomText } from "@/lib/agents/rosetta/html-dom";
import { layoutDocumentText, type PdfTextItem } from "@/lib/agents/rosetta/pdf-layout";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

export const ROSETTA_READ_DEFAULT_LIMIT = 25;
export const ROSETTA_READ_MAX_LIMIT = 50;

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TEXT_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 150;
const PDF_EXTRACTION_TIMEOUT_MS = 20_000;

interface ReadCandidateRow {
  source_document_id: number | string;
  institution_id: number | string;
  institution_name: string;
  document_url: string | null;
  content_hash: string | null;
  /** Vault columns, present once the document-vault migration is applied. */
  document_r2_key?: string | null;
  stored_content_type?: string | null;
  /** Playbook columns, present once the learning-core migration is applied. */
  format?: string | null;
  best_strategy?: unknown;
  strategy_stats?: unknown;
  do_not_retry?: unknown;
  /** True when an older reader version already produced a text for these bytes. */
  is_reread?: boolean | null;
}

/** `known_failure` is the router's skip: nothing is fetched again or written. */
type ReadStatus = "completed" | "empty" | "needs_ocr" | "failed" | "skipped" | "known_failure" | "wrong_document";

interface PdfTextExtraction {
  text: string;
  totalPages: number;
}

type PdfTextExtractor = (bytes: Uint8Array) => Promise<PdfTextExtraction>;

interface ReadResult {
  sourceDocumentId: number;
  institutionId: number;
  institutionName: string;
  sourceUrl: string | null;
  status: ReadStatus;
  documentType: string | null;
  contentType: string | null;
  sourceHash: string | null;
  textHash: string | null;
  charCount: number;
  error: string | null;
  attemptOutcome: AttemptOutcome | null;
  strategy: string | null;
  format: PlaybookFormat | null;
  routerReason: string | null;
  /** True when the bytes came from our stored copy instead of a new download. */
  fromVault: boolean;
  pageCheck: FeePageScore | null;
  /** HTML data-table rows written as one line each. */
  tableRows: number;
  /** Read again because an older reader version's text yielded no Knox fees. */
  reread: boolean;
  durationMs: number;
}

export interface RunRosettaReadOptions {
  runId: number;
  stepId?: number;
  limit?: number;
  institutionId?: number;
  stateCode?: string;
  dryRun?: boolean;
  db?: SqlTag;
  fetchImpl?: Fetcher;
  pdfTextExtractor?: PdfTextExtractor;
  vault?: DocumentVault;
}

export interface RunRosettaReadResult {
  selected: number;
  processed: number;
  completed: number;
  empty: number;
  needsOcr: number;
  failed: number;
  skipped: number;
  /** Inputs the router refused because they already failed with this reader version. */
  skippedKnownFailures: number;
  /** Read, but not a fee schedule: Knox skips them and Magellan looks again. */
  wrongDocuments: number;
  readFromVault: number;
  /** Texts from an older reader version read again with the current one. */
  reread: number;
  /** HTML data-table rows written as one line each across this run. */
  tableRows: number;
  /** Earlier texts re-checked with the fee-page check this run, and how many failed it. */
  triagedTexts: number;
  triagedWrongDocuments: number;
  /** Institutions whose fee URL was cleared so Magellan finds the real fee page. */
  sentBackToMagellan: number;
  chars: number;
  limit: number;
  dryRun: boolean;
  learning: boolean;
  outcomes: Partial<Record<AttemptOutcome, number>>;
  results: ReadResult[];
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return ROSETTA_READ_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), ROSETTA_READ_MAX_LIMIT);
}

function normalizeHttpUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeWhitespace(value: string): string {
  // Postgres text rejects NUL; drop it here so the hash and char count match what is stored.
  return stripNulChars(value)
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    // Lines that were only spaces are empty now; collapse the runs they leave.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHtmlText(html: string): { text: string; tableRows: number } {
  const extracted = extractHtmlDomText(html);
  return { text: normalizeWhitespace(extracted.text), tableRows: extracted.tableRows };
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function extractPdfText(bytes: Uint8Array): Promise<PdfTextExtraction> {
  const { getDocumentProxy } = await import("unpdf");
  return withTimeout(
    (async () => {
      const pdf = await getDocumentProxy(bytes, {
        maxImageSize: 16_777_216,
      });

      try {
        const totalPages = Number(pdf.numPages ?? 0);
        if (totalPages > MAX_PDF_PAGES) {
          throw new Error(`PDF has too many pages for Rosetta text read: ${totalPages}`);
        }

        // Lines rebuilt from item positions keep a fee name and its amount together.
        const pages: PdfTextItem[][] = [];
        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const items: PdfTextItem[] = [];
          for (const item of content.items) {
            if ("str" in item) items.push(item);
          }
          pages.push(items);
        }
        return { text: layoutDocumentText(pages), totalPages };
      } finally {
        await pdf.destroy?.();
      }
    })(),
    PDF_EXTRACTION_TIMEOUT_MS,
    "PDF text extraction",
  );
}

async function fetchWithTimeout(fetchImpl: Fetcher, url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": crawlerUserAgent("Rosetta"),
        Accept: "text/html,text/plain,application/pdf;q=0.9,*/*;q=0.5",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read strategies by detected format. Bump ROSETTA_READ_VERSION when any of them changes.
 * Version 2: HTML through a parsed DOM (one line per table row) and PDF lines rebuilt
 * from item positions. Completed texts from an older version that Knox found nothing
 * in are read again once.
 */
export const ROSETTA_READ_VERSION = 2;
const PAGE_CHECK_STRATEGY = "read.page_check";
const SETTLED_READ_OUTCOMES: AttemptOutcome[] = ["ok", "ok_partial", "unchanged", "low_yield"];
const READ_STRATEGIES: Record<DocumentFormat, StrategyCandidate[]> = {
  pdf: [{ strategy: "read.pdf_layout", version: ROSETTA_READ_VERSION, costMicrousd: 0, formats: ["pdf_text"] }],
  html: [{ strategy: "read.html_dom", version: ROSETTA_READ_VERSION, costMicrousd: 0, formats: ["html_static"] }],
  text: [{ strategy: "read.plain_text", version: ROSETTA_READ_VERSION, costMicrousd: 0, formats: ["text"] }],
  docx: [],
  other: [],
};

function pdfFailureOutcome(error: unknown): AttemptOutcome {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) return "timeout";
  if (/too many pages/i.test(message)) return "too_large";
  return "parse_error";
}

async function readCandidate(
  row: ReadCandidateRow,
  fetchImpl: Fetcher,
  pdfTextExtractor: PdfTextExtractor,
  vault: DocumentVault | null = null,
  checkPage = false,
): Promise<{
  result: ReadResult;
  normalizedText: string | null;
}> {
  const startedAt = Date.now();
  const sourceUrl = normalizeHttpUrl(row.document_url);
  const base: Omit<ReadResult, "status" | "error" | "attemptOutcome" | "durationMs"> = {
    sourceDocumentId: Number(row.source_document_id),
    institutionId: Number(row.institution_id),
    institutionName: String(row.institution_name),
    sourceUrl: sourceUrl ?? row.document_url,
    documentType: null,
    contentType: null,
    sourceHash: row.content_hash,
    textHash: null,
    charCount: 0,
    strategy: null,
    format: null,
    routerReason: null,
    fromVault: false,
    pageCheck: null,
    tableRows: 0,
    reread: row.is_reread === true,
  };
  const finish = (
    fields: Partial<ReadResult> & Pick<ReadResult, "status" | "error" | "attemptOutcome">,
    normalizedText: string | null = null,
  ) => ({
    normalizedText,
    result: { ...base, ...fields, durationMs: Date.now() - startedAt },
  });

  if (!sourceUrl) {
    return finish({ status: "skipped", error: "Invalid or missing document_url", attemptOutcome: "invalid_url" });
  }

  // Our stored copy first: no second download, and the exact bytes Magellan saw.
  let bytes: Uint8Array | null = null;
  let finalUrl = sourceUrl;
  if (vault?.configured && isVaultKey(row.document_r2_key)) {
    try {
      bytes = await vault.read(row.document_r2_key);
      base.contentType = row.stored_content_type ?? null;
      base.fromVault = true;
    } catch (error) {
      console.error(`Vault read failed for ${row.document_r2_key}; downloading instead:`, error);
      bytes = null;
    }
  }
  if (!bytes) {
    let response: Response;
    try {
      response = await fetchWithTimeout(fetchImpl, sourceUrl);
    } catch (error) {
      return finish({
        status: "failed",
        error: `Read fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        attemptOutcome: classifyFetchFailure(null, error),
      });
    }

    base.contentType = response.headers.get("content-type");
    finalUrl = response.url || sourceUrl;
    base.documentType = documentTypeForFormat(detectFormat(null, base.contentType, finalUrl));
    if (!response.ok) {
      return finish({ status: "failed", error: `HTTP ${response.status}`, attemptOutcome: classifyFetchFailure(response.status) });
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_TEXT_DOCUMENT_BYTES) {
      return finish({
        status: "failed",
        error: `Document too large for Rosetta text read: ${contentLength} bytes`,
        attemptOutcome: "too_large",
      });
    }

    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return finish({
        status: "failed",
        error: `Read failed: ${error instanceof Error ? error.message : String(error)}`,
        attemptOutcome: classifyFetchFailure(null, error),
      });
    }
    if (bytes.byteLength > MAX_TEXT_DOCUMENT_BYTES) {
      return finish({
        status: "failed",
        error: `Document too large for Rosetta text read: ${bytes.byteLength} bytes`,
        attemptOutcome: "too_large",
      });
    }
  }

  // The bytes, not the URL or the declared type, decide how to read the document.
  const format = detectFormat(bytes, base.contentType, finalUrl);
  base.documentType = documentTypeForFormat(format);
  const decision = chooseStrategy({
    stage: "read",
    playbook: playbookFromRow(row),
    fingerprint: row.content_hash,
    candidates: READ_STRATEGIES[format],
  });
  if (decision.kind === "skip") {
    if (decision.reason === "known_failure") {
      return finish({ status: "known_failure", error: decision.detail, attemptOutcome: null, routerReason: decision.detail });
    }
    return finish({
      status: "failed",
      error: `No reader for ${format === "docx" ? "Word" : format} documents yet`,
      attemptOutcome: "unsupported_format",
      format: format === "docx" ? "docx" : "other",
      routerReason: decision.detail,
    });
  }
  base.strategy = decision.strategy;
  base.routerReason = decision.reason;

  /** A readable text: completed, unless the fee-page check says it is not a fee schedule. */
  const finishRead = (normalizedText: string, learnedFormat: PlaybookFormat) => {
    const pageCheck = checkPage ? scoreFeePage(normalizedText) : null;
    const wrong = pageCheck?.verdict === "wrong_document";
    return finish(
      {
        status: wrong ? "wrong_document" : "completed",
        textHash: hashText(normalizedText),
        charCount: normalizedText.length,
        error: wrong ? pageCheck.reason : null,
        attemptOutcome: wrong ? "wrong_document" : "ok",
        format: learnedFormat,
        pageCheck,
      },
      normalizedText,
    );
  };

  if (format === "pdf") {
    try {
      const extracted = await pdfTextExtractor(bytes);
      const normalizedText = normalizeWhitespace(extracted.text);
      if (normalizedText.length === 0 || isLikelyScannedPdf(normalizedText, extracted.totalPages)) {
        return finish(
          {
            status: "needs_ocr",
            charCount: normalizedText.length,
            error:
              normalizedText.length === 0
                ? `No embedded PDF text found across ${extracted.totalPages} pages; OCR required`
                : `Only ${normalizedText.length} characters of embedded text across ${extracted.totalPages} pages; likely a scan, OCR required`,
            attemptOutcome: "scanned_pdf",
            format: "pdf_scanned",
          },
          normalizedText,
        );
      }
      return finishRead(normalizedText, "pdf_text");
    } catch (error) {
      return finish({
        status: "failed",
        error: `PDF text extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        attemptOutcome: pdfFailureOutcome(error),
      });
    }
  }

  const raw = new TextDecoder("utf-8").decode(bytes);
  let normalizedText: string;
  if (format === "html") {
    const extracted = extractHtmlText(raw);
    normalizedText = extracted.text;
    base.tableRows = extracted.tableRows;
  } else {
    normalizedText = normalizeWhitespace(raw);
  }
  if (normalizedText.length === 0) {
    return finish(
      {
        status: "empty",
        error: "No readable text found",
        // An HTML page with no text is almost always rendered by JavaScript.
        attemptOutcome: format === "html" ? "js_required" : "empty",
        format: format === "html" ? "html_js" : "text",
      },
      normalizedText,
    );
  }
  return finishRead(normalizedText, format === "html" ? "html_static" : "text");
}

async function selectCandidates(
  db: SqlTag,
  limit: number,
  learning: boolean,
  institutionId?: number,
  stateCode?: string,
  vaultSchema = false,
): Promise<ReadCandidateRow[]> {
  const params: Array<number | string | string[]> = [limit];
  const filters: string[] = [];
  if (institutionId) {
    params.push(institutionId);
    filters.push(`AND cr.institution_id = $${params.length}`);
  }
  const normalizedState = normalizeStateCode(stateCode);
  if (normalizedState) {
    params.push(normalizedState);
    filters.push(`AND upper(btrim(ct.state_code)) = $${params.length}`);
  }
  let playbookColumns = "";
  // Without the attempt log there is no reader version to compare, so never re-read.
  let rereadable = "FALSE";
  if (learning) {
    // Skip inputs that already failed permanently with the current reader version.
    params.push(ROSETTA_READ_VERSION, PERMANENT_OUTCOMES);
    const versionParam = `$${params.length - 1}`;
    // Only an answer settles a re-read; a timeout or 5xx leaves it eligible next run.
    params.push([...PERMANENT_OUTCOMES, ...SETTLED_READ_OUTCOMES]);
    const settledParam = `$${params.length}`;
    // A completed text from an older reader that Knox found no fees in gets one read
    // with the current reader. Texts Knox already extracted from are left alone.
    rereadable = `(
                adt.status = 'completed'
                AND NOT EXISTS (
                  SELECT 1 FROM raw_fee_observations fr
                   WHERE fr.source = 'knox' AND fr.source_document_id = adt.source_document_id
                )
                AND NOT EXISTS (
                  SELECT 1 FROM pipeline_attempts current_read
                   WHERE current_read.stage = 'read'
                     AND current_read.strategy <> '${PAGE_CHECK_STRATEGY}'
                     AND current_read.institution_id = adt.institution_id
                     AND current_read.input_fingerprint = adt.source_hash
                     AND current_read.strategy_version >= ${versionParam}
                     AND current_read.outcome = ANY(${settledParam}::text[])
                )
              )`;
    playbookColumns = `,
             profile.format,
             profile.best_strategy,
             profile.strategy_stats,
             profile.do_not_retry,
             EXISTS (
               SELECT 1 FROM agent_source_texts prior
                WHERE prior.status = 'completed'
                  AND (
                    (prior.source_document_id = cr.id AND prior.source_hash IS NOT DISTINCT FROM cr.content_hash)
                    OR (cr.content_hash IS NOT NULL AND prior.institution_id = cr.institution_id AND prior.source_hash = cr.content_hash)
                  )
             ) AS is_reread`;
    filters.push(`AND NOT EXISTS (
           SELECT 1
             FROM pipeline_attempts pa
            WHERE pa.stage = 'read'
              AND pa.institution_id = cr.institution_id
              AND pa.input_fingerprint = cr.content_hash
              AND pa.strategy_version = $${params.length - 1}
              AND pa.outcome = ANY($${params.length}::text[])
         )`);
  }
  const vaultColumns = vaultSchema
    ? `,
             cr.document_r2_key,
             cr.content_type AS stored_content_type`
    : "";
  return db.unsafe<ReadCandidateRow[]>(
    `
      SELECT cr.id AS source_document_id,
             cr.institution_id,
             ct.institution_name,
             cr.document_url,
             cr.content_hash${playbookColumns}${vaultColumns}
        FROM source_documents cr
        JOIN institution_sources ct ON ct.id = cr.institution_id
        LEFT JOIN institution_source_profiles profile
          ON profile.institution_id = ct.id
       WHERE cr.status = 'success'
         AND cr.document_url IS NOT NULL
         ${filters.join("\n         ")}
         AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
         AND (
           profile.read_strategy IS NULL
           OR profile.read_strategy IN ('pdf_text', 'html_dom')
         )
         AND NOT EXISTS (
           SELECT 1
             FROM agent_source_texts adt
            WHERE adt.status IN ('completed', 'empty', 'needs_ocr', 'wrong_document')
              AND (
                (adt.source_document_id = cr.id AND adt.source_hash IS NOT DISTINCT FROM cr.content_hash)
                -- The same bytes stored under another document id were already read.
                OR (cr.content_hash IS NOT NULL AND adt.institution_id = cr.institution_id AND adt.source_hash = cr.content_hash)
              )
              AND NOT ${rereadable}
         )
       ORDER BY ${learning ? "is_reread ASC, " : ""}cr.crawled_at DESC NULLS LAST, cr.id DESC
       LIMIT $1
    `,
    params,
  );
}

function readStrategyForResult(result: ReadResult): "pdf_text" | "html_dom" | "browser_render" | "ocr" | "manual_review" | null {
  if (result.status === "needs_ocr") return "ocr";
  if (result.status === "empty" && result.documentType === "html") return "browser_render";
  if (result.status === "skipped") return "manual_review";
  if (result.status === "completed") return readStrategyFromDocumentType(result.documentType);
  return readStrategyFromDocumentType(result.documentType);
}

function sourceKindForResult(result: ReadResult): "pdf" | "html" | "scanned_pdf" | "unknown" {
  if (result.status === "needs_ocr") return "scanned_pdf";
  return sourceKindFromDocumentType(result.documentType);
}

async function recordReadResult(
  db: SqlTag,
  runId: number,
  result: ReadResult,
  normalizedText: string | null,
): Promise<void> {
  const [textArtifact] = await db`
    INSERT INTO agent_source_texts
      (agent_run_id, source_document_id, institution_id, source_url,
       document_type, content_type, source_hash, status, normalized_text,
       text_hash, char_count, error_message, updated_at)
    VALUES
      (${runId}, ${result.sourceDocumentId}, ${result.institutionId}, ${result.sourceUrl},
       ${result.documentType}, ${result.contentType}, ${result.sourceHash},
       ${result.status}, ${normalizedText}, ${result.textHash}, ${result.charCount},
       ${result.error}, NOW())
    ON CONFLICT (source_document_id)
    DO UPDATE SET
      agent_run_id = EXCLUDED.agent_run_id,
      source_url = EXCLUDED.source_url,
      document_type = EXCLUDED.document_type,
      content_type = EXCLUDED.content_type,
      source_hash = EXCLUDED.source_hash,
      status = EXCLUDED.status,
      normalized_text = EXCLUDED.normalized_text,
      text_hash = EXCLUDED.text_hash,
      char_count = EXCLUDED.char_count,
      error_message = EXCLUDED.error_message,
      updated_at = NOW()
    RETURNING id
  `;
  const textArtifactId = textArtifact?.id == null ? null : Number(textArtifact.id);
  const readStrategy = readStrategyForResult(result);
  const sourceKind = sourceKindForResult(result);
  const terminalBacklog = result.status === "needs_ocr" || result.status === "empty" || result.status === "skipped";
  const failed = result.status === "failed";

  await db`
    INSERT INTO institution_source_profiles (
      institution_id,
      state_code,
      canonical_source_url,
      source_kind,
      read_strategy,
      last_source_hash,
      last_successful_text_id,
      last_success_at,
      last_failure_at,
      last_failure_reason,
      consecutive_failures,
      created_at,
      updated_at
    )
    SELECT
      inst.id,
      upper(btrim(inst.state_code)),
      ${result.sourceUrl},
      ${sourceKind},
      ${readStrategy},
      ${result.sourceHash},
      ${result.status === "completed" ? textArtifactId : null},
      CASE WHEN ${result.status} = 'completed' THEN NOW() ELSE NULL END,
      CASE WHEN ${result.status} = 'completed' THEN NULL ELSE NOW() END,
      CASE WHEN ${result.status} = 'completed' THEN NULL ELSE ${result.error} END,
      CASE WHEN ${result.status} = 'completed' OR ${terminalBacklog} THEN 0 ELSE 1 END,
      NOW(),
      NOW()
    FROM institution_sources inst
    WHERE inst.id = ${result.institutionId}
    ON CONFLICT (institution_id) DO UPDATE SET
      state_code = EXCLUDED.state_code,
      canonical_source_url = CASE
        WHEN institution_source_profiles.locked_by_correction
          THEN institution_source_profiles.canonical_source_url
        ELSE COALESCE(EXCLUDED.canonical_source_url, institution_source_profiles.canonical_source_url)
      END,
      source_kind = CASE
        WHEN institution_source_profiles.locked_by_correction
          THEN institution_source_profiles.source_kind
        ELSE EXCLUDED.source_kind
      END,
      read_strategy = CASE
        WHEN institution_source_profiles.locked_by_correction
          THEN institution_source_profiles.read_strategy
        ELSE EXCLUDED.read_strategy
      END,
      last_source_hash = COALESCE(EXCLUDED.last_source_hash, institution_source_profiles.last_source_hash),
      last_successful_text_id = COALESCE(EXCLUDED.last_successful_text_id, institution_source_profiles.last_successful_text_id),
      last_success_at = CASE
        WHEN ${result.status} = 'completed' THEN NOW()
        ELSE institution_source_profiles.last_success_at
      END,
      last_failure_at = CASE
        WHEN ${result.status} = 'completed' THEN NULL
        ELSE NOW()
      END,
      last_failure_reason = CASE
        WHEN ${result.status} = 'completed' THEN NULL
        ELSE EXCLUDED.last_failure_reason
      END,
      consecutive_failures = CASE
        WHEN ${failed} THEN institution_source_profiles.consecutive_failures + 1
        ELSE 0
      END,
      updated_at = NOW()
  `;
}

/**
 * The page Rosetta read is not a fee schedule. Remember the URL so discovery never
 * proposes it again and, unless a person locked this source, send the institution
 * back to Magellan to find the real fee page. Only the institution's latest document
 * can trigger this, so an old version never undoes a newer, correct URL.
 */
async function sendBackToMagellan(
  db: SqlTag,
  input: { institutionId: number; sourceDocumentId: number; url: string | null; reason: string },
): Promise<boolean> {
  const rejected = JSON.stringify([{ url: input.url, reason: input.reason, at: new Date().toISOString() }]);
  await db`
    UPDATE institution_source_profiles
       SET rejected_source_urls = COALESCE(rejected_source_urls, '[]'::jsonb) || ${rejected}::jsonb,
           canonical_source_url = CASE WHEN locked_by_correction THEN canonical_source_url ELSE NULL END,
           updated_at = NOW()
     WHERE institution_id = ${input.institutionId}
  `;
  const cleared = await db`
    UPDATE institution_sources inst
       SET fee_schedule_url = NULL,
           rescue_status = 'pending',
           failure_reason = 'rosetta_wrong_document',
           failure_reason_note = ${input.url},
           failure_reason_updated_at = NOW()
     WHERE inst.id = ${input.institutionId}
       AND NOT EXISTS (
         SELECT 1 FROM institution_source_profiles profile
          WHERE profile.institution_id = inst.id AND profile.locked_by_correction IS TRUE
       )
       AND NOT EXISTS (
         SELECT 1 FROM source_documents newer
          WHERE newer.institution_id = inst.id
            AND newer.status = 'success'
            AND newer.id > ${input.sourceDocumentId}
       )
    RETURNING inst.id
  `;
  return cleared.length > 0;
}

export const ROSETTA_TRIAGE_LIMIT = 100;

/**
 * Re-checks texts read before the fee-page check existed (no download). A text Knox
 * already pulled fees from is never rejected.
 */
async function triageEarlierTexts(
  db: SqlTag,
  options: { runId: number; stepId: number | null; institutionId?: number; stateCode?: string },
): Promise<{ checked: number; wrong: number; sentBack: number }> {
  const params: Array<number | string> = [ROSETTA_TRIAGE_LIMIT, PAGE_CHECK_STRATEGY, FEE_PAGE_CHECK_VERSION];
  const filters: string[] = [];
  if (options.institutionId) {
    params.push(options.institutionId);
    filters.push(`AND adt.institution_id = $${params.length}`);
  }
  const normalizedState = normalizeStateCode(options.stateCode);
  if (normalizedState) {
    params.push(normalizedState);
    filters.push(`AND upper(btrim(inst.state_code)) = $${params.length}`);
  }
  const rows = await db.unsafe<Array<{
    text_id: number | string;
    source_document_id: number | string;
    institution_id: number | string;
    source_url: string | null;
    text_hash: string | null;
    normalized_text: string;
    has_knox_fees: boolean;
  }>>(
    `
      SELECT adt.id AS text_id,
             adt.source_document_id,
             adt.institution_id,
             adt.source_url,
             adt.text_hash,
             adt.normalized_text,
             EXISTS (
               SELECT 1 FROM raw_fee_observations fr
                WHERE fr.source = 'knox' AND fr.source_document_id = adt.source_document_id
             ) AS has_knox_fees
        FROM agent_source_texts adt
        JOIN institution_sources inst ON inst.id = adt.institution_id
       WHERE adt.status = 'completed'
         AND adt.normalized_text IS NOT NULL
         ${filters.join("\n         ")}
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.stage = 'read'
              AND pa.institution_id = adt.institution_id
              AND pa.input_fingerprint = adt.text_hash
              AND pa.strategy = $2
              AND pa.strategy_version = $3
         )
       ORDER BY adt.updated_at DESC, adt.id DESC
       LIMIT $1
    `,
    params,
  );

  let wrong = 0;
  let sentBack = 0;
  for (const row of rows) {
    const score = scoreFeePage(row.normalized_text);
    const isWrong = score.verdict === "wrong_document" && !row.has_knox_fees;
    if (isWrong) {
      wrong += 1;
      await db`
        UPDATE agent_source_texts
           SET status = 'wrong_document', error_message = ${score.reason}, updated_at = NOW()
         WHERE id = ${Number(row.text_id)}
      `;
      if (
        await sendBackToMagellan(db, {
          institutionId: Number(row.institution_id),
          sourceDocumentId: Number(row.source_document_id),
          url: row.source_url,
          reason: score.reason,
        })
      ) {
        sentBack += 1;
      }
    }
    await recordAttempt(db, {
      institutionId: Number(row.institution_id),
      sourceDocumentId: Number(row.source_document_id),
      stage: "read",
      strategy: PAGE_CHECK_STRATEGY,
      version: FEE_PAGE_CHECK_VERSION,
      fingerprint: row.text_hash,
      outcome: isWrong ? "wrong_document" : "ok",
      yieldCount: score.feeLines,
      costMicrousd: 0,
      runId: options.runId,
      stepId: options.stepId,
      detail: { text_id: Number(row.text_id), url: row.source_url, triage: true, ...score },
    });
  }
  return { checked: rows.length, wrong, sentBack };
}

export async function runRosettaRead(
  options: RunRosettaReadOptions,
): Promise<RunRosettaReadResult> {
  const db = options.db ?? sql;
  const fetchImpl = options.fetchImpl ?? fetch;
  const pdfTextExtractor = options.pdfTextExtractor ?? extractPdfText;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const learning = !dryRun && (await learningSchemaReady(db));
  // The fee-page check and the vault need the document-vault migration (new status, columns).
  const vaultSchema = learning && (await documentVaultSchemaReady(db));
  const vault = vaultSchema ? options.vault ?? getDocumentVault() : null;
  const rows = await selectCandidates(db, limit, learning, options.institutionId, options.stateCode, vaultSchema);

  const results: ReadResult[] = [];
  let sentBack = 0;
  for (const row of rows) {
    const { result, normalizedText } = await readCandidate(
      row,
      fetchImpl,
      pdfTextExtractor,
      vault,
      vaultSchema,
    );
    results.push(result);
    if (dryRun || result.status === "known_failure") continue;
    // A re-read replaces the earlier text only with a better answer; otherwise the old
    // text stays and only the attempt is logged.
    const keepEarlierText = result.reread && result.status !== "completed" && result.status !== "wrong_document";
    if (!keepEarlierText) await recordReadResult(db, options.runId, result, normalizedText);
    if (result.status === "wrong_document") {
      if (
        await sendBackToMagellan(db, {
          institutionId: result.institutionId,
          sourceDocumentId: result.sourceDocumentId,
          url: result.sourceUrl,
          reason: result.error ?? "Not a fee schedule",
        })
      ) {
        sentBack += 1;
      }
    }
    if (learning && result.attemptOutcome) {
      await recordAttempt(db, {
        institutionId: result.institutionId,
        sourceDocumentId: result.sourceDocumentId,
        stage: "read",
        strategy: result.strategy ?? `read.${result.documentType ?? "unknown"}`,
        version: ROSETTA_READ_VERSION,
        fingerprint: result.sourceHash,
        outcome: result.attemptOutcome,
        yieldCount: result.charCount,
        costMicrousd: 0,
        durationMs: result.durationMs,
        runId: options.runId,
        stepId: options.stepId ?? null,
        format: result.format,
        detail: {
          url: result.sourceUrl,
          document_type: result.documentType,
          content_type: result.contentType,
          router: result.routerReason,
          from_vault: result.fromVault,
          table_rows: result.tableRows,
          reread: result.reread,
          page_check: result.pageCheck,
          error: result.error,
        },
      });
      if (vaultSchema && result.textHash) {
        // Mark this text as page-checked so the triage pass never re-checks it.
        await recordAttempt(db, {
          institutionId: result.institutionId,
          sourceDocumentId: result.sourceDocumentId,
          stage: "read",
          strategy: PAGE_CHECK_STRATEGY,
          version: FEE_PAGE_CHECK_VERSION,
          fingerprint: result.textHash,
          outcome: result.status === "wrong_document" ? "wrong_document" : "ok",
          yieldCount: result.pageCheck?.feeLines ?? 0,
          costMicrousd: 0,
          runId: options.runId,
          stepId: options.stepId ?? null,
          detail: { url: result.sourceUrl, ...(result.pageCheck ?? {}) },
        });
      }
    }
  }

  const triage = vaultSchema
    ? await triageEarlierTexts(db, {
        runId: options.runId,
        stepId: options.stepId ?? null,
        institutionId: options.institutionId,
        stateCode: options.stateCode,
      })
    : { checked: 0, wrong: 0, sentBack: 0 };

  return {
    selected: rows.length,
    processed: results.length,
    completed: results.filter((result) => result.status === "completed").length,
    empty: results.filter((result) => result.status === "empty").length,
    needsOcr: results.filter((result) => result.status === "needs_ocr").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    skippedKnownFailures: results.filter((result) => result.status === "known_failure").length,
    wrongDocuments: results.filter((result) => result.status === "wrong_document").length,
    sentBackToMagellan: sentBack + triage.sentBack,
    readFromVault: results.filter((result) => result.fromVault).length,
    reread: results.filter((result) => result.reread).length,
    tableRows: results.reduce((total, result) => total + result.tableRows, 0),
    triagedTexts: triage.checked,
    triagedWrongDocuments: triage.wrong,
    chars: results.reduce((total, result) => total + result.charCount, 0),
    limit,
    dryRun,
    learning,
    outcomes: countOutcomes(results.map((result) => result.attemptOutcome)),
    results,
  };
}
