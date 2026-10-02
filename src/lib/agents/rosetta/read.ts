import { createHash } from "crypto";
import sanitizeHtml from "sanitize-html";

import { sql } from "@/lib/data-store/connection";
import {
  normalizeStateCode,
  readStrategyFromDocumentType,
  sourceKindFromDocumentType,
} from "@/lib/agents/state-lane-memory";
import { crawlerUserAgent } from "@/lib/agents/crawler-identity";
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
  /** Playbook columns, present once the learning-core migration is applied. */
  format?: string | null;
  best_strategy?: unknown;
  strategy_stats?: unknown;
  do_not_retry?: unknown;
}

/** `known_failure` is the router's skip: nothing is fetched again or written. */
type ReadStatus = "completed" | "empty" | "needs_ocr" | "failed" | "skipped" | "known_failure";

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
  return value
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function extractHtmlText(html: string): string {
  const withoutDeadBlocks = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(p|div|section|article|main|header|footer|li|tr|td|th|h[1-6])>/gi, "\n");
  return normalizeWhitespace(
    sanitizeHtml(withoutDeadBlocks, {
      allowedTags: [],
      allowedAttributes: {},
      disallowedTagsMode: "discard",
    }),
  );
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
  const { extractText, getDocumentProxy } = await import("unpdf");
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

        const extracted = await extractText(pdf, { mergePages: true });
        return { text: extracted.text, totalPages: extracted.totalPages };
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

/** Read strategies by detected format. Bump ROSETTA_READ_VERSION when any of them changes. */
export const ROSETTA_READ_VERSION = 1;
const READ_STRATEGIES: Record<DocumentFormat, StrategyCandidate[]> = {
  pdf: [{ strategy: "read.pdf_text", version: ROSETTA_READ_VERSION, costMicrousd: 0, formats: ["pdf_text"] }],
  html: [{ strategy: "read.html_text", version: ROSETTA_READ_VERSION, costMicrousd: 0, formats: ["html_static"] }],
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
  const finalUrl = response.url || sourceUrl;
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

  let bytes: Uint8Array;
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
      return finish(
        {
          status: "completed",
          textHash: hashText(normalizedText),
          charCount: normalizedText.length,
          error: null,
          attemptOutcome: "ok",
          format: "pdf_text",
        },
        normalizedText,
      );
    } catch (error) {
      return finish({
        status: "failed",
        error: `PDF text extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        attemptOutcome: pdfFailureOutcome(error),
      });
    }
  }

  const raw = new TextDecoder("utf-8").decode(bytes);
  const normalizedText = format === "html" ? extractHtmlText(raw) : normalizeWhitespace(raw);
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
  return finish(
    {
      status: "completed",
      textHash: hashText(normalizedText),
      charCount: normalizedText.length,
      error: null,
      attemptOutcome: "ok",
      format: format === "html" ? "html_static" : "text",
    },
    normalizedText,
  );
}

async function selectCandidates(
  db: SqlTag,
  limit: number,
  learning: boolean,
  institutionId?: number,
  stateCode?: string,
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
  if (learning) {
    // Skip inputs that already failed permanently with the current reader version.
    params.push(ROSETTA_READ_VERSION, PERMANENT_OUTCOMES);
    playbookColumns = `,
             profile.format,
             profile.best_strategy,
             profile.strategy_stats,
             profile.do_not_retry`;
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
  return db.unsafe<ReadCandidateRow[]>(
    `
      SELECT cr.id AS source_document_id,
             cr.institution_id,
             ct.institution_name,
             cr.document_url,
             cr.content_hash${playbookColumns}
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
            WHERE adt.status IN ('completed', 'empty', 'needs_ocr')
              AND (
                (adt.source_document_id = cr.id AND adt.source_hash IS NOT DISTINCT FROM cr.content_hash)
                -- The same bytes stored under another document id were already read.
                OR (cr.content_hash IS NOT NULL AND adt.institution_id = cr.institution_id AND adt.source_hash = cr.content_hash)
              )
         )
       ORDER BY cr.crawled_at DESC NULLS LAST, cr.id DESC
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

export async function runRosettaRead(
  options: RunRosettaReadOptions,
): Promise<RunRosettaReadResult> {
  const db = options.db ?? sql;
  const fetchImpl = options.fetchImpl ?? fetch;
  const pdfTextExtractor = options.pdfTextExtractor ?? extractPdfText;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const learning = !dryRun && (await learningSchemaReady(db));
  const rows = await selectCandidates(db, limit, learning, options.institutionId, options.stateCode);

  const results: ReadResult[] = [];
  for (const row of rows) {
    const { result, normalizedText } = await readCandidate(
      row,
      fetchImpl,
      pdfTextExtractor,
    );
    results.push(result);
    if (dryRun || result.status === "known_failure") continue;
    await recordReadResult(db, options.runId, result, normalizedText);
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
          error: result.error,
        },
      });
    }
  }

  return {
    selected: rows.length,
    processed: results.length,
    completed: results.filter((result) => result.status === "completed").length,
    empty: results.filter((result) => result.status === "empty").length,
    needsOcr: results.filter((result) => result.status === "needs_ocr").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    skippedKnownFailures: results.filter((result) => result.status === "known_failure").length,
    chars: results.reduce((total, result) => total + result.charCount, 0),
    limit,
    dryRun,
    learning,
    outcomes: countOutcomes(results.map((result) => result.attemptOutcome)),
    results,
  };
}
