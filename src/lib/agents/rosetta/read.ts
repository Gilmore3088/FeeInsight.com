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
import { backfillPlaybookFormats } from "@/lib/agents/learning/format-backfill";
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
import {
  alternateDocumentUrls,
  embeddedDataText,
  JS_FALLBACK_MAX_FETCHES,
  JS_FALLBACK_STRATEGY,
  looksLikeJsShell,
  ROSETTA_JS_FALLBACK_VERSION,
  staticVariantUrls,
} from "@/lib/agents/rosetta/js-fallback";
import {
  createScannedPdfReader,
  OCR_MAX_PAGES,
  OCR_MIN_CHARS_PER_PAGE,
  OCR_MIN_CONFIDENCE,
  OCR_STRATEGY,
  OcrError,
  ROSETTA_OCR_VERSION,
  type ScannedPdfReader,
} from "@/lib/agents/rosetta/ocr";
import { layoutPageText, type PdfTextItem } from "@/lib/agents/rosetta/pdf-layout";
import {
  ROSETTA_TABLE_ROWS_VERSION,
  rosettaTextColumnsReady,
  rowsInText,
  TABLE_ROWS_STRATEGY,
  tableRowsFromText,
  tableRowsPayload,
  type SourceTableRow,
} from "@/lib/agents/rosetta/table-rows";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

export const ROSETTA_READ_DEFAULT_LIMIT = 25;
export const ROSETTA_READ_MAX_LIMIT = 100;

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

/**
 * `known_failure` is the router's skip: nothing is fetched again or written.
 * `deferred` is a scan left for a later run because this run's OCR allowance is used up;
 * nothing is written, so it is selected again.
 */
type ReadStatus =
  | "completed"
  | "empty"
  | "needs_ocr"
  | "failed"
  | "skipped"
  | "known_failure"
  | "wrong_document"
  | "deferred";

interface PdfTextExtraction {
  text: string;
  totalPages: number;
  /** Text of each page, when the extractor provides it (gives table rows page numbers). */
  pages?: string[];
}

type PdfTextExtractor = (bytes: Uint8Array) => Promise<PdfTextExtraction>;

/** A pass-2 specialist that ran on the same document after the first reader. */
export interface SpecialistAttempt {
  strategy: string;
  version: number;
  outcome: AttemptOutcome;
  yieldCount: number;
  costMicrousd: number;
  durationMs: number;
  detail: Record<string, unknown>;
}

export interface ReadResult {
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
  /** Structured rows stored in `agent_source_texts.table_rows` (see table-rows.ts). */
  rows: SourceTableRow[];
  /** The specialist whose text is stored: read.html_dom, read.ocr_tesseract, ... */
  reader: string | null;
  /** Pass-2 specialists that ran after the first reader, in order. */
  followUps: SpecialistAttempt[];
  /** Set when no free route can read this page: Magellan's paid finder takes it. */
  handoff: "magellan_paid_find" | null;
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
  /** Free OCR for scans; defaults to tesseract.js. Closed by the caller that created it. */
  scannedPdfReader?: ScannedPdfReader;
  /** Scans OCR'd per run at most; more are deferred to the next run. */
  ocrDocumentsPerRun?: number;
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
  /** Scans read by free OCR, and pages built by JavaScript read by a free fallback. */
  ocrRead: number;
  jsFallbackRead: number;
  /** JavaScript pages with no free route, handed to Magellan's paid finder. */
  handedToMagellan: number;
  /** Scans left for the next run (OCR allowance used up). */
  deferred: number;
  /** Earlier texts re-checked with the fee-page check this run, and how many failed it. */
  triagedTexts: number;
  triagedWrongDocuments: number;
  /** Institutions whose learned format was filled in from an earlier text. */
  formatsBackfilled: number;
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

export function normalizeWhitespace(value: string): string {
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

function extractHtmlText(html: string): { text: string; tableRows: number; rows: SourceTableRow[] } {
  const extracted = extractHtmlDomText(html);
  return { text: normalizeWhitespace(extracted.text), tableRows: extracted.tableRows, rows: extracted.rows };
}

export function hashText(value: string): string {
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
      // pdf.js detaches the buffer it is given; pass a copy so OCR can still read the bytes.
      const pdf = await getDocumentProxy(new Uint8Array(bytes), {
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
        const pageTexts = pages.map(layoutPageText);
        return { text: pageTexts.join("\n\n"), totalPages, pages: pageTexts };
      } finally {
        await pdf.destroy?.();
      }
    })(),
    PDF_EXTRACTION_TIMEOUT_MS,
    "PDF text extraction",
  );
}

