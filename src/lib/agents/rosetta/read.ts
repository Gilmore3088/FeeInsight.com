import { feeSourceFetch } from "@/lib/agents/fee-source-fetch";
import { createHash } from "crypto";
import { feesSentToDarwinSql, THIN_DOCUMENT_MAX_FEES, thinRereadKindSql } from "@/lib/agents/thin-document";

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
import { FEE_PAGE_CHECK_VERSION, scoreFeePage, urlNamesFeePage, type FeePageScore } from "@/lib/agents/learning/fee-page";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { backfillPlaybookFormats } from "@/lib/agents/learning/format-backfill";
import { backfillDocumentKinds } from "./document-kind-backfill";
import {
  detectFormat,
  documentTypeForFormat,
  hasReadableWords,
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
import { playbookFromRow, type Playbook } from "@/lib/agents/learning/playbook";
import { companionSourceOf, companionStreamsReady, rejectCompanionPage } from "@/lib/agents/companion-streams";
import { documentKind, DOCUMENT_KIND_VERSION } from "@/lib/agents/learning/document-kind";
import { chooseStrategy, type StrategyCandidate } from "@/lib/agents/learning/router";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { currentCopySchemaReady, restoreReadableCopies } from "@/lib/agents/magellan/current-copy";
import {
  ALTERNATE_READERS,
  PRIMARY_READERS,
  TEXT_SURVIVAL_CHECK,
  nextReaderRung,
  syncTextSurvival,
  type ReaderRecord,
} from "@/lib/agents/rosetta/text-survival";
import { BATCH_REVIEW_CHECK, reviewReadBatches, type BatchReviewResult } from "@/lib/agents/rosetta/batch-review";
import { DOCX_STRATEGY, DocxReadError, extractDocxText } from "@/lib/agents/rosetta/docx";
import { extractHtmlDomText } from "@/lib/agents/rosetta/html-dom";
import {
  alternateDocumentUrls,
  embeddedDataText,
  JS_FALLBACK_MAX_FETCHES,
  JS_FALLBACK_STRATEGY,
  looksLikeJsShell,
  ROSETTA_JS_FALLBACK_VERSION,
  samePageKey,
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
import { atomicTextWrite, captureNormalizedWitness, normalizedWitnessSchemaReady, preserveStatusChange, type WitnessRetention, type TextArtifactSnapshot } from "./normalized-witness";
import { PDF_LAYOUT_VERSION } from "@/lib/agents/rosetta/pdf-layout";
import { extractPdfDocumentText as extractPdfText, type PdfTextExtraction } from "./pdf-document-text";
import { losslessStackedRecovery, textSha256, type StackedGeometryReceipt } from "./pdf-repair-survival";
import type { PdfReaderAgreement } from "./pdf-reader-agreement";
import { PDF_PROSE_REREAD_VERSION, PDF_STACKED_REPAIR_VERSION } from "./reader-versions";
import { pdfStackedRepairDueSql, PDF_STACKED_REPAIR_MAX_PER_RUN, PDF_STACKED_REPAIR_STRATEGY } from "./pdf-stacked-repair";
import { emptyLayoutRecheckResult, runLayoutRecheck, type LayoutRecheckResult } from "./layout-recheck";
import {
  documentKindColumnsReady,
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
  /** A one-time, free current-copy check for interleaved stacked price columns. */
  pdf_stacked_repair_due?: boolean | null;
  pdf_repair_incumbent?: { id: number; text_hash: string; source_hash: string; normalized_text: string } | null;
  /**
   * True when these bytes were reopened (see `reopenScriptLoadedFeePages`) and not read
   * since: the failure recorded in the playbook before the reopen no longer stands.
   */
  reopen_pending?: boolean | null;
  /** Set for a companion page (account page, other fee document); see companion-streams.ts. */
  companion_source_id?: number | string | null;
  /** Text-survival columns (text-survival.ts): the reader of this document's current text, */
  last_reader?: string | null;
  /** whether that text lost fees, and if so the text itself, */
  last_text_lost?: boolean | null;
  last_lost_text?: string | null;
  /** and the bank's record per reader. */
  reader_record?: Record<string, ReaderRecord> | null;
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
  /** Identity of the initially selected document's loaded bytes, not a linked fallback's bytes. */
  primaryByteIdentity?: SourceByteIdentity;
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
  /**
   * Set when the text-survival record sent this read one rung up the reader ladder:
   * the alternate tried, and whether its text replaced the primary reader's.
   */
  escalation?: { to: string; used: boolean } | null;
  /** Intrinsic geometry proof, bound to the actual vault bytes and normalized output. */
  stackedGeometry?: StackedGeometryReceipt;
  /** The stored PDF reading's fee pairs against the PDF's drawing order; recorded, never acted on (#2219). */
  readerAgreement?: PdfReaderAgreement;
  witnessRetention?: WitnessRetention;
  repairSettlement?: { accepted: boolean; reason: string; artifactId?: number; textHash?: string };
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
  /** Record-only layout rechecks per step (layout-recheck.ts); defaults to LAYOUT_RECHECK_PER_RUN. */
  layoutRecheckPerRun?: number;
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
  /** Script-loaded fee pages rejected before the script fallback, reopened for one more read. */
  reopenedFeePages: number;
  reopenedBansLifted: number;
  reopenedLinksRestored: number;
  /** PDF texts whose embedded font read as noise, reopened for one more read (free OCR). */
  reopenedUnreadablePdfs: number;
  /** Current copies read as a bot check, script shell or bare title, put back on the page's readable copy. */
  thinCopiesSetAside: number[];
  /** Text-survival scores rebuilt this step, and how many texts held up or lost fees. */
  textSurvivalRefreshed: boolean;
  textsHeldUp: number;
  textsLostFees: number;
  /** Reads sent up the reader ladder by the survival record, and how many used its text. */
  readerEscalations: number;
  readerEscalationsUsed: number;
  /** Batches of reads reviewed this step (batch-review.ts): each one's error rate and misses by kind. */
  batchReviews: BatchReviewResult["batches"];
  batchReviewError: string | null;
  /**
   * Record-only layout rechecks (#2219, layout-recheck.ts): older-layout texts read again from the
   * vault, compared on their live fees, one receipt each; nothing else is written.
   */
  layoutRechecked: number;
  layoutRecheckNotCompared: number;
  layoutRecheckTextChanged: number;
  layoutRecheckLost: number;
  layoutRecheckGained: number;
  layoutRecheckError: string | null;
  /** Institutions whose learned format was filled in from an earlier text. */
  formatsBackfilled: number;
  /** Stored texts given a document kind this step (#1094 backfill). */
  documentKindsBackfilled: number;
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
 * Primary read strategies. Global reader changes bump ROSETTA_READ_VERSION;
 * scoped layout5 repairs use PDF_STACKED_REPAIR_VERSION without a global retry wave.
 * Version 2: HTML through a parsed DOM (one line per table row) and PDF lines rebuilt
 * from item positions. Completed texts from an older version that Knox found nothing
 * in are read again once.
 * Version 3: the pass-2 specialists. A scan escalates to free OCR and a page built by
 * JavaScript to the free fallbacks within the same read, and table rows are stored as
 * cells. Scans and JavaScript pages an older version gave up on are read once more.
 */
import { ROSETTA_READ_VERSION } from "./reader-versions";
// The number lives in reader-versions.ts (bump it there); the history stays above.
export { ROSETTA_READ_VERSION };
/** Obtaining bytes failed before any format-specific reader could run. */
export const DOCUMENT_ACCESS_STRATEGY = "read.document_access";
export const ROSETTA_DOCUMENT_ACCESS_VERSION = 1;
export const PAGE_CHECK_STRATEGY = "read.page_check";
/**
 * Marks a rejected fee page Rosetta reopens for one more read (an attempt row, outcome
 * "ok", fingerprint = the text's source hash). See `reopenScriptLoadedFeePages`.
 */
export const REOPEN_STRATEGY = "read.reopen";
export const REOPEN_VERSION = 1;
/** Rejected fee pages reopened per read step; later steps pick up the rest. */
export const ROSETTA_REOPEN_LIMIT = 100;
/** Strategies that run beside or after the first reader; they never settle a read. */
export const AUXILIARY_READ_STRATEGIES = [
  PAGE_CHECK_STRATEGY,
  REOPEN_STRATEGY,
  PDF_STACKED_REPAIR_STRATEGY,
  TABLE_ROWS_STRATEGY,
  OCR_STRATEGY,
  JS_FALLBACK_STRATEGY,
  "read.paid_transcribe",
];
const SETTLED_READ_OUTCOMES: AttemptOutcome[] = ["ok", "ok_partial", "unchanged", "low_yield"];
/** Free OCR outcomes a newer OCR version may turn around: it read the page, but poorly. */
const OCR_RETRY_OUTCOMES: AttemptOutcome[] = ["rejected", "empty"];
/**
 * An older text with fewer Knox fees sent to Darwin than this is read again with the current
 * reader. A real fee schedule lists far more; one or two fees usually means the table was
 * flattened and most rows were lost. The shared thin-document test (#1095).
 */
export const REREAD_MAX_KNOX_FEES = THIN_DOCUMENT_MAX_FEES;
/**
 * A PDF text an older layout read across prose columns joins each line with its
 * neighbour columns' lines as " | " cells of running prose. This many such joins (a
 * lowercase word or comma, a cell break, a lowercase word) mark a page read across its
 * columns; on prod (8 Oct) 251 of 1,981 PDF texts had at least 25, Origin Bank's 687,
 * and the layout-version-2 reader reads each of them once more.
 */
export const INTERLEAVED_PROSE_CELLS = 25;
export const INTERLEAVED_PROSE_CELL_PATTERN = String.raw`[a-z,;] \| [a-z]`;
/**
 * The first PDF reader (no `reader` recorded) ran a document's text onto one line. Knox
 * splits a line only at wide gaps and sentence ends, so a schedule longer than this ran
 * together and its rules found nothing ("Overdraft fee $35.00/transaction paid up to three
 * per day ... Postdated Check Fee"). Such a text is read once with the current PDF reader.
 */
export const FLAT_TEXT_MIN_CHARS = 280;
/** Scans OCR'd per read step by default; each takes seconds, and the step has minutes. */
export const OCR_DOCUMENTS_PER_RUN = 4;
const READ_STRATEGIES: Record<DocumentFormat, StrategyCandidate[]> = {
  pdf: [{ strategy: "read.pdf_layout", version: ROSETTA_READ_VERSION, costMicrousd: 0, formats: ["pdf_text"] }],
  html: [{ strategy: "read.html_dom", version: ROSETTA_READ_VERSION, costMicrousd: 0, formats: ["html_static"] }],
  text: [{ strategy: "read.plain_text", version: ROSETTA_READ_VERSION, costMicrousd: 0, formats: ["text"] }],
  docx: [{ strategy: DOCX_STRATEGY, version: ROSETTA_READ_VERSION, costMicrousd: 0, formats: ["docx"] }],
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

export interface SourceByteIdentity {
  status: "verified" | "unbound" | "mismatch" | "invalid_selected_hash";
  selectedHash: string | null;
  observedHash: string | null;
}
export type DocumentBytes =
  | { ok: true; bytes: Uint8Array; contentType: string | null; finalUrl: string; fromVault: boolean; byteIdentity: SourceByteIdentity }
  | { ok: false; error: string; outcome: AttemptOutcome; contentType: string | null; finalUrl: string; fromVault?: boolean; byteIdentity?: SourceByteIdentity };

/**
 * The document's bytes: our stored copy first (no second download, and the exact bytes
 * Magellan saw), otherwise a bounded download.
 */
export async function loadDocumentBytes(
  input: { sourceUrl: string; vaultKey?: string | null; storedContentType?: string | null; selectedHash?: string | null },
  fetchImpl: Fetcher,
  vault: DocumentVault | null,
): Promise<DocumentBytes> {
  const selectedHash = input.selectedHash ?? null;
  if (selectedHash !== null && (typeof selectedHash !== "string" || selectedHash.length !== 64 || !/^[a-f0-9]{64}$/i.test(selectedHash))) {
    return { ok: false, error: "The captured document hash is invalid; capture the source again before reading it.",
      outcome: "evidence_mismatch", contentType: input.storedContentType ?? null, finalUrl: input.sourceUrl,
      byteIdentity: { status: "invalid_selected_hash", selectedHash: null, observedHash: null } };
  }
  const checked = (bytes: Uint8Array, contentType: string | null, finalUrl: string, fromVault: boolean): DocumentBytes => {
    const observedHash = createHash("sha256").update(bytes).digest("hex");
    const byteIdentity: SourceByteIdentity = { status: selectedHash === null ? "unbound"
      : observedHash === selectedHash.toLowerCase() ? "verified" : "mismatch", selectedHash, observedHash };
    if (byteIdentity.status === "mismatch") {
      return { ok: false, error: "Loaded source bytes do not match the captured document; capture the current source before reading it.",
        outcome: "evidence_mismatch", contentType, finalUrl, fromVault, byteIdentity };
    }
    // Missing legacy hashes remain explicitly unbound; an observed digest is never promoted to an original hash.
    return { ok: true, bytes, contentType, finalUrl, fromVault, byteIdentity };
  };
  if (vault?.configured && isVaultKey(input.vaultKey)) {
    try {
      const bytes = await vault.read(input.vaultKey);
      return checked(bytes, input.storedContentType ?? null, input.sourceUrl, true);
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
  return checked(bytes, contentType, finalUrl, false);
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
  /** Pages (samePageKey) the bank already has as documents of its own, read on their own. */
  knownDocuments: (institutionId: number) => Promise<Set<string>>;
}

interface FreeText {
  text: string;
  rows: SourceTableRow[];
  reader: string;
  sourceUrl: string | null;
}

/** A reopened page gets its one read: drop the do-not-retry entries for its bytes. */
function withoutReopenedFailures(playbook: Playbook, row: ReadCandidateRow): Playbook {
  if (!row.reopen_pending || !row.content_hash) return playbook;
  return { ...playbook, doNotRetry: playbook.doNotRetry.filter((entry) => entry.fingerprint !== row.content_hash) };
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

/** The bank's own documents by page, loaded once per bank per run (read-only). */
function knownDocumentsLoader(db: SqlTag): ReadContext["knownDocuments"] {
  const loaded = new Map<number, Promise<Set<string>>>();
  return (institutionId) => {
    let known = loaded.get(institutionId);
    if (!known) {
      known = Promise.resolve(
        db<Array<{ document_url: string | null }>>`
          SELECT document_url FROM source_documents WHERE institution_id = ${institutionId}
        `,
      )
        .then((rows) => new Set((rows ?? []).flatMap((row) => (row?.document_url ? [samePageKey(row.document_url)] : []))))
        .catch(() => new Set<string>());
      loaded.set(institutionId, known);
    }
    return known;
  };
}

/** A fallback text is used only when the fee-page check does not reject it. */
function acceptableFeeText(text: string): boolean {
  return text.length > 0 && scoreFeePage(text).verdict !== "wrong_document";
}

/**
 * A rung-up reader's text replaces the primary reader's only when it is a fee page that
 * lists at least as many fees with an amount: a re-read never trades a text for a thinner one.
 */
export function rungTextNotWorse(alternate: string, primary: string): boolean {
  return acceptableFeeText(alternate) && scoreFeePage(alternate).feeLines >= scoreFeePage(primary).feeLines;
}

/**
 * pass 2, JavaScript pages: embedded data, then linked PDF/print versions, then static variants.
 * Finding nothing is `js_required` (handed to Magellan's paid finder) only for a page built by
 * script (`scriptBuilt`); a page whose own text reads fine but is no fee schedule (a home page
 * or a "not found" page served at a guessed fee link) stays `wrong_document`.
 */
async function tryJsFallback(
  html: string,
  pageUrl: string,
  ctx: ReadContext,
  scriptBuilt: boolean,
  institutionId: number,
): Promise<{ attempt: SpecialistAttempt; read: FreeText | null }> {
  const startedAt = Date.now();
  const tried: Array<{ route: string; url?: string; result: string }> = [];
  // A linked schedule the bank already has as its own document is read there, not twice.
  const coveredBy: string[] = [];
  const done = (outcome: AttemptOutcome, read: FreeText | null, route: string | null) => ({
    attempt: {
      strategy: JS_FALLBACK_STRATEGY,
      version: ROSETTA_JS_FALLBACK_VERSION,
      outcome,
      yieldCount: read?.text.length ?? 0,
      costMicrousd: 0,
      durationMs: Date.now() - startedAt,
      detail: {
        route,
        tried,
        ...(coveredBy.length > 0 && !read ? { covered_by: coveredBy } : {}),
        ...(outcome === "js_required" ? { handoff: "magellan_paid_find" } : {}),
      },
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
  ];
  const known = await ctx.knownDocuments(institutionId);
  let fetches = 0;
  for (const candidate of candidates) {
    if (candidate.route === "linked_document" && known.has(samePageKey(candidate.url))) {
      tried.push({ ...candidate, result: "already_a_document" });
      coveredBy.push(candidate.url);
      continue;
    }
    if (fetches >= JS_FALLBACK_MAX_FETCHES) break;
    fetches += 1;
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
        } else if (ctx.ocr && ctx.ocrBudget.left > 0) {
          // A linked scan (1streetcu.com's "Service Charge Schedule") gets the same free OCR
          // a scan read on its own gets.
          const ocr = await tryOcr(loaded.bytes, extracted.totalPages, ctx);
          if (!ocr.read) {
            tried.push({ ...candidate, result: `scanned_pdf_ocr_${ocr.attempt.outcome}` });
            continue;
          }
          read = { ...ocr.read, sourceUrl: loaded.finalUrl };
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
  return done(scriptBuilt ? "js_required" : "wrong_document", null, null);
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
    escalation: null,
  };
  const finish = (
    fields: Partial<ReadResult> & Pick<ReadResult, "status" | "error" | "attemptOutcome">,
    normalizedText: string | null = null,
  ) => ({
    normalizedText,
    result: { ...base, ...fields,
      ...(row.pdf_stacked_repair_due && fields.status !== "completed" && fields.attemptOutcome
        ? { strategy: PDF_STACKED_REPAIR_STRATEGY } : {}),
      durationMs: Date.now() - startedAt },
  });

  if (!sourceUrl) {
    return finish({
      status: "skipped",
      error: "Invalid or missing document_url",
      attemptOutcome: "invalid_url",
      strategy: DOCUMENT_ACCESS_STRATEGY,
    });
  }

  if (row.pdf_stacked_repair_due && (!ctx.vault?.configured || !isVaultKey(row.document_r2_key))) {
    return finish({ status: "failed", error: "Stacked-column repair requires configured stored vault access", attemptOutcome: "evidence_mismatch" });
  }

  const loaded = await loadDocumentBytes(
    { sourceUrl, vaultKey: row.document_r2_key, storedContentType: row.stored_content_type, selectedHash: row.content_hash },
    row.pdf_stacked_repair_due
      ? async () => new Response("Stored PDF required for column repair", { status: 503 })
      : ctx.fetchImpl,
    ctx.vault,
  );
  base.contentType = loaded.contentType;
  base.primaryByteIdentity = loaded.byteIdentity;
  base.fromVault = loaded.fromVault ?? false;
  if (!loaded.ok) {
    base.documentType = documentTypeForFormat(detectFormat(null, loaded.contentType, loaded.finalUrl));
    return finish({ status: "failed", error: loaded.error, attemptOutcome: loaded.outcome, strategy: DOCUMENT_ACCESS_STRATEGY });
  }
  const { bytes, finalUrl } = loaded;
  if (row.pdf_stacked_repair_due && (!loaded.fromVault
    || createHash("sha256").update(bytes).digest("hex") !== row.content_hash)) {
    return finish({ status: "failed", error: "Stacked-column repair vault bytes do not match the selected source hash", attemptOutcome: "parse_error", strategy: DOCUMENT_ACCESS_STRATEGY });
  }

  // The bytes, not the URL or the declared type, decide how to read the document.
  const format = detectFormat(bytes, base.contentType, finalUrl);
  base.documentType = documentTypeForFormat(format);
  const decision = chooseStrategy({
    stage: "read",
    // The bank's playbook describes its main fee link, not its companion pages.
    playbook: withoutReopenedFailures(playbookFromRow(row.companion_source_id == null ? row : null), row),
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
  // Learning plan steps 2 and 3: when this document's text, or this bank's texts from the
  // primary reader, lost fees, the free reader one rung up reads it too (text-survival.ts).
  const escalateTo = nextReaderRung(format, {
    lastReader: row.last_reader ?? null,
    lastTextLost: row.last_text_lost === true,
    // The bank's record describes its main fee link, not its companion pages.
    bankRecord: row.companion_source_id == null ? row.reader_record ?? null : null,
  });
  if (escalateTo) base.routerReason = `${decision.reason}; fees from this reader did not hold up → also ${escalateTo}`;

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
    // A companion account page is kept for its few fees; only the bank's fee link must be a schedule.
    const pageCheck = ctx.checkPage ? scoreFeePage(normalizedText, base.sourceUrl, { feeSchedule: row.companion_source_id == null }) : null;
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
      // A custom/alternate reader cannot assert geometry for another output or source.
      if (extracted.stackedGeometry?.textHash === textSha256(extracted.text)
        && extracted.stackedGeometry.sourceHash === base.sourceHash) {
        base.stackedGeometry = { ...extracted.stackedGeometry, textHash: textSha256(normalizedText) };
      }
      // Like the geometry proof, the receipt only describes the text it was computed on.
      if (extracted.readerAgreement?.textHash === textSha256(extracted.text)) {
        base.readerAgreement = { ...extracted.readerAgreement, textHash: textSha256(normalizedText) };
      }
      return finishRead(normalizedText, "pdf_text", tableRowsFromText(pageTexts, "pdf_layout"));
    }

    const scanError =
      normalizedText.length === 0
        ? `No embedded PDF text found across ${extracted.totalPages} pages; OCR required`
        : !hasReadableWords(normalizedText)
          ? `Embedded text across ${extracted.totalPages} pages is unreadable (its font maps letters to other codes); OCR required`
          : `Only ${normalizedText.length} characters of embedded text across ${extracted.totalPages} pages; likely a scan, OCR required`;
    const needsOcr = (error: string) =>
      finish(
        { status: "needs_ocr", charCount: normalizedText.length, error, attemptOutcome: "scanned_pdf", format: "pdf_scanned" },
        normalizedText,
      );
    if (!ctx.ocr || row.pdf_stacked_repair_due) return needsOcr(scanError);
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

  if (format === "docx") {
    let extracted: { text: string; rows: SourceTableRow[] };
    try {
      extracted = extractDocxText(bytes);
    } catch (error) {
      return finish({
        status: "failed",
        error: `Word document not read: ${errorMessage(error)}`,
        attemptOutcome: error instanceof DocxReadError ? "unsupported_format" : "parse_error",
        format: "docx",
      });
    }
    const normalizedText = normalizeWhitespace(extracted.text);
    if (normalizedText.length === 0) {
      return finish({ status: "empty", error: "No text in the Word document", attemptOutcome: "empty", format: "docx" }, normalizedText);
    }
    base.tableRows = extracted.rows.length;
    return finishRead(normalizedText, "docx", extracted.rows);
  }

  const raw = new TextDecoder("utf-8").decode(bytes);
  let normalizedText: string;
  let rows: SourceTableRow[] = [];
  if (format === "html") {
    const extracted = extractHtmlText(raw);
    normalizedText = extracted.text;
    base.tableRows = extracted.tableRows;
    rows = extracted.rows;
    // A page built by JavaScript: empty, or an app shell or a page its own link names as
    // the fee page, whose static text is no fee schedule. A fee page whose fees load by
    // script often has more than a shell's worth of menu text (atfcu.org/fees: 2,452
    // characters, no amounts), so the link is checked as well as the HTML.
    const scriptBuilt = normalizedText.length === 0 || looksLikeJsShell(raw, normalizedText);
    const shell =
      normalizedText.length === 0 ||
      ((scriptBuilt || urlNamesFeePage(finalUrl)) && scoreFeePage(normalizedText).verdict === "wrong_document");
    if (shell) {
      const fallback = await tryJsFallback(raw, finalUrl, ctx, scriptBuilt, base.institutionId);
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
    } else if (escalateTo === JS_FALLBACK_STRATEGY && normalizedText.length > 0) {
      const fallback = await tryJsFallback(raw, finalUrl, ctx, false, base.institutionId);
      base.followUps.push(fallback.attempt);
      const used = fallback.read != null && rungTextNotWorse(fallback.read.text, normalizedText);
      base.escalation = { to: JS_FALLBACK_STRATEGY, used };
      if (used && fallback.read) {
        base.reader = fallback.read.reader;
        base.sourceUrl = fallback.read.sourceUrl ?? base.sourceUrl;
        base.tableRows = fallback.read.rows.length;
        return finishRead(fallback.read.text, "html_js", fallback.read.rows);
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


export function rosettaReadCandidatesQuery(
  limit: number,
  learning: boolean,
  institutionId?: number,
  stateCode?: string,
  vaultSchema = false,
  companionStreams = false,
  textSurvival = false,
  currentCopy = false,
  stackedRepair: "include" | "only" | "exclude" = "include",
): { query: string; params: Array<number | string | string[]> } {
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
  let survivalColumns = "";
  // Without the attempt log there is no reader version to compare, so never re-read.
  let rereadable = "FALSE";
  // A reopened page waiting for its one read, even when the bank has a newer document.
  let reopenedPage = "FALSE";
  // A scan that an older OCR version gave up on, waiting for its one read with the current one.
  let ocrRereadable = "FALSE";
  let ocrRetryDocument = "FALSE";
  let stackedRepairDue = "FALSE";
  if (learning) {
    // This repair reads existing vault bytes only. It cannot discover a new source
    // or create a paid-reader retry wave.
    if (vaultSchema && currentCopy && companionStreams) stackedRepairDue = `EXISTS (
      SELECT 1 FROM agent_source_texts stacked_text
       WHERE stacked_text.source_document_id = cr.id
         AND stacked_text.source_hash IS NOT DISTINCT FROM cr.content_hash
         AND cr.superseded_by_id IS NULL AND cr.duplicate_of_id IS NULL
         AND cr.document_r2_key = left(cr.content_hash, 2) || '/' || cr.content_hash
         AND ${pdfStackedRepairDueSql("stacked_text")}
    )`;
    // Skip inputs that already failed permanently with the current reader version.
    // Capture each placeholder as it is pushed: later pushes must not shift earlier ones.
    params.push(ROSETTA_READ_VERSION);
    const versionParam = `$${params.length}`;
    params.push(DOCUMENT_ACCESS_STRATEGY);
    const documentAccessParam = `$${params.length}`;
    params.push(ROSETTA_DOCUMENT_ACCESS_VERSION);
    const documentAccessVersionParam = `$${params.length}`;
    // Access failures keep their own logging version while the reader version still
    // determines when their permanent failure can be retried, as for historical keys.
    const readerVersion = (alias: string) => `(CASE
                       WHEN ${alias}.strategy = ${documentAccessParam}
                         THEN COALESCE((${alias}.detail->>'reader_version')::int, 0)
                       ELSE ${alias}.strategy_version
                     END)`;
    params.push(PERMANENT_OUTCOMES);
    const permanentParam = `$${params.length}`;
    // Only an answer settles a re-read; a timeout or 5xx leaves it eligible next run.
    params.push([...PERMANENT_OUTCOMES, ...SETTLED_READ_OUTCOMES]);
    const settledParam = `$${params.length}`;
    // A completed text from an older reader that Knox found few or no fees in gets one
    // read with the current reader; Knox then re-extracts it if the text changed.
    params.push(REREAD_MAX_KNOX_FEES);
    const rereadMaxParam = `$${params.length}`;
    // A PDF text an older layout read across its prose columns gets one read with the
    // column-aware layout (pdf-layout.ts, layout version 2).
    params.push(PRIMARY_READERS.pdf);
    const pdfLayoutParam = `$${params.length}`;
    params.push(PDF_PROSE_REREAD_VERSION);
    const pdfLayoutVersionParam = `$${params.length}`;
    params.push(INTERLEAVED_PROSE_CELL_PATTERN);
    const interleavedPatternParam = `$${params.length}`;
    params.push(INTERLEAVED_PROSE_CELLS);
    const interleavedMinParam = `$${params.length}`;
    // Page checks, table rows, OCR, fallbacks and the paid pass never settle a read.
    params.push(AUXILIARY_READ_STRATEGIES);
    const auxiliaryParam = `$${params.length}`;
    const notSettledByCurrentReader = `NOT EXISTS (
                  SELECT 1 FROM pipeline_attempts current_read
                   WHERE current_read.stage = 'read'
                     AND current_read.strategy <> ALL(${auxiliaryParam}::text[])
                     AND current_read.institution_id = adt.institution_id
                     AND current_read.input_fingerprint = adt.source_hash
                     AND ${readerVersion("current_read")} >= ${versionParam}
                     AND (current_read.strategy <> ${documentAccessParam} OR current_read.strategy_version = ${documentAccessVersionParam})
                     AND current_read.outcome = ANY(${settledParam}::text[])
                )`;
    // A scan or JavaScript page an older reader gave up on gets one read with the
    // current reader, which escalates to free OCR or the JavaScript fallbacks.
    params.push(REOPEN_STRATEGY);
    const reopenParam = `$${params.length}`;
    // The latest reopen of these bytes, if any: a rejected text reopened since gets one read.
    const reopenedAt = (institution: string, fingerprint: string) => `(
                  SELECT MAX(reopen.created_at) FROM pipeline_attempts reopen
                   WHERE reopen.stage = 'read'
                     AND reopen.strategy = ${reopenParam}
                     AND reopen.outcome = 'ok'
                     AND reopen.institution_id = ${institution}
                     AND reopen.input_fingerprint = ${fingerprint}
                )`;
    // A scan whose free OCR gave up (rejected or empty) with an older OCR version gets one
    // read with the current one: version 2 turns pages upright, the usual cause.
    params.push(OCR_STRATEGY);
    const ocrStrategyParam = `$${params.length}`;
    params.push(ROSETTA_OCR_VERSION);
    const ocrVersionParam = `$${params.length}`;
    params.push(OCR_RETRY_OUTCOMES);
    const ocrRetryOutcomesParam = `$${params.length}`;
    const ocrRetry = (institution: string, fingerprint: string) => `(
                EXISTS (
                  SELECT 1 FROM pipeline_attempts old_ocr
                   WHERE old_ocr.stage = 'read'
                     AND old_ocr.strategy = ${ocrStrategyParam}
                     AND old_ocr.institution_id = ${institution}
                     AND old_ocr.input_fingerprint = ${fingerprint}
                     AND old_ocr.strategy_version < ${ocrVersionParam}
                     AND old_ocr.outcome = ANY(${ocrRetryOutcomesParam}::text[])
                )
                AND NOT EXISTS (
                  SELECT 1 FROM pipeline_attempts new_ocr
                   WHERE new_ocr.stage = 'read'
                     AND new_ocr.strategy = ${ocrStrategyParam}
                     AND new_ocr.institution_id = ${institution}
                     AND new_ocr.input_fingerprint = ${fingerprint}
                     AND new_ocr.strategy_version >= ${ocrVersionParam}
                )
              )`;
    ocrRereadable = `(adt.status = 'needs_ocr' AND ${ocrRetry("adt.institution_id", "adt.source_hash")})`;
    ocrRetryDocument = ocrRetry("cr.institution_id", "cr.content_hash");
    // A reopened page is its own page, often not the bank's newest document (its main fee
    // link moved on). As the current copy of its page it gets its one read regardless.
    if (currentCopy) {
      reopenedPage = `(
              cr.superseded_by_id IS NULL
              AND cr.duplicate_of_id IS NULL
              AND ${reopenedAt("cr.institution_id", "cr.content_hash")} IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM pipeline_attempts after_reopen
                 WHERE after_reopen.stage = 'read'
                   AND after_reopen.strategy <> ALL(${auxiliaryParam}::text[])
                   AND after_reopen.institution_id = cr.institution_id
                   AND after_reopen.input_fingerprint = cr.content_hash
                   AND after_reopen.created_at > ${reopenedAt("cr.institution_id", "cr.content_hash")}
              )
            )`;
    }
    // A completed text whose fees did not hold up (text-survival.ts) gets one read a rung up
    // the ladder: a legacy text with the current primary reader, a web page's text with the
    // JavaScript fallbacks, each once per document.
    let lostTextRereadable = "FALSE";
    if (textSurvival) {
      params.push(TEXT_SURVIVAL_CHECK);
      const survivalParam = `$${params.length}`;
      // A batch review lesson whose fix is this rung counts like a lost text (batch-review.ts).
      params.push(BATCH_REVIEW_CHECK);
      const batchParam = `$${params.length}`;
      const lostLesson = (alias: string) =>
        `(${alias}.check_name = ${survivalParam}
          OR (${alias}.check_name = ${batchParam} AND ${alias}.evidence->>'remedy' = 'reread_js_fallback'))`;
      // Only a web page has a free rung up; a PDF whose text lost fees goes to the paid pass.
      params.push(PRIMARY_READERS.html);
      const htmlPrimaryParam = `$${params.length}`;
      params.push(ALTERNATE_READERS.html ?? JS_FALLBACK_STRATEGY);
      const htmlAlternateParam = `$${params.length}`;
      // A legacy PDF text run onto one line counts like a lost text: one read with the
      // current reader, whose text replaces it only when it lists at least as many fees.
      params.push(FLAT_TEXT_MIN_CHARS);
      const flatMinParam = `$${params.length}`;
      const flatLegacyText = (alias: string) => `(
                ${alias}.status = 'completed'
                AND ${alias}.reader IS NULL
                AND ${alias}.char_count > ${flatMinParam}::int
                AND strpos(${alias}.normalized_text, chr(10)) = 0
              )`;
      // A read error recorded against a document's current text (a hold or correction whose cause is
      // a lost text, a text-survival or batch-review miss; #2059): a reader version bump gives it
      // one read with the current reader, so a reader fix reaches the documents it was written
      // for, not only those read afterwards. An error that names the text's hash stays open until
      // the text changes, so a re-read that writes the same text keeps it for the next bump; one
      // without a hash is about the text written before it, and any rewrite settles it. A correction
      // names the lost text's document in its evidence, since its own document is the cited one.
      const readErrorOnText = (alias: string, text: string) => `EXISTS (
                SELECT 1 FROM pipeline_feedback ${alias}
                 WHERE (CASE WHEN ${alias}.evidence ? 'lost_text_document_id'
                             THEN ${alias}.evidence->>'lost_text_document_id' = ${text}.source_document_id::text
                             ELSE ${alias}.source_document_id = ${text}.source_document_id END)
                   AND ${alias}.about_stage = 'read'
                   AND ${alias}.signal = 'wrong'
                   AND ${alias}.weight > 0
                   AND (${alias}.evidence->>'text_hash' = ${text}.text_hash
                        OR (${alias}.evidence->>'text_hash' IS NULL AND ${alias}.created_at >= ${text}.updated_at))
              )`;
      lostTextRereadable = `(
              (${flatLegacyText("adt")} AND ${notSettledByCurrentReader})
              OR (
                adt.status = 'completed'
                AND ${readErrorOnText("read_error", "adt")}
                AND ${notSettledByCurrentReader}
              )
              OR (
                adt.status = 'completed'
                AND EXISTS (
                  SELECT 1 FROM pipeline_feedback lost
                   WHERE ${lostLesson("lost")}
                     AND lost.signal = 'wrong'
                     AND lost.source_document_id = adt.source_document_id
                     AND lost.evidence->>'text_hash' = adt.text_hash
                )
                AND (
                  (adt.reader IS NULL AND ${notSettledByCurrentReader})
                  OR (
                    adt.reader = ${htmlPrimaryParam}
                    AND NOT EXISTS (
                      SELECT 1 FROM pipeline_attempts rung
                       WHERE rung.stage = 'read'
                         AND rung.institution_id = adt.institution_id
                         AND rung.input_fingerprint = adt.source_hash
                         AND rung.strategy = ${htmlAlternateParam}
                    )
                  )
                )
              )
              )`;
      survivalColumns = `,
             (
               SELECT COALESCE(adt.reader, 'legacy.' || COALESCE(adt.document_type, 'unknown'))
                 FROM agent_source_texts adt
                WHERE adt.source_document_id = cr.id AND adt.source_hash IS NOT DISTINCT FROM cr.content_hash
                LIMIT 1
             ) AS last_reader,
             EXISTS (
               SELECT 1 FROM agent_source_texts adt
                 JOIN pipeline_feedback lost
                   ON lost.source_document_id = adt.source_document_id
                  AND lost.evidence->>'text_hash' = adt.text_hash
                WHERE adt.source_document_id = cr.id
                  AND adt.source_hash IS NOT DISTINCT FROM cr.content_hash
                  AND adt.status = 'completed'
                  AND ${lostLesson("lost")}
                  AND lost.signal = 'wrong'
             ) AS last_text_lost,
             COALESCE(
               (
                 SELECT adt.normalized_text FROM agent_source_texts adt
                   JOIN pipeline_feedback lost
                     ON lost.source_document_id = adt.source_document_id
                    AND lost.evidence->>'text_hash' = adt.text_hash
                  WHERE adt.source_document_id = cr.id
                    AND adt.source_hash IS NOT DISTINCT FROM cr.content_hash
                    AND adt.status = 'completed'
                    AND ${lostLesson("lost")}
                    AND lost.signal = 'wrong'
                  LIMIT 1
               ),
               (
                 SELECT adt.normalized_text FROM agent_source_texts adt
                  WHERE adt.source_document_id = cr.id
                    AND adt.source_hash IS NOT DISTINCT FROM cr.content_hash
                    AND ${flatLegacyText("adt")}
                  LIMIT 1
               ),
               -- A text with a read error is kept unless the new reader's text lists as many fees.
               (
                 SELECT adt.normalized_text FROM agent_source_texts adt
                  WHERE adt.source_document_id = cr.id
                    AND adt.source_hash IS NOT DISTINCT FROM cr.content_hash
                    AND adt.status = 'completed'
                    AND ${readErrorOnText("kept_error", "adt")}
                  LIMIT 1
               )
             ) AS last_lost_text,
             (
               SELECT jsonb_object_agg(about_strategy, jsonb_build_object('held', held, 'lost', lost))
                 FROM (
                   SELECT about_strategy,
                          COUNT(*) FILTER (WHERE signal = 'right') AS held,
                          COUNT(*) FILTER (WHERE signal = 'wrong') AS lost
                     FROM pipeline_feedback
                    WHERE check_name = ${survivalParam}
                      AND institution_id = cr.institution_id
                    GROUP BY about_strategy
                 ) record
             ) AS reader_record`;
    }
    rereadable = `(
              ${vaultSchema && currentCopy && companionStreams ? `(${pdfStackedRepairDueSql("adt")}
                AND adt.source_document_id = cr.id
                AND adt.source_hash IS NOT DISTINCT FROM cr.content_hash
                AND cr.superseded_by_id IS NULL AND cr.duplicate_of_id IS NULL
                AND cr.document_r2_key = left(cr.content_hash, 2) || '/' || cr.content_hash)` : "FALSE"}
              OR
              ${lostTextRereadable}
              OR ${ocrRereadable}
              OR (
                -- A completed text reopens only as unreadable PDF text (reopenUnreadablePdfTexts).
                adt.status IN ('wrong_document', 'completed')
                AND ${reopenedAt("adt.institution_id", "adt.source_hash")} IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM pipeline_attempts after_reopen
                   WHERE after_reopen.stage = 'read'
                     AND after_reopen.strategy <> ALL(${auxiliaryParam}::text[])
                     AND after_reopen.institution_id = adt.institution_id
                     AND after_reopen.input_fingerprint = adt.source_hash
                     AND after_reopen.created_at > ${reopenedAt("adt.institution_id", "adt.source_hash")}
                )
              )
              OR (
                adt.status IN ('needs_ocr', 'empty')
                AND ${notSettledByCurrentReader}
              )
              OR (
                adt.status = 'completed'
                AND adt.reader = ${pdfLayoutParam}
                -- CASE keeps the text scan behind the cheap checks.
                AND CASE
                  WHEN position(' | ' in adt.normalized_text) = 0 THEN FALSE
                  WHEN EXISTS (
                    SELECT 1 FROM pipeline_attempts columns_read
                     WHERE columns_read.stage = 'read'
                       AND columns_read.strategy = ${pdfLayoutParam}
                       AND columns_read.institution_id = adt.institution_id
                       AND columns_read.input_fingerprint = adt.source_hash
                       AND COALESCE((columns_read.detail->>'pdf_layout')::int, 1) >= ${pdfLayoutVersionParam}
                  ) THEN FALSE
                  ELSE (SELECT COUNT(*) FROM regexp_matches(adt.normalized_text, ${interleavedPatternParam}, 'g')) >= ${interleavedMinParam}
                END
              )
              OR (
                adt.status = 'completed'
                AND ${feesSentToDarwinSql("adt.source_document_id")} < ${rereadMaxParam}
                AND ${thinRereadKindSql("adt")}
                AND ${notSettledByCurrentReader}
              )
            )`;
    // A reopened page's earlier failure is in the playbook's do-not-retry list; the router
    // would skip it there and write nothing, so the page was selected every run, never read.
    const reopenPending = `(
              ${reopenedAt("cr.institution_id", "cr.content_hash")} IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM pipeline_attempts after_reopen
                 WHERE after_reopen.stage = 'read'
                   AND after_reopen.strategy <> ALL(${auxiliaryParam}::text[])
                   AND after_reopen.institution_id = cr.institution_id
                   AND after_reopen.input_fingerprint = cr.content_hash
                   AND after_reopen.created_at > ${reopenedAt("cr.institution_id", "cr.content_hash")}
              )
            )`;
    playbookColumns = `,
             ${reopenPending} AS reopen_pending,
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
    // Nor is one whose download kept failing (blocked, timed out, server errors): after
    // the limit it waits out the window, so a link that never answers is not retried every run.
    params.push(STUCK_LINK_OUTCOMES);
    const stuckOutcomesParam = `$${params.length}`;
    params.push(STUCK_LINK_MAX_FAILURES);
    const stuckMaxParam = `$${params.length}`;
    params.push(STUCK_LINK_WINDOW_DAYS);
    const stuckDaysParam = `$${params.length}`;
    filters.push(`AND NOT (
           ${notInVault}
           AND (
             SELECT COUNT(*)
               FROM pipeline_attempts stuck
              WHERE stuck.institution_id = cr.institution_id
                AND stuck.stage = 'read'
                AND stuck.source_document_id = cr.id
                AND stuck.outcome = ANY(${stuckOutcomesParam}::text[])
                AND stuck.created_at > NOW() - make_interval(days => ${stuckDaysParam}::int)
           ) >= ${stuckMaxParam}::int
         )`);
    filters.push(`AND (${ocrRetryDocument} OR NOT EXISTS (
           SELECT 1
             FROM pipeline_attempts pa
            WHERE pa.stage = 'read'
              AND pa.strategy <> ALL(${auxiliaryParam}::text[])
              AND pa.institution_id = cr.institution_id
              AND pa.input_fingerprint = cr.content_hash
              AND ${readerVersion("pa")} = ${versionParam}
              AND (pa.strategy <> ${documentAccessParam} OR pa.strategy_version = ${documentAccessVersionParam})
              AND pa.outcome = ANY(${permanentParam}::text[])
              -- A rejection made before the page was reopened no longer stands.
              AND pa.created_at > COALESCE(${reopenedAt("cr.institution_id", "cr.content_hash")}, '-infinity'::timestamptz)
              -- Word files were logged "unsupported" before read.docx_text existed.
              AND NOT (pa.strategy = 'read.docx' AND pa.outcome = 'unsupported_format')
         ))`);
  }
  const repairIncumbent = learning && vaultSchema && currentCopy && companionStreams ? `,
             (SELECT jsonb_build_object('id', incumbent.id, 'text_hash', incumbent.text_hash,
                 'source_hash', incumbent.source_hash, 'normalized_text', incumbent.normalized_text)
                FROM agent_source_texts incumbent WHERE incumbent.source_document_id = cr.id
                LIMIT 1) AS pdf_repair_incumbent` : "";
  const vaultColumns = vaultSchema
    ? `,
             cr.document_r2_key,
             cr.content_type AS stored_content_type`
    : "";
  // Each companion page is its own stream (companion-streams.ts): a newer document of one
  // stream never hides the current document of another.
  const companionColumns = companionStreams ? `,
             cr.companion_source_id` : "";
  const sameStream = companionStreams ? "AND newer.companion_source_id IS NOT DISTINCT FROM cr.companion_source_id" : "";
  const companionPage = companionStreams ? "cr.companion_source_id IS NOT NULL" : "FALSE";
  if (stackedRepair === "only") filters.push(`AND ${stackedRepairDue}`);
  if (stackedRepair === "exclude") filters.push(`AND NOT ${stackedRepairDue}`);
  return {
    query: `
      SELECT cr.id AS source_document_id,
             cr.institution_id,
             ct.institution_name,
             cr.document_url,
             cr.content_hash,
             ${stackedRepairDue} AS pdf_stacked_repair_due${playbookColumns}${survivalColumns}${vaultColumns}${companionColumns}${repairIncumbent}
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
         AND (
           NOT EXISTS (
             SELECT 1
               FROM source_documents newer
              WHERE newer.institution_id = cr.institution_id
                AND newer.id > cr.id
                ${sameStream}
                AND (
                  (newer.status = 'success' AND newer.duplicate_of_id IS DISTINCT FROM cr.id)
                  OR (newer.status = 'failed' AND ${notInVault})
                )
           )
           OR ${reopenedPage}
         )
         AND (
           ${companionPage}
           OR profile.read_strategy IS NULL
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
  };
}

async function selectCandidates(db: SqlTag, ...args: Parameters<typeof rosettaReadCandidatesQuery>): Promise<ReadCandidateRow[]> {
  const { query, params } = rosettaReadCandidatesQuery(...args);
  return db.unsafe<ReadCandidateRow[]>(query, params);
}

/** Read-only, full owner selection shared with state readiness and Bayes's ledger. */
export function pdfStackedRepairsDueQuery(stateCode?: string): { query: string; params: Array<number | string | string[]> } {
  const selection = rosettaReadCandidatesQuery(2_147_483_647, true, undefined, stateCode, true, true, true, true, "only");
  return { query: `SELECT COUNT(*) AS due FROM (${selection.query}) stacked_repairs`, params: selection.params };
}

/** Same due predicate, with one-row existence semantics for the lane scheduler. */
export function pdfStackedRepairsPendingQuery(stateCode: string): { query: string; params: Array<number | string | string[]> } {
  const selection = rosettaReadCandidatesQuery(1, true, undefined, stateCode, true, true, true, true, "only");
  return { query: `SELECT EXISTS (${selection.query}) AS repair_due`, params: selection.params };
}

export async function countPdfStackedRepairsDue(db: SqlTag): Promise<number> {
  const { query, params } = pdfStackedRepairsDueQuery();
  const [row] = await db.unsafe<Array<{ due: number | string }>>(query, params);
  return Number(row?.due ?? 0);
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
  if (!(await normalizedWitnessSchemaReady(db))) {
    result.witnessRetention = { status: "unavailable_schema" };
    return atomicTextWrite(db, (scope) => writeReadResult(scope, runId, result, normalizedText, textColumns, false));
  }
  return atomicTextWrite(db, (scope) => writeReadResult(scope, runId, result, normalizedText, textColumns, true));
}

async function writeReadResult(
  db: SqlTag, runId: number, result: ReadResult, normalizedText: string | null, textColumns: boolean, retain: boolean,
): Promise<void> {
  let textArtifact: { id: number | string } | undefined;
  if (retain) {
    if (result.status === "completed" && normalizedText && hashText(normalizedText) !== result.textHash) {
      throw new Error("Completed incoming normalized text does not match its stated hash");
    }
    const [sourceOwner] = await db`SELECT institution_id FROM source_documents WHERE id=${result.sourceDocumentId} FOR SHARE`;
    if (!sourceOwner || Number(sourceOwner.institution_id) !== result.institutionId) {
      throw new Error("Incoming normalized text does not match its document owner");
    }
    // Insert first: a competing first write must finish before this source's row can
    // be locked. Selecting before INSERT could miss the other writer's incumbent.
    const inserted = await db`
      INSERT INTO agent_source_texts
        (agent_run_id, source_document_id, institution_id, source_url, document_type, content_type,
         source_hash, status, normalized_text, text_hash, char_count, error_message, updated_at)
      VALUES (${runId}, ${result.sourceDocumentId}, ${result.institutionId}, ${result.sourceUrl},
        ${result.documentType}, ${result.contentType}, ${result.sourceHash}, ${result.status}, ${normalizedText},
        ${result.textHash}, ${result.charCount}, ${result.error}, NOW())
      ON CONFLICT (source_document_id) DO NOTHING RETURNING id
    `;
    const [incumbent] = await db<TextArtifactSnapshot[]>`
      SELECT * FROM agent_source_texts WHERE source_document_id = ${result.sourceDocumentId} FOR UPDATE
    `;
    if (!incumbent || Number(incumbent.institution_id) !== result.institutionId) {
      throw new Error("Current normalized artifact does not match its source owner");
    }
    result.witnessRetention = { status: "active", incumbent: inserted.length > 0 ? "no_text"
      : await captureNormalizedWitness(db, incumbent, "incumbent") };
    textArtifact = { id: incumbent.id };
    await db`
      UPDATE agent_source_texts SET agent_run_id=${runId}, source_url=${result.sourceUrl},
        document_type=${result.documentType}, content_type=${result.contentType}, source_hash=${result.sourceHash},
        status=${result.status}, normalized_text=${normalizedText}, text_hash=${result.textHash},
        char_count=${result.charCount}, error_message=${result.error}, updated_at=NOW()
      WHERE id=${Number(incumbent.id)}
    `;
  } else {
    [textArtifact] = await db`
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
  }
  const textArtifactId = textArtifact?.id == null ? null : Number(textArtifact.id);
  const companionSource = await companionSourceOf(db, result.sourceDocumentId);
  // What kind of document this is (#1094), decided once here from the stored text. A read that
  // stores no text clears the kind, so a row never keeps the kind of a text it no longer holds.
  if (textColumns && textArtifactId != null && (await documentKindColumnsReady(db))) {
    const kind = normalizedText ? documentKind({ text: normalizedText, url: result.sourceUrl, feeSchedule: companionSource == null }).kind : null;
    await db`
      UPDATE agent_source_texts
         SET document_kind = ${kind},
             document_kind_version = ${kind == null ? null : DOCUMENT_KIND_VERSION}
       WHERE id = ${textArtifactId}
    `;
  }
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
  if (retain && textArtifactId != null) {
    const [incoming] = await db<TextArtifactSnapshot[]>`SELECT * FROM agent_source_texts WHERE id=${textArtifactId}`;
    const capture = await captureNormalizedWitness(db, incoming, "incoming");
    if (result.status === "completed" && normalizedText && capture === "unavailable_hash_mismatch") {
      throw new Error("Completed normalized text could not be retained with its exact hash");
    }
    result.witnessRetention!.incoming = capture;
  }
  // A companion page's read says nothing about the bank's main fee link: the profile
  // (canonical link, read strategy) stays as the main link left it.
  if (companionSource != null) return;
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
 * Download failures that are not "gone" but can repeat forever: a block, rate limit,
 * server error, timeout or dropped connection. One can pass; several in a row mean the
 * link no longer works for us.
 */
export const STUCK_LINK_OUTCOMES: AttemptOutcome[] = ["http_403", "http_429", "http_5xx", "http_other", "timeout", "network_error"];
/** Failed downloads of one document, inside the window, before Rosetta stops trying it. */
export const STUCK_LINK_MAX_FAILURES = 3;
/** After this many days without a try, a stuck link gets one more. */
export const STUCK_LINK_WINDOW_DAYS = 7;

/**
 * A document link that is gone (HTTP 404/410), that blocked us (HTTP 401/403) on an
 * earlier read as well, or whose download has now failed `STUCK_LINK_MAX_FAILURES` times
 * in `STUCK_LINK_WINDOW_DAYS`, cannot be read again from this URL. Rosetta sends the bank
 * back to Magellan so the next discovery pass finds its current fee page (and, if the
 * free finders fail, Magellan's paid finder). A single 403 can be a passing bot
 * challenge, so a block counts only when it repeats.
 */
export async function isUnreachableLink(db: SqlTag, result: ReadResult): Promise<boolean> {
  if (result.status !== "failed") return false;
  if (result.attemptOutcome === "http_404" || result.attemptOutcome === "http_410") return true;
  if (!result.attemptOutcome || !STUCK_LINK_OUTCOMES.includes(result.attemptOutcome)) return false;
  // This attempt is logged after this check, so earlier rows are the earlier tries.
  const earlier = await db<{ blocked: boolean }[]>`
    SELECT (
      (${result.attemptOutcome} = 'http_403' AND COUNT(*) FILTER (WHERE pa.outcome = 'http_403') > 0)
      OR COUNT(*) + 1 >= ${STUCK_LINK_MAX_FAILURES}
    ) AS blocked
      FROM pipeline_attempts pa
     WHERE pa.institution_id = ${result.institutionId}
       AND pa.stage = 'read'
       AND pa.source_document_id = ${result.sourceDocumentId}
       AND pa.outcome = ANY(${STUCK_LINK_OUTCOMES}::text[])
       AND pa.created_at > NOW() - make_interval(days => ${STUCK_LINK_WINDOW_DAYS})
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
  // A companion page that is not a fee page (or is gone) is retired on its own; the
  // bank keeps its main fee link.
  const companionSourceId = await companionSourceOf(db, input.sourceDocumentId);
  if (companionSourceId != null) {
    await rejectCompanionPage(db, companionSourceId, input.reason);
    return false;
  }
  const companionStreams = await companionStreamsReady(db);
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
            ${companionStreams ? db`AND newer.companion_source_id IS NULL` : db``}
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
    companion: boolean;
  }>>(
    `
      SELECT adt.id AS text_id,
             adt.source_document_id,
             adt.institution_id,
             adt.source_url,
             adt.text_hash,
             adt.normalized_text,
             (sdoc.companion_source_id IS NOT NULL) AS companion,
             EXISTS (
               -- Rows Knox only held for review do not prove this is a fee page.
               SELECT 1 FROM raw_fee_observations fr
                WHERE fr.source = 'knox' AND fr.source_document_id = adt.source_document_id
                  AND fr.outlier_flags ? 'needs_darwin_verification'
             ) AS has_knox_fees
        FROM agent_source_texts adt
        JOIN institution_sources inst ON inst.id = adt.institution_id
        LEFT JOIN source_documents sdoc ON sdoc.id = adt.source_document_id
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
    const score = scoreFeePage(row.normalized_text, row.source_url, { feeSchedule: !row.companion });
    const isWrong = score.verdict === "wrong_document" && !row.has_knox_fees;
    let witnessRetention: WitnessRetention | undefined;
    if (isWrong) {
      wrong += 1;
      const statusWrite = await preserveStatusChange(db, Number(row.text_id), (scope) => scope`
        UPDATE agent_source_texts
           SET status = 'wrong_document', error_message = ${score.reason}, updated_at = NOW()
         WHERE id = ${Number(row.text_id)}
      `);
      witnessRetention = statusWrite.retention;
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
      detail: { text_id: Number(row.text_id), url: row.source_url, triage: true, ...score, witness_retention: witnessRetention },
    });
  }
  return { checked: rows.length, wrong, sentBack };
}

/**
 * Fee pages whose fees load by script were rejected as "not a fee page" before the free
 * script fallback existed (PR 206): their static text is menus, their own link names
 * the fee page, and they show at most one amount. Each gets one more read: Rosetta
 * lifts the 90-day ban on the link, gives the bank its link back when it has none (so
 * Magellan fetches it again), and logs a `read.reopen` attempt that makes the rejected
 * text readable once more. If the page still is not a fee page, the normal rejection
 * applies again. Nothing here touches a fee.
 */
async function reopenScriptLoadedFeePages(
  db: SqlTag,
  options: { runId: number; stepId: number | null; institutionId?: number; stateCode?: string; currentCopy?: boolean },
): Promise<{ reopened: number; unbanned: number; relinked: number }> {
  const params: Array<number | string> = [ROSETTA_REOPEN_LIMIT, REOPEN_STRATEGY, JS_FALLBACK_STRATEGY, ROSETTA_JS_FALLBACK_VERSION];
  const filters: string[] = [];
  if (options.currentCopy) {
    // An older copy of a page is history: its page's current copy is judged on its own.
    filters.push(`AND EXISTS (
           SELECT 1 FROM source_documents doc
            WHERE doc.id = adt.source_document_id
              AND doc.superseded_by_id IS NULL
              AND doc.duplicate_of_id IS NULL
         )`);
  }
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
    source_url: string;
    source_hash: string;
    normalized_text: string;
  }>>(
    `
      SELECT adt.id AS text_id, adt.source_document_id, adt.institution_id, adt.source_url,
             adt.source_hash, adt.normalized_text
        FROM agent_source_texts adt
        JOIN institution_sources inst ON inst.id = adt.institution_id
       WHERE adt.status = 'wrong_document'
         AND adt.document_type = 'html'
         AND adt.source_url IS NOT NULL
         AND adt.source_hash IS NOT NULL
         ${filters.join("\n         ")}
         -- The link names the fee page (urlNamesFeePage re-checks it exactly).
         AND regexp_replace(adt.source_url, '^https?://[^/]+', '') ~* '(fee-?schedule|schedule-of-(fees|charges)|fee-?disclosure|service-charges|pricing|(^|[/_-])fees?([/_.-]|$))'
         -- Never tried by the current script fallback, and not checked for reopening since
         -- an older fallback tried it: a fallback that learns new routes gets one more look.
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts js
            WHERE js.stage = 'read' AND js.institution_id = adt.institution_id
              AND js.source_document_id = adt.source_document_id AND js.strategy = $3
              AND js.strategy_version >= $4
         )
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts reopen
            WHERE reopen.stage = 'read' AND reopen.institution_id = adt.institution_id
              AND reopen.input_fingerprint = adt.source_hash AND reopen.strategy = $2
              AND reopen.created_at > COALESCE((
                SELECT MAX(js.created_at) FROM pipeline_attempts js
                 WHERE js.stage = 'read' AND js.institution_id = adt.institution_id
                   AND js.source_document_id = adt.source_document_id AND js.strategy = $3
              ), '-infinity'::timestamptz)
         )
       ORDER BY adt.id
       LIMIT $1
    `,
    params,
  );

  let reopened = 0;
  let unbanned = 0;
  let relinked = 0;
  for (const row of rows) {
    const institutionId = Number(row.institution_id);
    const score = scoreFeePage(row.normalized_text);
    // A page with real amounts was judged on its own text; only menus-only pages reopen.
    const eligible = urlNamesFeePage(row.source_url) && score.dollarAmounts <= 1;
    if (eligible) {
      reopened += 1;
      const lifted = await db`
        UPDATE institution_source_profiles
           SET rejected_source_urls = (
                 SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
                   FROM jsonb_array_elements(COALESCE(rejected_source_urls, '[]'::jsonb)) entry
                  WHERE entry->>'url' IS DISTINCT FROM ${row.source_url}
               ),
               updated_at = NOW()
         WHERE institution_id = ${institutionId}
           AND COALESCE(rejected_source_urls, '[]'::jsonb) @> ${JSON.stringify([{ url: row.source_url }])}::jsonb
        RETURNING institution_id
      `;
      unbanned += lifted.length;
      // Only a bank left with no link gets this one back; a bank that moved on keeps its link.
      const restored = await db`
        UPDATE institution_sources inst
           SET fee_schedule_url = ${row.source_url},
               document_type = 'html',
               rescue_status = 'rescued',
               last_rescue_attempt_at = NOW(),
               failure_reason = NULL,
               failure_reason_note = NULL,
               failure_reason_updated_at = NOW()
         WHERE inst.id = ${institutionId}
           AND NULLIF(btrim(inst.fee_schedule_url), '') IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM institution_source_profiles profile
              WHERE profile.institution_id = inst.id AND profile.locked_by_correction IS TRUE
           )
        RETURNING inst.id
      `;
      relinked += restored.length;
    }
    await recordAttempt(db, {
      institutionId,
      sourceDocumentId: Number(row.source_document_id),
      stage: "read",
      strategy: REOPEN_STRATEGY,
      version: REOPEN_VERSION,
      fingerprint: row.source_hash,
      // "rejected": checked and left closed, so it is not checked again.
      outcome: eligible ? "ok" : "rejected",
      yieldCount: 0,
      costMicrousd: 0,
      runId: options.runId,
      stepId: options.stepId,
      detail: { text_id: Number(row.text_id), url: row.source_url, dollar_amounts: score.dollarAmounts },
    });
  }
  return { reopened, unbanned, relinked };
}

/**
 * A PDF text read before Rosetta told unreadable embedded text from a real one (its font
 * maps letters to control codes or shifted letters; TruStone's fee schedule, Hfs FCU's
 * disclosure) gets one more read: a `read.reopen` attempt makes the stored text readable
 * once more, and the PDF read now sends such text to free OCR. A text that reads as words
 * is logged "rejected" and never checked again. Nothing here touches a fee.
 */
async function reopenUnreadablePdfTexts(
  db: SqlTag,
  options: { runId: number; stepId: number | null; institutionId?: number; stateCode?: string; currentCopy?: boolean },
): Promise<number> {
  const params: Array<number | string> = [ROSETTA_REOPEN_LIMIT, REOPEN_STRATEGY, CONTROL_CODES_PATTERN];
  const filters: string[] = [];
  if (options.currentCopy) {
    filters.push(`AND EXISTS (
           SELECT 1 FROM source_documents doc
            WHERE doc.id = adt.source_document_id
              AND doc.superseded_by_id IS NULL
              AND doc.duplicate_of_id IS NULL
         )`);
  }
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
    source_hash: string;
    normalized_text: string;
  }>>(
    `
      SELECT adt.id AS text_id, adt.source_document_id, adt.institution_id, adt.source_url,
             adt.source_hash, adt.normalized_text
        FROM agent_source_texts adt
        JOIN institution_sources inst ON inst.id = adt.institution_id
       WHERE adt.status IN ('completed', 'wrong_document')
         AND adt.document_type = 'pdf'
         AND adt.source_hash IS NOT NULL
         ${filters.join("\n         ")}
         -- Cheap first cut: control codes near the top of the text.
         AND left(adt.normalized_text, 400) ~ $3
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts reopen
            WHERE reopen.stage = 'read' AND reopen.institution_id = adt.institution_id
              AND reopen.input_fingerprint = adt.source_hash AND reopen.strategy = $2
         )
       ORDER BY adt.id
       LIMIT $1
    `,
    params,
  );
  let reopened = 0;
  for (const row of rows) {
    const unreadable = !hasReadableWords(row.normalized_text);
    if (unreadable) reopened += 1;
    await recordAttempt(db, {
      institutionId: Number(row.institution_id),
      sourceDocumentId: Number(row.source_document_id),
      stage: "read",
      strategy: REOPEN_STRATEGY,
      version: REOPEN_VERSION,
      fingerprint: row.source_hash,
      outcome: unreadable ? "ok" : "rejected",
      yieldCount: 0,
      costMicrousd: 0,
      runId: options.runId,
      stepId: options.stepId,
      detail: { text_id: Number(row.text_id), url: row.source_url, unreadable_pdf_text: unreadable },
    });
  }
  return reopened;
}

/** Five control codes (not tab or line breaks) in a stretch of text. */
export const CONTROL_CODES_PATTERN = "([\\x01-\\x08\\x0e-\\x1f][^\\x01-\\x08\\x0e-\\x1f]*){5}";

interface SettleReadEnv {
  runId: number;
  stepId: number | null;
  learning: boolean;
  vaultSchema: boolean;
  textColumns: boolean;
}

/**
 * Stores one read and its attempts, and sends a page that is not a fee schedule (or is gone)
 * back to Magellan: what every Rosetta read does after the reader returns. Shared by the read
 * step and a hand-supplied document's read (`readHandSuppliedDocument`).
 */
async function settleReadInScope(
  db: SqlTag,
  row: ReadCandidateRow,
  result: ReadResult,
  normalizedText: string | null,
  env: SettleReadEnv,
  repairProof?: { artifactId: number; lossless: boolean },
): Promise<"sent_back" | "handed_to_magellan" | null> {
  const { learning, vaultSchema, textColumns } = env;
  const byteIdentityUnavailable = result.primaryByteIdentity?.status === "mismatch"
    || result.primaryByteIdentity?.status === "invalid_selected_hash";
  // A companion page's reads stay out of the bank's playbook (its main fee link's).
  const foldIntoPlaybook = !byteIdentityUnavailable && row.companion_source_id == null && !(row.pdf_stacked_repair_due && result.status !== "completed");
  let settled: "sent_back" | "handed_to_magellan" | null = null;
  // A re-read replaces the earlier text only with a better answer; otherwise the old
  // text stays and only the attempt is logged. A text whose fees did not hold up still
  // has live fees: a re-read keeps it unless the new text lists at least as many fees,
  // and never sends the bank back to Magellan.
  const keepLostText =
    row.last_lost_text != null &&
    !(result.status === "completed" && normalizedText != null
      && (rungTextNotWorse(normalizedText, row.last_lost_text) || repairProof?.lossless === true));
  const keepEarlierText =
    byteIdentityUnavailable || keepLostText || (row.pdf_stacked_repair_due && result.status !== "completed")
    || (result.reread && result.status !== "completed" && result.status !== "wrong_document");
  if (!keepEarlierText) await recordReadResult(db, env.runId, result, normalizedText, textColumns);
  if (keepLostText) {
    // Only the attempt below is logged.
  } else if (!keepEarlierText && (result.status === "wrong_document" || result.handoff)) {
    if (
      await sendBackToMagellan(db, {
        institutionId: result.institutionId,
        sourceDocumentId: result.sourceDocumentId,
        url: result.sourceUrl,
        reason: result.error ?? "Not a fee schedule",
        failureReason: result.handoff ? "rosetta_js_required" : "rosetta_wrong_document",
      })
    ) {
      settled = result.handoff ? "handed_to_magellan" : "sent_back";
    }
  } else if (!row.pdf_stacked_repair_due && await isUnreachableLink(db, result)) {
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
      settled = "sent_back";
    }
  }
  if (learning && result.attemptOutcome) {
    await recordAttempt(db, {
      institutionId: result.institutionId,
      sourceDocumentId: result.sourceDocumentId,
      stage: "read",
      strategy: result.strategy ?? `read.${result.documentType ?? "unknown"}`,
      version: result.strategy === PDF_STACKED_REPAIR_STRATEGY ? PDF_STACKED_REPAIR_VERSION
        : result.strategy === DOCUMENT_ACCESS_STRATEGY ? ROSETTA_DOCUMENT_ACCESS_VERSION : ROSETTA_READ_VERSION,
      fingerprint: result.sourceHash,
      outcome: result.attemptOutcome,
      yieldCount: result.charCount,
      costMicrousd: 0,
      durationMs: result.durationMs,
      runId: env.runId,
      stepId: env.stepId,
      foldIntoPlaybook,
      format: result.format,
      detail: {
        url: result.sourceUrl,
        document_type: result.documentType,
        content_type: result.contentType,
        router: result.routerReason,
        from_vault: result.fromVault,
        primary_byte_identity: result.primaryByteIdentity,
        table_rows: result.tableRows,
        reader: result.reader,
        reader_version: ROSETTA_READ_VERSION,
        witness_retention: result.witnessRetention,
        pdf_layout: result.reader === PRIMARY_READERS.pdf ? PDF_LAYOUT_VERSION : undefined,
        pdf_stacked_requested: row.pdf_stacked_repair_due ? PDF_STACKED_REPAIR_VERSION : undefined,
        pdf_stacked: repairProof && !keepEarlierText ? PDF_STACKED_REPAIR_VERSION : undefined,
        persisted_text_id: repairProof && !keepEarlierText ? repairProof.artifactId : undefined,
        persisted_text_hash: repairProof && !keepEarlierText ? result.textHash : undefined,
        pdf_stacked_acceptance: repairProof && !keepEarlierText ? (repairProof.lossless ? "lossless_geometry" : "ordinary_survival") : undefined,
        // Only for text this read stores: a kept earlier text was not the one compared.
        pdf_reader_agreement: result.reader === PRIMARY_READERS.pdf && !keepEarlierText ? result.readerAgreement : undefined,
        reread: result.reread,
        escalation: result.escalation ?? null,
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
        runId: env.runId,
        stepId: env.stepId,
        foldIntoPlaybook,
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
        runId: env.runId,
        stepId: env.stepId,
        foldIntoPlaybook,
        detail: {
          tables: new Set(result.rows.map((tableRow) => tableRow.table)).size,
          origins: [...new Set(result.rows.map((tableRow) => tableRow.origin))],
        },
      });
    }
    if (vaultSchema && result.textHash && !keepEarlierText) {
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
        runId: env.runId,
        stepId: env.stepId,
        foldIntoPlaybook,
        detail: { url: result.sourceUrl, ...(result.pageCheck ?? {}) },
      });
    }
  }
  return settled;
}

/** Artifact replacement and its successful marker must commit together. */
async function atomicRepair<T>(db: SqlTag, work: (scope: SqlTag) => Promise<T>): Promise<T> {
  const savepoint = (db as unknown as { savepoint?: (work: (scope: SqlTag) => Promise<T>) => Promise<T> }).savepoint;
  if (savepoint) return savepoint.call(db, work);
  return db.begin((scope) => work(scope as unknown as SqlTag)) as Promise<T>;
}

async function settleRead(
  db: SqlTag, row: ReadCandidateRow, result: ReadResult, normalizedText: string | null, env: SettleReadEnv,
): Promise<"sent_back" | "handed_to_magellan" | null> {
  if (!row.pdf_stacked_repair_due) return settleReadInScope(db, row, result, normalizedText, env);
  return atomicRepair(db, async (scope) => {
    const [current] = await scope`
      SELECT adt.id, adt.institution_id, adt.status AS text_status, adt.reader, adt.text_hash, adt.source_hash, adt.normalized_text,
             doc.document_url, doc.content_hash, doc.document_r2_key, doc.status AS source_status,
             doc.superseded_by_id, doc.duplicate_of_id
        FROM agent_source_texts adt JOIN source_documents doc ON doc.id = adt.source_document_id
       WHERE doc.id = ${result.sourceDocumentId} AND doc.institution_id = ${result.institutionId}
       FOR UPDATE OF doc, adt
    `;
    const incumbent = row.pdf_repair_incumbent;
    const sameIncumbent = current && incumbent && Number(current.id) === Number(incumbent.id)
      && current.text_hash === incumbent.text_hash && current.source_hash === incumbent.source_hash
      && current.normalized_text === incumbent.normalized_text && textSha256(current.normalized_text) === current.text_hash
      && Number(current.institution_id) === result.institutionId && current.text_status === "completed" && current.reader === PRIMARY_READERS.pdf
      && current.document_url === row.document_url
      && current.content_hash === row.content_hash && current.source_hash === row.content_hash
      && current.source_status === "success" && current.superseded_by_id == null && current.duplicate_of_id == null
      && current.document_r2_key === `${row.content_hash?.slice(0, 2)}/${row.content_hash}`;
    const reject = async (reason: string) => {
      result.repairSettlement = { accepted: false, reason };
      if (env.learning) await recordAttempt(scope, {
        institutionId: result.institutionId, sourceDocumentId: result.sourceDocumentId,
        stage: "read", strategy: PDF_STACKED_REPAIR_STRATEGY, version: PDF_STACKED_REPAIR_VERSION,
        fingerprint: result.sourceHash, outcome: "evidence_mismatch", yieldCount: 0, costMicrousd: 0,
        runId: env.runId, stepId: env.stepId, foldIntoPlaybook: false,
        detail: { pdf_stacked_requested: PDF_STACKED_REPAIR_VERSION, pdf_stacked_rejected: true,
          reason, selected_text_id: incumbent?.id, selected_text_hash: incumbent?.text_hash,
          candidate_text_hash: result.textHash },
      });
      return null;
    };
    if (!sameIncumbent) return reject("selected_incumbent_changed");
    if (result.status !== "completed") return settleReadInScope(scope, row, result, normalizedText, env);
    if (!normalizedText || result.textHash !== textSha256(normalizedText)
      || !result.fromVault || result.reader !== PRIMARY_READERS.pdf || result.sourceHash !== current.content_hash) {
      return reject("unbound_pdf_result");
    }
    const lossless = acceptableFeeText(normalizedText)
      && losslessStackedRecovery(current.normalized_text, normalizedText, current.source_hash, result.stackedGeometry);
    // Only the actual geometry detector with exact token conservation may replace
    // a lost text that fails the ordinary physical-line score. The general rule stays unchanged.
    if (row.last_lost_text != null && !rungTextNotWorse(normalizedText, row.last_lost_text) && !lossless) {
      return reject("text_survival_retained_incumbent");
    }
    result.repairSettlement = { accepted: true, reason: lossless ? "lossless_geometry" : "ordinary_survival",
      artifactId: Number(current.id), textHash: result.textHash };
    return settleReadInScope(scope, row, result, normalizedText, env, { artifactId: Number(current.id), lossless });
  });
}

/**
 * Reads one document a person supplied by hand (`magellan/hand-supplied.ts`) from the bytes
 * they uploaded, with the same reader, fee-page check, text record and attempts as the read
 * step. Nothing is downloaded: the bank's site is the one that refused us, so any request the
 * reader would make (a linked page) is answered with a refusal instead of going out.
 */
export async function readHandSuppliedDocument(options: {
  db?: SqlTag;
  runId: number;
  stepId?: number | null;
  sourceDocumentId: number;
  bytes: Uint8Array;
  contentType: string | null;
  pdfTextExtractor?: PdfTextExtractor;
  /** Free OCR for a scan; defaults to tesseract.js, closed here when created here. */
  scannedPdfReader?: ScannedPdfReader | null;
}): Promise<ReadResult | null> {
  const db = options.db ?? sql;
  const learning = await learningSchemaReady(db);
  const vaultSchema = learning && (await documentVaultSchemaReady(db));
  const textColumns = await rosettaTextColumnsReady(db);
  const companionStreams = await companionStreamsReady(db);
  const [row] = companionStreams
    ? await db<ReadCandidateRow[]>`
        SELECT doc.id AS source_document_id, doc.institution_id, inst.institution_name, doc.document_url,
               doc.content_hash, doc.companion_source_id
          FROM source_documents doc
          JOIN institution_sources inst ON inst.id = doc.institution_id
         WHERE doc.id = ${options.sourceDocumentId}
      `
    : await db<ReadCandidateRow[]>`
        SELECT doc.id AS source_document_id, doc.institution_id, inst.institution_name, doc.document_url,
               doc.content_hash
          FROM source_documents doc
          JOIN institution_sources inst ON inst.id = doc.institution_id
         WHERE doc.id = ${options.sourceDocumentId}
      `;
  if (!row) return null;
  const documentUrl = normalizeHttpUrl(row.document_url);
  const supplied = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (documentUrl != null && url === documentUrl) {
      return new Response(new Uint8Array(options.bytes), {
        status: 200,
        headers: options.contentType ? { "content-type": options.contentType } : {},
      });
    }
    return new Response("Not requested: this document was supplied by hand", { status: 403, statusText: "hand-supplied, no download" });
  }) as Fetcher;
  const ownsOcr = options.scannedPdfReader === undefined;
  const ocr = ownsOcr ? createScannedPdfReader() : options.scannedPdfReader ?? null;
  const ctx: ReadContext = {
    fetchImpl: supplied,
    pdfTextExtractor: options.pdfTextExtractor ?? extractPdfText,
    vault: null,
    checkPage: vaultSchema,
    ocr,
    ocrBudget: { left: 1 },
    knownDocuments: knownDocumentsLoader(db),
  };
  try {
    const { result, normalizedText } = await readCandidate(row, ctx);
    if (result.status === "known_failure" || result.status === "deferred") return result;
    await settleRead(db, row, result, normalizedText, {
      runId: options.runId,
      stepId: options.stepId ?? null,
      learning,
      vaultSchema,
      textColumns,
    });
    return result;
  } finally {
    if (ownsOcr) await ocr?.close().catch((error) => console.error("Rosetta OCR worker did not stop cleanly:", error));
  }
}

export async function runRosettaRead(
  options: RunRosettaReadOptions,
): Promise<RunRosettaReadResult> {
  const db = options.db ?? sql;
  const fetchImpl = options.fetchImpl ?? feeSourceFetch;
  const pdfTextExtractor = options.pdfTextExtractor ?? extractPdfText;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const learning = !dryRun && (await learningSchemaReady(db));
  // The fee-page check and the vault need the document-vault migration (new status, columns).
  const vaultSchema = learning && (await documentVaultSchemaReady(db));
  const vault = vaultSchema ? options.vault ?? getDocumentVault() : null;
  // Table rows and the reader column need migration 20270106020000.
  const textColumns = !dryRun && (await rosettaTextColumnsReady(db));
  const companionStreams = !dryRun && (await companionStreamsReady(db));
  const currentCopy = learning && (await currentCopySchemaReady(db));
  const reopen = vaultSchema
    ? await reopenScriptLoadedFeePages(db, {
        runId: options.runId,
        stepId: options.stepId ?? null,
        institutionId: options.institutionId,
        stateCode: options.stateCode,
        currentCopy,
      })
    : { reopened: 0, unbanned: 0, relinked: 0 };
  const reopenedUnreadablePdfs = vaultSchema
    ? await reopenUnreadablePdfTexts(db, {
        runId: options.runId,
        stepId: options.stepId ?? null,
        institutionId: options.institutionId,
        stateCode: options.stateCode,
        currentCopy,
      })
    : 0;
  // A copy read as a bot check or script shell never displaces the page's readable copy.
  const thinCopies = learning
    ? await restoreReadableCopies(db, { institutionId: options.institutionId })
    : { thinCopies: [], superseded: 0 };
  // Learning plan step 1: score each text by whether its fees stayed live (once a day).
  const textSurvivalReady = learning && textColumns && (await feedbackSchemaReady(db));
  const survival = textSurvivalReady
    ? await syncTextSurvival(db, { runId: options.runId, dryRun })
    : { ready: false, refreshed: false, texts: 0, held: 0, lost: 0, written: 0 };
  // Every BATCH_REVIEW_SIZE settled reads: judge the batch, write its misses as lessons (read
  // below by the candidate and paid-read selections) and its error rate. Not in a dry run.
  // A failed review never stops the reads; its error is on the step result.
  let batchReviewError: string | null = null;
  const batchReview = textSurvivalReady
    ? await reviewReadBatches(db, { runId: options.runId }).catch((error: unknown) => {
        batchReviewError = error instanceof Error ? error.message : String(error);
        return { ready: false, batches: [], written: 0 } as BatchReviewResult;
      })
    : { ready: false, batches: [], written: 0 };
  const selectionArgs = [
    learning, options.institutionId, options.stateCode, vaultSchema,
    companionStreams, textSurvivalReady, currentCopy,
  ] as const;
  const repairs = learning && vaultSchema && companionStreams && currentCopy
    ? (await selectCandidates(db, Math.min(limit, PDF_STACKED_REPAIR_MAX_PER_RUN), ...selectionArgs, "only"))
      .filter((row) => row.pdf_stacked_repair_due === true)
    : [];
  const ordinary = repairs.length < limit
    ? await selectCandidates(db, limit - repairs.length, ...selectionArgs, "exclude")
    : [];
  const rows = [...ordinary, ...repairs];

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
    knownDocuments: knownDocumentsLoader(db),
  };

  const results: ReadResult[] = [];
  let sentBack = 0;
  let handedToMagellan = 0;
  try {
    for (const row of rows) {
      const { result, normalizedText } = await readCandidate(row, ctx);
      results.push(result);
      if (dryRun || result.status === "known_failure" || result.status === "deferred") continue;
      const settled = await settleRead(db, row, result, normalizedText, {
        runId: options.runId,
        stepId: options.stepId ?? null,
        learning,
        vaultSchema,
        textColumns,
      });
      if (settled === "handed_to_magellan") handedToMagellan += 1;
      else if (settled === "sent_back") sentBack += 1;
    }
  } finally {
    if (ownsOcr) await ocr?.close().catch((error) => console.error("Rosetta OCR worker did not stop cleanly:", error));
  }

  // #2219: a measured dry run of the current layout on older-layout texts. Record-only; a failure
  // never stops the step, its error is on the result. Inside a caller's transaction it runs in a
  // savepoint, so a failed recheck statement cannot abort the rest of the step.
  let layoutRecheckError: string | null = null;
  const recheck = (scope: SqlTag) => runLayoutRecheck(scope, {
    runId: options.runId,
    stepId: options.stepId ?? null,
    institutionId: options.institutionId,
    stateCode: options.stateCode,
    limit: options.layoutRecheckPerRun,
    vault,
    pdfTextExtractor,
  });
  const recheckSavepoint = (db as unknown as {
    savepoint?: (work: (scope: SqlTag) => Promise<LayoutRecheckResult>) => Promise<LayoutRecheckResult>;
  }).savepoint;
  const layoutRecheck: LayoutRecheckResult = learning && vaultSchema && currentCopy && textColumns
    ? await (recheckSavepoint ? recheckSavepoint.call(db, recheck) : recheck(db)).catch((error: unknown) => {
        layoutRecheckError = error instanceof Error ? error.message : String(error);
        return emptyLayoutRecheckResult();
      })
    : emptyLayoutRecheckResult();

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
  // #1094: texts read before Rosetta stored a kind (or under an older kind version) get one.
  const kinds = textColumns
    ? await backfillDocumentKinds(db, { dryRun, institutionId: options.institutionId })
    : { classified: 0, byKind: {} };

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
    reopenedFeePages: reopen.reopened,
    reopenedBansLifted: reopen.unbanned,
    reopenedLinksRestored: reopen.relinked,
    reopenedUnreadablePdfs,
    thinCopiesSetAside: thinCopies.thinCopies,
    textSurvivalRefreshed: survival.refreshed,
    textsHeldUp: survival.held,
    textsLostFees: survival.lost,
    readerEscalations: results.filter((result) => result.escalation != null).length,
    readerEscalationsUsed: results.filter((result) => result.escalation?.used).length,
    batchReviews: batchReview.batches,
    batchReviewError,
    layoutRechecked: layoutRecheck.rechecked,
    layoutRecheckNotCompared: layoutRecheck.notCompared,
    layoutRecheckTextChanged: layoutRecheck.textChanged,
    layoutRecheckLost: layoutRecheck.lost,
    layoutRecheckGained: layoutRecheck.gained,
    layoutRecheckError,
    formatsBackfilled: formats.updated,
    documentKindsBackfilled: kinds.classified,
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
