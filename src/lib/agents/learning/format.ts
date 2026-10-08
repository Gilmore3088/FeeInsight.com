/**
 * Document format detection from bytes, not from the URL. A fee schedule served as
 * `application/octet-stream` from `/download?id=7` is still a PDF if it starts with
 * `%PDF`, and a `.pdf` URL that returns an HTML error page is HTML.
 */

export type DocumentFormat = "pdf" | "docx" | "html" | "text" | "other";

/** The learned playbook format: the document format plus what reading it revealed. */
export type PlaybookFormat = "pdf_text" | "pdf_scanned" | "html_static" | "html_js" | "docx" | "text" | "other";

/** Below this many non-whitespace characters per page, a PDF is treated as a scan. */
export const SCANNED_PDF_CHARS_PER_PAGE = 200;

const SNIFF_BYTES = 2048;

function startsWithBytes(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function latin1(bytes: Uint8Array, length: number): string {
  let text = "";
  const end = Math.min(bytes.length, length);
  for (let index = 0; index < end; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

function fromContentType(contentType: string | null, url?: string | null): DocumentFormat {
  const type = contentType?.toLowerCase() ?? "";
  if (type.includes("application/pdf")) return "pdf";
  if (type.includes("wordprocessingml") || type.includes("application/msword")) return "docx";
  if (type.includes("text/html") || type.includes("application/xhtml")) return "html";
  if (type.includes("text/plain")) return "text";
  const path = url?.toLowerCase().split(/[?#]/)[0] ?? "";
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".docx") || path.endsWith(".doc")) return "docx";
  return "other";
}

export function detectFormat(bytes: Uint8Array | null, contentType: string | null, url?: string | null): DocumentFormat {
  if (!bytes || bytes.length === 0) return fromContentType(contentType, url);

  const head = latin1(bytes, SNIFF_BYTES);
  // PDF readers accept the header anywhere in the first 1024 bytes.
  const pdfAt = head.indexOf("%PDF");
  if (pdfAt >= 0 && pdfAt < 1024) return "pdf";

  if (startsWithBytes(bytes, 0, [0x50, 0x4b, 0x03, 0x04])) {
    return head.includes("word/") || fromContentType(contentType, url) === "docx" ? "docx" : "other";
  }
  if (startsWithBytes(bytes, 0, [0xd0, 0xcf, 0x11, 0xe0])) return "docx"; // legacy .doc (OLE)

  const trimmed = head.replace(/^\xEF\xBB\xBF/, "") // UTF-8 BOM, decoded as latin1.trimStart();
  if (/^<(!doctype\s+html|html|head|body)\b/i.test(trimmed) || /<(html|body|table|div|p)\b[^>]*>/i.test(head)) {
    return "html";
  }

  let control = 0;
  for (let index = 0; index < Math.min(bytes.length, SNIFF_BYTES); index += 1) {
    const value = bytes[index];
    if (value < 0x09 || (value > 0x0d && value < 0x20)) control += 1;
  }
  if (control === 0) {
    const declared = fromContentType(contentType, url);
    return declared === "html" ? "html" : "text";
  }
  return "other";
}

/** The legacy `document_type` value stored on source rows for a detected format. */
export function documentTypeForFormat(format: DocumentFormat): string {
  return format === "other" ? "unknown" : format;
}

/** A PDF whose embedded text is too thin to be the real content is a scan. */
export function isLikelyScannedPdf(text: string, pageCount: number): boolean {
  const chars = text.replace(/\s+/g, "").length;
  const pages = Math.max(1, Math.floor(pageCount) || 1);
  return chars / pages < SCANNED_PDF_CHARS_PER_PAGE || !hasReadableWords(text);
}

const COMMON_WORDS = new Set([
  "the", "and", "of", "to", "in", "for", "or", "on", "is", "fee", "fees", "account", "accounts", "your", "you",
  "per", "with", "by", "be", "are", "may", "if", "at", "we", "our", "any", "each", "this", "will", "not", "from",
  "as", "an", "no", "charge", "check", "balance", "monthly", "month", "service", "item", "transfer",
  // A Spanish schedule ("Lista de Cargos") is readable text, not noise.
  "de", "la", "el", "los", "las", "del", "por", "en", "y", "cuenta", "cuentas", "cargo", "cargos",
]);
const MIN_WORDS_TO_JUDGE = 60;
const MIN_COMMON_WORD_SHARE = 0.02;

/**
 * A PDF whose embedded font maps its letters to other codes reads as noise ("7KH UDWHV
 * IHHV" for "The rates fees", or control characters): the text is there but unreadable,
 * so it is read like a scan. Text too short to judge counts as readable.
 */
export function hasReadableWords(text: string): boolean {
  const words = text.replace(/[\u0000-\u001f]/g, " ").match(/[A-Za-z]+/g) ?? [];
  if (words.length < MIN_WORDS_TO_JUDGE) return true;
  const common = words.filter((word) => COMMON_WORDS.has(word.toLowerCase())).length;
  return common / words.length >= MIN_COMMON_WORD_SHARE;
}