export async function fetchWithTimeout(fetchImpl: Fetcher, url: string): Promise<Response> {
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
 * Version 3: the pass-2 specialists. A scan escalates to free OCR and a page built by
 * JavaScript to the free fallbacks within the same read, and table rows are stored as
 * cells. Scans and JavaScript pages an older version gave up on are read once more.
 */
export const ROSETTA_READ_VERSION = 3;
export const PAGE_CHECK_STRATEGY = "read.page_check";
/** Strategies that run beside or after the first reader; they never settle a read. */
export const AUXILIARY_READ_STRATEGIES = [
  PAGE_CHECK_STRATEGY,
  TABLE_ROWS_STRATEGY,
  OCR_STRATEGY,
  JS_FALLBACK_STRATEGY,
  "read.paid_transcribe",
];
const SETTLED_READ_OUTCOMES: AttemptOutcome[] = ["ok", "ok_partial", "unchanged", "low_yield"];
/**
 * An older text with fewer Knox fees than this is read again with the current reader.
 * A real fee schedule lists far more; one or two fees usually means the table was
 * flattened and most rows were lost.
 */
export const REREAD_MAX_KNOX_FEES = 5;
/** Scans OCR'd per read step by default; each takes seconds, and the step has minutes. */
export const OCR_DOCUMENTS_PER_RUN = 4;
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

function ocrFailureOutcome(error: unknown): AttemptOutcome {
  if (error instanceof OcrError) {
    if (error.reason === "too_many_pages") return "too_large";
    if (error.reason === "no_page_images") return "unsupported_format";
    if (error.reason === "timeout") return "timeout";
  }
  return pdfFailureOutcome(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type DocumentBytes =
  | { ok: true; bytes: Uint8Array; contentType: string | null; finalUrl: string; fromVault: boolean }
  | { ok: false; error: string; outcome: AttemptOutcome; contentType: string | null; finalUrl: string };

/**
 * The document's bytes: our stored copy first (no second download, and the exact bytes
 * Magellan saw), otherwise a bounded download.
 */
export async function loadDocumentBytes(
  input: { sourceUrl: string; vaultKey?: string | null; storedContentType?: string | null },
  fetchImpl: Fetcher,
  vault: DocumentVault | null,
): Promise<DocumentBytes> {
  if (vault?.configured && isVaultKey(input.vaultKey)) {
    try {
      const bytes = await vault.read(input.vaultKey);
      return { ok: true, bytes, contentType: input.storedContentType ?? null, finalUrl: input.sourceUrl, fromVault: true };
    } catch (error) {
      console.error(`Vault read failed for ${input.vaultKey}; downloading instead:`, error);
    }
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, input.sourceUrl);
    if (!response) throw new Error("No response");
  } catch (error) {
    return {
      ok: false,
      error: `Read fetch failed: ${errorMessage(error)}`,
      outcome: classifyFetchFailure(null, error),
      contentType: null,
      finalUrl: input.sourceUrl,
    };
  }
  const contentType = response.headers.get("content-type");
  const finalUrl = response.url || input.sourceUrl;
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}`, outcome: classifyFetchFailure(response.status), contentType, finalUrl };
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_TEXT_DOCUMENT_BYTES) {
    return { ok: false, error: `Document too large for Rosetta text read: ${contentLength} bytes`, outcome: "too_large", contentType, finalUrl };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return { ok: false, error: `Read failed: ${errorMessage(error)}`, outcome: classifyFetchFailure(null, error), contentType, finalUrl };
  }
  if (bytes.byteLength > MAX_TEXT_DOCUMENT_BYTES) {
    return { ok: false, error: `Document too large for Rosetta text read: ${bytes.byteLength} bytes`, outcome: "too_large", contentType, finalUrl };
  }
  return { ok: true, bytes, contentType, finalUrl, fromVault: false };
}

interface ReadContext {
  fetchImpl: Fetcher;
  pdfTextExtractor: PdfTextExtractor;
  vault: DocumentVault | null;
  checkPage: boolean;
  /** Free OCR, or null when OCR is not available in this run. */
  ocr: ScannedPdfReader | null;
  /** Scans this run may still OCR. */
  ocrBudget: { left: number };
}

interface FreeText {
  text: string;
  rows: SourceTableRow[];
  reader: string;
  sourceUrl: string | null;
}

/** pass 2, scans: free OCR of up to OCR_MAX_PAGES pages. */
async function tryOcr(
  bytes: Uint8Array,
  pageCount: number,
  ctx: ReadContext,
): Promise<{ attempt: SpecialistAttempt; read: FreeText | null; error: string | null }> {
  const startedAt = Date.now();
  const attempt = (outcome: AttemptOutcome, yieldCount: number, detail: Record<string, unknown>): SpecialistAttempt => ({
    strategy: OCR_STRATEGY,
    version: ROSETTA_OCR_VERSION,
    outcome,
    yieldCount,
    costMicrousd: 0,
    durationMs: Date.now() - startedAt,
    detail: { pages: pageCount, ...detail },
  });
  if (pageCount > OCR_MAX_PAGES) {
    const error = `${pageCount} pages; free OCR reads at most ${OCR_MAX_PAGES}`;
    return { attempt: attempt("too_large", 0, { error }), read: null, error };
  }
  ctx.ocrBudget.left -= 1;
  try {
    const ocr = await ctx.ocr!.read(bytes, { maxPages: OCR_MAX_PAGES });
    const text = normalizeWhitespace(ocr.text);
    const chars = text.replace(/\s+/g, "").length;
    const detail = { image_pages: ocr.imagePages, confidence: Math.round(ocr.confidence), chars };
    if (chars < OCR_MIN_CHARS_PER_PAGE * Math.max(1, ocr.imagePages)) {
      const error = `OCR found only ${chars} characters on ${ocr.imagePages} page images`;
      return { attempt: attempt("empty", chars, { ...detail, error }), read: null, error };
    }
    if (ocr.confidence < OCR_MIN_CONFIDENCE) {
      const error = `OCR confidence ${Math.round(ocr.confidence)} is below ${OCR_MIN_CONFIDENCE}; too unreliable for Knox`;
      return { attempt: attempt("rejected", chars, { ...detail, error }), read: null, error };
    }
    const rows = rowsInText(tableRowsFromText(ocr.pages.map(normalizeWhitespace), "ocr_layout"), text);
    return {
      attempt: attempt("ok", text.length, { ...detail, table_rows: rows.length }),
      read: { text, rows, reader: OCR_STRATEGY, sourceUrl: null },
      error: null,
    };
  } catch (error) {
    const message = `OCR failed: ${errorMessage(error)}`;
    return { attempt: attempt(ocrFailureOutcome(error), 0, { error: message }), read: null, error: message };
  }
}

/** A fallback text is used only when the fee-page check does not reject it. */
function acceptableFeeText(text: string): boolean {
  return text.length > 0 && scoreFeePage(text).verdict !== "wrong_document";
}

/** pass 2, JavaScript pages: embedded data, then linked PDF/print versions, then static variants. */
async function tryJsFallback(
  html: string,
  pageUrl: string,
  ctx: ReadContext,
): Promise<{ attempt: SpecialistAttempt; read: FreeText | null }> {
  const startedAt = Date.now();
  const tried: Array<{ route: string; url?: string; result: string }> = [];
  const done = (outcome: AttemptOutcome, read: FreeText | null, route: string | null) => ({
    attempt: {
      strategy: JS_FALLBACK_STRATEGY,
      version: ROSETTA_JS_FALLBACK_VERSION,
      outcome,
      yieldCount: read?.text.length ?? 0,
      costMicrousd: 0,
      durationMs: Date.now() - startedAt,
      detail: { route, tried, ...(outcome === "js_required" ? { handoff: "magellan_paid_find" } : {}) },
    },
    read,
  });

  const embedded = normalizeWhitespace(embeddedDataText(html));
  tried.push({ route: "embedded_data", result: embedded ? `${embedded.length} chars` : "none" });
  if (acceptableFeeText(embedded)) {
    const rows = rowsInText(tableRowsFromText(embedded, "embedded_data"), embedded);
    return done("ok", { text: embedded, rows, reader: JS_FALLBACK_STRATEGY, sourceUrl: pageUrl }, "embedded_data");
  }

  const candidates = [
    ...alternateDocumentUrls(html, pageUrl).map((url) => ({ route: "linked_document", url })),
    ...staticVariantUrls(pageUrl).map((url) => ({ route: "static_variant", url })),
  ].slice(0, JS_FALLBACK_MAX_FETCHES);
  for (const candidate of candidates) {
    const loaded = await loadDocumentBytes({ sourceUrl: candidate.url }, ctx.fetchImpl, null);
    if (!loaded.ok) {
      tried.push({ ...candidate, result: loaded.outcome });
      continue;
    }
    const format = detectFormat(loaded.bytes, loaded.contentType, loaded.finalUrl);
    let read: FreeText | null = null;
    try {
      if (format === "pdf") {
        const extracted = await ctx.pdfTextExtractor(loaded.bytes);
        const text = normalizeWhitespace(extracted.text);
        if (!isLikelyScannedPdf(text, extracted.totalPages)) {
          const rows = rowsInText(tableRowsFromText((extracted.pages ?? [extracted.text]).map(normalizeWhitespace), "pdf_layout"), text);
          read = { text, rows, reader: "read.pdf_layout", sourceUrl: loaded.finalUrl };
        }
      } else if (format === "html") {
        const extracted = extractHtmlText(new TextDecoder("utf-8").decode(loaded.bytes));
        read = { text: extracted.text, rows: rowsInText(extracted.rows, extracted.text), reader: "read.html_dom", sourceUrl: loaded.finalUrl };
      }
    } catch (error) {
      tried.push({ ...candidate, result: `parse_error: ${errorMessage(error)}` });
      continue;
    }
    if (read && acceptableFeeText(read.text)) {
      tried.push({ ...candidate, result: "ok" });
      return done("ok", { ...read, reader: JS_FALLBACK_STRATEGY }, candidate.route);
    }
    tried.push({ ...candidate, result: read ? "not_a_fee_page" : `unreadable_${format}` });
  }
  return done("js_required", null, null);
}

async function readCandidate(
  row: ReadCandidateRow,
  ctx: ReadContext,
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
    rows: [],
    reader: null,
    followUps: [],
    handoff: null,
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

  const loaded = await loadDocumentBytes(
    { sourceUrl, vaultKey: row.document_r2_key, storedContentType: row.stored_content_type },
    ctx.fetchImpl,
    ctx.vault,
  );
  base.contentType = loaded.contentType;
  if (!loaded.ok) {
    base.documentType = documentTypeForFormat(detectFormat(null, loaded.contentType, loaded.finalUrl));
    return finish({ status: "failed", error: loaded.error, attemptOutcome: loaded.outcome });
  }
  const { bytes, finalUrl } = loaded;
  base.fromVault = loaded.fromVault;

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
  base.reader = decision.strategy;

  /**
   * A readable text: completed, unless the fee-page check says it is not a fee schedule.
   * `firstOutcome` keeps the first reader's own outcome when a pass-2 specialist read it.
   */
  const finishRead = (
    normalizedText: string,
    learnedFormat: PlaybookFormat,
    rows: SourceTableRow[],
    firstOutcome: AttemptOutcome | null = null,
  ) => {
    const pageCheck = ctx.checkPage ? scoreFeePage(normalizedText, base.sourceUrl) : null;
    const wrong = pageCheck?.verdict === "wrong_document";
    const followUp = base.followUps[base.followUps.length - 1];
    if (firstOutcome && followUp && wrong) followUp.outcome = "wrong_document";
    return finish(
      {
        status: wrong ? "wrong_document" : "completed",
        textHash: hashText(normalizedText),
        charCount: normalizedText.length,
        error: wrong ? pageCheck.reason : null,
        attemptOutcome: firstOutcome ?? (wrong ? "wrong_document" : "ok"),
        format: learnedFormat,
        pageCheck,
        rows: rowsInText(rows, normalizedText),
      },
      normalizedText,
    );
  };

  if (format === "pdf") {
    let extracted: PdfTextExtraction;
    try {
      extracted = await ctx.pdfTextExtractor(bytes);
    } catch (error) {
      return finish({
        status: "failed",
        error: `PDF text extraction failed: ${errorMessage(error)}`,
        attemptOutcome: pdfFailureOutcome(error),
      });
    }
    const normalizedText = normalizeWhitespace(extracted.text);
    if (normalizedText.length > 0 && !isLikelyScannedPdf(normalizedText, extracted.totalPages)) {
      const pageTexts = (extracted.pages ?? [extracted.text]).map(normalizeWhitespace);
      return finishRead(normalizedText, "pdf_text", tableRowsFromText(pageTexts, "pdf_layout"));
    }

    const scanError =
      normalizedText.length === 0
        ? `No embedded PDF text found across ${extracted.totalPages} pages; OCR required`
        : `Only ${normalizedText.length} characters of embedded text across ${extracted.totalPages} pages; likely a scan, OCR required`;
    const needsOcr = (error: string) =>
      finish(
        { status: "needs_ocr", charCount: normalizedText.length, error, attemptOutcome: "scanned_pdf", format: "pdf_scanned" },
        normalizedText,
      );
    if (!ctx.ocr) return needsOcr(scanError);
    if (ctx.ocrBudget.left <= 0 && extracted.totalPages <= OCR_MAX_PAGES) {
      // Nothing is written: the scan is selected again next run, when OCR has room.
      return finish({ status: "deferred", error: "OCR allowance for this run used up", attemptOutcome: null, format: "pdf_scanned" });
    }
    // Escalate within the same document: pass 2, free OCR.
    const ocr = await tryOcr(bytes, extracted.totalPages, ctx);
    base.followUps.push(ocr.attempt);
    if (!ocr.read) return needsOcr(`${scanError}. ${ocr.error}`);
    base.reader = ocr.read.reader;
    return finishRead(ocr.read.text, "pdf_scanned", ocr.read.rows, "scanned_pdf");
  }

  const raw = new TextDecoder("utf-8").decode(bytes);
  let normalizedText: string;
  let rows: SourceTableRow[] = [];
  if (format === "html") {
    const extracted = extractHtmlText(raw);
    normalizedText = extracted.text;
    base.tableRows = extracted.tableRows;
    rows = extracted.rows;
    // A page built by JavaScript: empty, or an app shell whose text is no fee schedule.
    const shell =
      normalizedText.length === 0 ||
      (looksLikeJsShell(raw, normalizedText) && scoreFeePage(normalizedText).verdict === "wrong_document");
    if (shell) {
      const fallback = await tryJsFallback(raw, finalUrl, ctx);
      base.followUps.push(fallback.attempt);
      if (fallback.read) {
        base.reader = fallback.read.reader;
        base.sourceUrl = fallback.read.sourceUrl ?? base.sourceUrl;
        base.tableRows = fallback.read.rows.length;
        return finishRead(fallback.read.text, "html_js", fallback.read.rows, "js_required");
      }
      if (normalizedText.length === 0) {
        return finish(
          {
            status: ctx.checkPage ? "skipped" : "empty",
            error: ctx.checkPage
              ? "Page is built by JavaScript and no free route reads it; handed to Magellan's paid finder"
              : "No readable text found",
            // An HTML page with no text is almost always rendered by JavaScript.
            attemptOutcome: "js_required",
            format: "html_js",
            handoff: ctx.checkPage ? "magellan_paid_find" : null,
          },
          normalizedText,
        );
      }
    }
  } else {
    normalizedText = normalizeWhitespace(raw);
  }
  if (normalizedText.length === 0) {
    return finish(
      {
        status: "empty",
        error: "No readable text found",
        attemptOutcome: format === "html" ? "js_required" : "empty",
        format: format === "html" ? "html_js" : "text",
      },
      normalizedText,
    );
  }
  return finishRead(normalizedText, format === "html" ? "html_static" : "text", rows);
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
  // Without the vault migration no document has a stored copy.
  const notInVault = vaultSchema ? "cr.document_r2_key IS NULL" : "TRUE";
  let playbookColumns = "";
  // Without the attempt log there is no reader version to compare, so never re-read.
  let rereadable = "FALSE";
  if (learning) {
    // Skip inputs that already failed permanently with the current reader version.
    // Capture each placeholder as it is pushed: later pushes must not shift earlier ones.
    params.push(ROSETTA_READ_VERSION);
    const versionParam = `$${params.length}`;
    params.push(PERMANENT_OUTCOMES);
    const permanentParam = `$${params.length}`;
    // Only an answer settles a re-read; a timeout or 5xx leaves it eligible next run.
    params.push([...PERMANENT_OUTCOMES, ...SETTLED_READ_OUTCOMES]);
    const settledParam = `$${params.length}`;
    // A completed text from an older reader that Knox found few or no fees in gets one
    // read with the current reader; Knox then re-extracts it if the text changed.
    params.push(REREAD_MAX_KNOX_FEES);
    const rereadMaxParam = `$${params.length}`;
    // Page checks, table rows, OCR, fallbacks and the paid pass never settle a read.
    params.push(AUXILIARY_READ_STRATEGIES);
    const auxiliaryParam = `$${params.length}`;
    const notSettledByCurrentReader = `NOT EXISTS (
                  SELECT 1 FROM pipeline_attempts current_read
                   WHERE current_read.stage = 'read'
                     AND current_read.strategy <> ALL(${auxiliaryParam}::text[])
                     AND current_read.institution_id = adt.institution_id
                     AND current_read.input_fingerprint = adt.source_hash
                     AND current_read.strategy_version >= ${versionParam}
                     AND current_read.outcome = ANY(${settledParam}::text[])
                )`;
    // A scan or JavaScript page an older reader gave up on gets one read with the
    // current reader, which escalates to free OCR or the JavaScript fallbacks.
    rereadable = `(
              (
                adt.status IN ('needs_ocr', 'empty')
                AND ${notSettledByCurrentReader}
              )
              OR (
                adt.status = 'completed'
                AND (
                  SELECT COUNT(*) FROM raw_fee_observations fr
                   WHERE fr.source = 'knox'
                     AND fr.source_document_id = adt.source_document_id
                     AND fr.outlier_flags ? 'needs_darwin_verification'
                ) < ${rereadMaxParam}
                AND ${notSettledByCurrentReader}
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
    // A copy that is not in the vault whose link already came back gone (404/410) is not
    // fetched again: the first time, Rosetta sent the bank back to Magellan.
    filters.push(`AND NOT (
           ${notInVault}
           AND EXISTS (
             SELECT 1
               FROM pipeline_attempts dead
              WHERE dead.institution_id = cr.institution_id
                AND dead.stage = 'read'
                AND dead.source_document_id = cr.id
                AND dead.outcome IN ('http_404', 'http_410')
           )
         )`);
    filters.push(`AND NOT EXISTS (
           SELECT 1
             FROM pipeline_attempts pa
            WHERE pa.stage = 'read'
              AND pa.strategy <> ALL(${auxiliaryParam}::text[])
              AND pa.institution_id = cr.institution_id
              AND pa.input_fingerprint = cr.content_hash
              AND pa.strategy_version = ${versionParam}
              AND pa.outcome = ANY(${permanentParam}::text[])
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
         -- Only the bank's current document. A newer download replaces this one, and when
         -- Magellan's newer download failed, a copy that is not in the vault would only be
         -- fetched again from the link Magellan just could not get.
         AND NOT EXISTS (
           SELECT 1
             FROM source_documents newer
            WHERE newer.institution_id = cr.institution_id
              AND newer.id > cr.id
              AND (
                (newer.status = 'success' AND newer.duplicate_of_id IS DISTINCT FROM cr.id)
                OR (newer.status = 'failed' AND ${notInVault})
              )
         )
         AND (
           profile.read_strategy IS NULL
           -- Scans and JavaScript pages are read too: pass 2 escalates to OCR and fallbacks.
           OR profile.read_strategy IN ('pdf_text', 'html_dom', 'ocr', 'browser_render')
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
  if (result.status === "needs_ocr" || result.format === "pdf_scanned") return "ocr";
  if (result.handoff || (result.status === "empty" && result.documentType === "html")) return "browser_render";
  if (result.status === "skipped") return "manual_review";
  if (result.status === "completed") return readStrategyFromDocumentType(result.documentType);
  return readStrategyFromDocumentType(result.documentType);
}

function sourceKindForResult(result: ReadResult): "pdf" | "html" | "scanned_pdf" | "unknown" {
  if (result.status === "needs_ocr" || result.format === "pdf_scanned") return "scanned_pdf";
  return sourceKindFromDocumentType(result.documentType);
}

export async function recordReadResult(
  db: SqlTag,
  runId: number,
  result: ReadResult,
  normalizedText: string | null,
  textColumns = false,
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
  if (textColumns && textArtifactId != null) {
    // Table rows and the reader live in columns added by a later migration.
    const payload = tableRowsPayload(result.rows);
    await db`
      UPDATE agent_source_texts
         SET table_rows = ${payload ? JSON.stringify(payload) : null}::jsonb,
             reader = ${result.reader}
       WHERE id = ${textArtifactId}
    `;
  }
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
 * A document link that is gone (HTTP 404/410), or that blocked us (HTTP 401/403) on an
 * earlier read as well, cannot be read again from this URL. Rosetta sends the bank back
 * to Magellan so the next discovery pass finds its current fee page (and, if the free
 * finders fail, Magellan's paid finder). A single 403 can be a passing bot challenge,
 * so a block counts only when it repeats.
 */
export async function isUnreachableLink(db: SqlTag, result: ReadResult): Promise<boolean> {
  if (result.status !== "failed") return false;
  if (result.attemptOutcome === "http_404" || result.attemptOutcome === "http_410") return true;
  if (result.attemptOutcome !== "http_403") return false;
  const earlier = await db<{ blocked: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pipeline_attempts pa
       WHERE pa.source_document_id = ${result.sourceDocumentId}
         AND pa.stage = 'read'
         AND pa.outcome = 'http_403'
    ) AS blocked
  `;
  return earlier[0]?.blocked === true;
}

/**
 * The page Rosetta read is not a fee schedule. Remember the URL (once, with the latest
 * date) so discovery does not propose it again for a while and follows its links, and, unless a person locked this source, send the institution
 * back to Magellan to find the real fee page. Only the institution's latest document
 * can trigger this, so an old version never undoes a newer, correct URL.
 */
export async function sendBackToMagellan(
  db: SqlTag,
  input: {
    institutionId: number;
    sourceDocumentId: number;
    url: string | null;
    reason: string;
    /** `rosetta_js_required` hands a JavaScript-only page to Magellan's paid finder. */
    failureReason?: "rosetta_wrong_document" | "rosetta_js_required" | "rosetta_dead_link";
    /** Clear the institution's link only while it still points at this URL. */
    onlyIfCurrentUrl?: boolean;
  },
): Promise<boolean> {
  const onlyIfCurrentUrl = input.onlyIfCurrentUrl === true;
  const rejected = JSON.stringify([{ url: input.url, reason: input.reason, at: new Date().toISOString() }]);
  await db`
    UPDATE institution_source_profiles
       SET rejected_source_urls = (
             SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
               FROM jsonb_array_elements(COALESCE(rejected_source_urls, '[]'::jsonb)) entry
              WHERE entry->>'url' IS DISTINCT FROM ${input.url}
           ) || ${rejected}::jsonb,
           canonical_source_url = CASE WHEN locked_by_correction THEN canonical_source_url ELSE NULL END,
           updated_at = NOW()
     WHERE institution_id = ${input.institutionId}
  `;
  const cleared = await db`
    UPDATE institution_sources inst
       SET fee_schedule_url = NULL,
           rescue_status = 'pending',
           failure_reason = ${input.failureReason ?? "rosetta_wrong_document"},
           failure_reason_note = ${input.url},
           failure_reason_updated_at = NOW()
     WHERE inst.id = ${input.institutionId}
       AND (${onlyIfCurrentUrl}::boolean IS FALSE OR btrim(inst.fee_schedule_url) = ${input.url ?? ""})
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
               -- Rows Knox only held for review do not prove this is a fee page.
               SELECT 1 FROM raw_fee_observations fr
                WHERE fr.source = 'knox' AND fr.source_document_id = adt.source_document_id
                  AND fr.outlier_flags ? 'needs_darwin_verification'
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
  // Table rows and the reader column need migration 20270106020000.
  const textColumns = !dryRun && (await rosettaTextColumnsReady(db));
  const rows = await selectCandidates(db, limit, learning, options.institutionId, options.stateCode, vaultSchema);

  // Free OCR is local work, so a dry run skips it. The worker starts on the first scan.
  const ownsOcr = !options.scannedPdfReader;
  const ocr = dryRun ? null : options.scannedPdfReader ?? createScannedPdfReader();
  const ctx: ReadContext = {
    fetchImpl,
    pdfTextExtractor,
    vault,
    checkPage: vaultSchema,
    ocr,
    ocrBudget: { left: Math.max(0, Math.floor(options.ocrDocumentsPerRun ?? OCR_DOCUMENTS_PER_RUN)) },
  };

  const results: ReadResult[] = [];
  let sentBack = 0;
  let handedToMagellan = 0;
  try {
    for (const row of rows) {
      const { result, normalizedText } = await readCandidate(row, ctx);
      results.push(result);
      if (dryRun || result.status === "known_failure" || result.status === "deferred") continue;
      // A re-read replaces the earlier text only with a better answer; otherwise the old
      // text stays and only the attempt is logged.
      const keepEarlierText = result.reread && result.status !== "completed" && result.status !== "wrong_document";
      if (!keepEarlierText) await recordReadResult(db, options.runId, result, normalizedText, textColumns);
      if (result.status === "wrong_document" || (result.handoff && !keepEarlierText)) {
        if (
          await sendBackToMagellan(db, {
            institutionId: result.institutionId,
            sourceDocumentId: result.sourceDocumentId,
            url: result.sourceUrl,
            reason: result.error ?? "Not a fee schedule",
            failureReason: result.handoff ? "rosetta_js_required" : "rosetta_wrong_document",
          })
        ) {
          if (result.handoff) handedToMagellan += 1;
          else sentBack += 1;
        }
      } else if (await isUnreachableLink(db, result)) {
        if (
          await sendBackToMagellan(db, {
            institutionId: result.institutionId,
            sourceDocumentId: result.sourceDocumentId,
            url: result.sourceUrl,
            reason: result.error ?? `Link unreachable (${result.attemptOutcome})`,
            failureReason: "rosetta_dead_link",
            onlyIfCurrentUrl: true,
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
            reader: result.reader,
            reread: result.reread,
            page_check: result.pageCheck,
            error: result.error,
          },
        });
        // Each pass-2 specialist that ran on this document, in order.
        for (const followUp of result.followUps) {
          await recordAttempt(db, {
            institutionId: result.institutionId,
            sourceDocumentId: result.sourceDocumentId,
            stage: "read",
            strategy: followUp.strategy,
            version: followUp.version,
            fingerprint: result.sourceHash,
            outcome: followUp.outcome,
            yieldCount: followUp.yieldCount,
            costMicrousd: followUp.costMicrousd,
            durationMs: followUp.durationMs,
            runId: options.runId,
            stepId: options.stepId ?? null,
            detail: { url: result.sourceUrl, ...followUp.detail },
          });
        }
        if (textColumns && result.textHash && result.rows.length > 0 && !keepEarlierText) {
          await recordAttempt(db, {
            institutionId: result.institutionId,
            sourceDocumentId: result.sourceDocumentId,
            stage: "read",
            strategy: TABLE_ROWS_STRATEGY,
            version: ROSETTA_TABLE_ROWS_VERSION,
            fingerprint: result.textHash,
            outcome: "ok",
            yieldCount: result.rows.length,
            costMicrousd: 0,
            runId: options.runId,
            stepId: options.stepId ?? null,
            detail: {
              tables: new Set(result.rows.map((tableRow) => tableRow.table)).size,
              origins: [...new Set(result.rows.map((tableRow) => tableRow.origin))],
            },
          });
        }
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
  } finally {
    if (ownsOcr) await ocr?.close().catch((error) => console.error("Rosetta OCR worker did not stop cleanly:", error));
  }

  const triage = vaultSchema
    ? await triageEarlierTexts(db, {
        runId: options.runId,
        stepId: options.stepId ?? null,
        institutionId: options.institutionId,
        stateCode: options.stateCode,
      })
    : { checked: 0, wrong: 0, sentBack: 0 };
  const formats = learning
    ? await backfillPlaybookFormats(db, { dryRun, institutionId: options.institutionId })
    : { updated: 0, byFormat: {} };

  const readBy = (strategy: string) =>
    results.filter((result) => result.status === "completed" && result.followUps.some((f) => f.strategy === strategy && f.outcome === "ok")).length;
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
    ocrRead: readBy(OCR_STRATEGY),
    jsFallbackRead: readBy(JS_FALLBACK_STRATEGY),
    handedToMagellan,
    deferred: results.filter((result) => result.status === "deferred").length,
    triagedTexts: triage.checked,
    triagedWrongDocuments: triage.wrong,
    formatsBackfilled: formats.updated,
    chars: results.reduce((total, result) => total + result.charCount, 0),
    limit,
    dryRun,
    learning,
    outcomes: countOutcomes([
      ...results.map((result) => result.attemptOutcome),
      ...results.flatMap((result) => result.followUps.map((followUp) => followUp.outcome)),
    ]),
    results,
  };
}
