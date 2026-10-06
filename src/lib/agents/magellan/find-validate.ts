import { crawlerUserAgent } from "@/lib/agents/crawler-identity";
import { htmlToScoringText, scoreFeePage, urlNamesFeePage } from "@/lib/agents/learning/fee-page";

/**
 * The fee-page check every Magellan finder (free and paid) runs before a link is
 * stored: open the candidate and make sure it is a fee schedule. HTML pages must list
 * fees, not just mention them in a footer; PDFs are downloaded and their first pages
 * read, so a rate sheet or a press release never becomes the bank's link. A PDF with
 * no readable text (a scan) is accepted only on a strong fee label.
 */

type Fetcher = typeof fetch;

export const FIND_REQUEST_TIMEOUT_MS = 8_000;
/** PDFs larger than this are not downloaded to check; they are judged by their label. */
export const MAX_PDF_CHECK_BYTES = 8 * 1024 * 1024;
const PDF_CHECK_PAGES = 3;
const PDF_CHECK_TIMEOUT_MS = 6_000;
/** A scanned or unreadable PDF needs at least this link score to be accepted. */
export const UNREADABLE_PDF_MIN_SCORE = 0.8;

const FEE_CONTENT_KEYWORDS = [
  "monthly maintenance fee",
  "overdraft fee",
  "nsf fee",
  "insufficient funds",
  "atm fee",
  "wire transfer fee",
  "service charge",
  "account fee",
  "statement fee",
  "returned item",
  "stop payment",
  "truth in savings",
  "schedule of fees",
  "fee schedule",
  "fee disclosure",
];

/**
 * An account or product page ("/personal/checking", "/savings-accounts"): it may quote a
 * monthly fee or two, but it is not the bank's fee schedule. Such pages are kept as
 * companion account pages (`second-document.ts`), never as the bank's fee link.
 */
const PRODUCT_PATH =
  /\/[^?#]*(checking|savings|accounts?([/._?-]|$)|money-?market|certificates?|personal-banking|business-banking|deposit-products?|share-accounts?)/i;
const FEE_NAMED_PATH = /(fee|schedule|charge|disclos|truth|pricing)/i;

export function looksLikeProductPage(url: string): boolean {
  let path: string;
  try {
    const parsed = new URL(url);
    path = decodeURIComponent(parsed.pathname + parsed.search);
  } catch {
    return false;
  }
  return PRODUCT_PATH.test(path) && !FEE_NAMED_PATH.test(path) && !looksLikePdfUrl(url);
}

/** Page text without its site navigation, header and footer, where fee words appear on every page. */
export function mainContentText(html: string): string {
  return htmlToScoringText(
    html
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, " "),
  );
}

export interface FeeCandidate {
  url: string;
  /** Link score 0..1 from its label and address (see `scoreLink` in finders.ts). */
  score: number;
  reasons: string[];
}

export type CandidateVerdict =
  | "accepted_html"
  | "accepted_pdf"
  | "accepted_pdf_unreadable"
  | "not_fee_page"
  | "rate_page"
  | "too_few_fee_words"
  | "product_page"
  | "unreadable_pdf_weak_label"
  | "not_a_pdf"
  | "unsupported_type"
  | "fetch_failed"
  | `http_${number}`;

export interface CandidateValidation {
  ok: boolean;
  documentType: "html" | "pdf" | null;
  confidence: number;
  reason: string;
  verdict: CandidateVerdict;
  /** HTTP status, when a response arrived. */
  status: number | null;
  /** The page HTML, when it was HTML (finders follow its links). */
  html: string | null;
}

export async function fetchWithTimeout(fetchImpl: Fetcher, url: string, timeoutMs = FIND_REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": crawlerUserAgent("Magellan"),
        Accept: "text/html,application/pdf;q=0.9,*/*;q=0.5",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function looksLikePdfUrl(url: string): boolean {
  return /\.pdf($|\?)/i.test(url);
}

/** Text of the first `maxPages` pages of a PDF, or null when it has none (a scan) or cannot be read. */
export async function pdfCheckText(bytes: Uint8Array, maxPages = PDF_CHECK_PAGES): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const read = (async () => {
      const pdf = await getDocumentProxy(bytes);
      try {
        const pages = Math.min(Number(pdf.numPages ?? 0), maxPages);
        const lines: string[] = [];
        for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
          const content = await (await pdf.getPage(pageNumber)).getTextContent();
          // Items on one baseline form one line, so a fee name stays next to its amount.
          let lastY: number | null = null;
          let line = "";
          for (const item of content.items) {
            if (!("str" in item)) continue;
            const y = Math.round(Number(item.transform?.[5] ?? 0));
            if (lastY != null && Math.abs(y - lastY) > 2) {
              lines.push(line);
              line = "";
            }
            line += `${line ? " " : ""}${item.str}`;
            lastY = y;
          }
          if (line) lines.push(line);
        }
        return lines.join("\n");
      } finally {
        await pdf.destroy?.();
      }
    })();
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PDF_CHECK_TIMEOUT_MS);
    });
    const text = await Promise.race([read, timeout]);
    return text && text.replace(/\s+/g, "").length >= 40 ? text : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rejected(verdict: CandidateVerdict, reason: string, status: number | null, confidence = 0): CandidateValidation {
  return { ok: false, documentType: null, confidence, reason, verdict, status, html: null };
}

/** Open a candidate and decide whether it is the bank's fee schedule. Throws only on network errors. */
export async function validateFeeCandidate(candidate: FeeCandidate, fetchImpl: Fetcher): Promise<CandidateValidation> {
  const response = await fetchWithTimeout(fetchImpl, candidate.url);
  if (!response.ok) {
    return rejected(`http_${response.status}`, `Candidate HTTP ${response.status}`, response.status);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/pdf") || (looksLikePdfUrl(candidate.url) && !contentType.includes("text/html"))) {
    return validatePdf(candidate, response);
  }
  if (!contentType.includes("text/html")) {
    return rejected("unsupported_type", `Unsupported content type ${contentType || "unknown"}`, response.status);
  }

  const rawBody = await response.text();
  const mainText = mainContentText(rawBody);
  const body = mainText.toLowerCase();
  // Fee words in a footer or menu ("Fee Schedule | Truth in Savings") appear on every page
  // of the site, so they are counted on the page's own content only.
  const keywordMatches = FEE_CONTENT_KEYWORDS.filter((keyword) => body.includes(keyword)).length;
  // The page must actually list fees with amounts, or at least not clearly fail the check.
  const page = scoreFeePage(mainText, candidate.url);
  if (page.verdict === "wrong_document") {
    return { ...rejected("not_fee_page", `Candidate page is not a fee schedule (${page.reason})`, response.status, candidate.score), html: rawBody };
  }
  // A rates page lists APYs and minimum balances; its footer may still say "Fee Schedule".
  if (page.verdict !== "fee_page" && page.rateTerms >= 4 && page.feeLines < 2) {
    return { ...rejected("rate_page", `Candidate is a rates page (${page.rateTerms} rate terms, ${page.feeLines} fee lines)`, response.status, candidate.score), html: rawBody };
  }
  // Below the fee-page bar (3 fee lines) a page is accepted only when its address names
  // the fee page, or its link label is strong and it lists at least one fee. A checking
  // account page quoting its monthly fee is not the schedule (Magellan audit, Oct 6:
  // 853 of 4,451 fee links were product pages, median 4 live fees vs 15).
  const accepted =
    page.verdict === "fee_page" ||
    (keywordMatches >= 2 && urlNamesFeePage(candidate.url)) ||
    (keywordMatches >= 2 && candidate.score >= 0.88 && page.feeLines >= 1 && !looksLikeProductPage(candidate.url));
  if (accepted) {
    return {
      ok: true,
      documentType: "html",
      confidence: Math.max(candidate.score, page.verdict === "fee_page" ? 0.88 : 0.8),
      reason: `${keywordMatches} fee keywords, ${page.feeLines} fee lines found on candidate page`,
      verdict: "accepted_html",
      status: response.status,
      html: rawBody,
    };
  }
  if (looksLikeProductPage(candidate.url)) {
    return { ...rejected("product_page", `Candidate is an account or product page (${page.feeLines} fee lines, ${keywordMatches} fee keywords)`, response.status, candidate.score), html: rawBody };
  }
  return { ...rejected("too_few_fee_words", `${keywordMatches} fee keywords, ${page.feeLines} fee lines found on candidate page`, response.status, candidate.score), html: rawBody };
}

async function validatePdf(candidate: FeeCandidate, response: Response): Promise<CandidateValidation> {
  const label = candidate.reasons.join(", ") || "fee URL pattern";
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  const acceptUnread = (why: string): CandidateValidation =>
    candidate.score >= UNREADABLE_PDF_MIN_SCORE
      ? {
          ok: true,
          documentType: "pdf",
          confidence: Math.max(candidate.score, 0.8),
          reason: `PDF ${why}; accepted on its label (${label})`,
          verdict: "accepted_pdf_unreadable",
          status: response.status,
          html: null,
        }
      : rejected("unreadable_pdf_weak_label", `PDF ${why} and its label is too weak (${label})`, response.status, candidate.score);

  if (declaredLength > MAX_PDF_CHECK_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return acceptUnread("too large to check");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_CHECK_BYTES) return acceptUnread("too large to check");
  const magic = new TextDecoder().decode(bytes.slice(0, 1024));
  if (!magic.includes("%PDF")) {
    return rejected("not_a_pdf", "Candidate claims to be a PDF but is not one", response.status);
  }

  const text = await pdfCheckText(bytes);
  if (!text) return acceptUnread("has no readable text (likely a scan)");
  const page = scoreFeePage(text);
  if (page.verdict === "wrong_document") {
    return rejected("not_fee_page", `PDF is not a fee schedule (${page.reason})`, response.status, candidate.score);
  }
  if (page.verdict !== "fee_page" && page.rateTerms >= 4 && page.feeLines < 2) {
    return rejected("rate_page", `PDF is a rate sheet (${page.rateTerms} rate terms, ${page.feeLines} fee lines)`, response.status, candidate.score);
  }
  return {
    ok: true,
    documentType: "pdf",
    confidence: Math.max(candidate.score, page.verdict === "fee_page" ? 0.9 : 0.82),
    reason: `PDF lists ${page.feeLines} fee lines, ${page.dollarAmounts} dollar amounts (${label})`,
    verdict: "accepted_pdf",
    status: response.status,
    html: null,
  };
}
