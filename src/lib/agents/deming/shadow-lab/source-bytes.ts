import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { detectFormat, isLikelyScannedPdf } from "@/lib/agents/learning/format";
import { decodeTextBytes, expandUnicodeLigatures } from "@/lib/agents/rosetta/glyph-repair";
import { extractHtmlDomText, headingContextSpans } from "@/lib/agents/rosetta/html-dom";
import { appendHeadingContext } from "@/lib/heading-context-trailer";
import { looksLikeJsShell } from "@/lib/agents/rosetta/js-fallback";
import { extractPdfDocumentText } from "@/lib/agents/rosetta/pdf-document-text";
import { normalizeWhitespace } from "@/lib/agents/rosetta/read";

/**
 * Source bytes for the answer-key holdout documents (#1092): the bank's own public document,
 * fetched once and committed gzipped, so the lab can read it again with today's Rosetta readers
 * instead of only replaying the text Rosetta stored when the key was made.
 *
 * A fetched document counts only when it is the same document the key was made from: its re-read
 * must match the frozen text on normalised tokens (`sameDocument`). Anything else is listed in the
 * manifest's `rejected`, never substituted.
 */

export const SOURCE_BYTES_DIR = "src/lib/agents/deming/__fixtures__/source-bytes";
export const SOURCE_BYTES_MANIFEST = `${SOURCE_BYTES_DIR}/manifest.json`;

/** Dice similarity over all normalised tokens, re-read against frozen text. */
export const MIN_TOKEN_SIMILARITY = 0.9;
/** Dice similarity over number tokens alone: a changed price must not pass on its words. */
export const MIN_NUMBER_SIMILARITY = 0.95;
// And the dollar amounts must be the same list (`dollarsEqual`): one changed fee rejects the document.

export type SourceRead =
  | { ok: true; text: string; reader: "read.pdf_layout" | "read.html_dom" | "read.plain_text" }
  | { ok: false; reason: string };

export interface SourceReadOptions {
  /** `HTML_ROW_PAIRING_LIVE` held on or off for this read (rosetta/html-row-pairing.ts). */
  htmlRowPairing?: boolean;
  /** `HTML_HEADING_CONTEXT_LIVE` held on or off: the heading-context trailer (rosetta/html-heading-scope.ts). */
  htmlHeadingContext?: boolean;
}

/**
 * Rosetta's primary read of a document's bytes, as `readCandidate` in rosetta/read.ts does it,
 * without the parts that need a network or a database: the JavaScript fallback, free OCR and the
 * playbook's reader escalation. A page that needs any of those is refused, not read another way.
 * `options` holds a reader switch on or off (an experiment); unset keeps each reader's code value.
 */
export async function readSourceBytes(
  bytes: Uint8Array,
  contentType: string | null,
  url: string | null,
  options: SourceReadOptions = {},
): Promise<SourceRead> {
  const format = detectFormat(bytes, contentType, url);
  if (format === "pdf") {
    const extracted = await extractPdfDocumentText(bytes);
    const text = normalizeWhitespace(extracted.text);
    if (text.length === 0 || isLikelyScannedPdf(text, extracted.totalPages)) return { ok: false, reason: "scanned PDF: needs OCR" };
    return { ok: true, text, reader: "read.pdf_layout" };
  }
  if (format !== "html" && format !== "text") return { ok: false, reason: `no offline reader for ${format}` };
  const raw = expandUnicodeLigatures(decodeTextBytes(bytes, contentType));
  if (format === "text") return { ok: true, text: normalizeWhitespace(raw), reader: "read.plain_text" };
  const extracted = extractHtmlDomText(raw, { rowPairing: options.htmlRowPairing, headingContext: options.htmlHeadingContext });
  const text = normalizeWhitespace(extracted.text);
  if (text.length === 0 || looksLikeJsShell(raw, text)) return { ok: false, reason: "page built by JavaScript: needs the fallback" };
  // As rosetta/read.ts stores it: the trailer goes after the text, which is unchanged.
  return { ok: true, text: appendHeadingContext(text, headingContextSpans(extracted, text, normalizeWhitespace)), reader: "read.html_dom" };
}

/** Lower-case word and number tokens; layout, punctuation and separators are set aside. */
export function normalisedTokens(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .replace(/[­​-‍⁠﻿]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+(?:[.,][0-9]+)*/g) ?? []
  );
}

function counts(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1);
  return map;
}

/** Multiset Dice coefficient: 2 x shared tokens / (tokens in a + tokens in b); 1 when both are empty. */
export function diceSimilarity(a: string[], b: string[]): number {
  if (a.length + b.length === 0) return 1;
  const left = counts(a);
  let shared = 0;
  for (const [token, n] of counts(b)) shared += Math.min(n, left.get(token) ?? 0);
  return (2 * shared) / (a.length + b.length);
}

const isNumber = (token: string) => /^[0-9]/.test(token);

export interface Similarity {
  tokens: number;
  numbers: number;
  /** Every dollar amount the frozen text prints, as often, and no other. */
  dollarsEqual: boolean;
}

/** The dollar amounts a text prints ("$ 1,000.00" as "$1000.00"), sorted. */
export function dollarAmounts(text: string): string[] {
  return (text.match(/\$ ?[0-9][0-9,]*(?:\.[0-9]+)?/g) ?? []).map((amount) => amount.replace(/[ ,]/g, "")).sort();
}

/** The scores, rounded to four places so the manifest can record them exactly. */
export function similarity(frozen: string, reread: string): Similarity {
  const a = normalisedTokens(frozen);
  const b = normalisedTokens(reread);
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return {
    tokens: round(diceSimilarity(a, b)),
    numbers: round(diceSimilarity(a.filter(isNumber), b.filter(isNumber))),
    dollarsEqual: dollarAmounts(frozen).join(" ") === dollarAmounts(reread).join(" "),
  };
}

export function sameDocument(score: Similarity): boolean {
  return score.tokens >= MIN_TOKEN_SIMILARITY && score.numbers >= MIN_NUMBER_SIMILARITY && score.dollarsEqual;
}

export interface AcceptedSource {
  caseKey: string;
  institution: string;
  file: string;
  sha256: string;
  bytes: number;
  sourceUrl: string;
  finalUrl: string;
  urlFrom: string;
  contentType: string | null;
  fetchedAt: string;
  fetchedWith: "http" | "chromium";
  reader: string;
  similarity: Similarity;
  /** What differs from the frozen text when the document passed but is not identical (a printed date, a revision). */
  note?: string;
}

/**
 * A fetched copy that is not the frozen document. A case can have a rejected copy and an
 * accepted one (Summit: the November schedule the seed link now redirects to, and the October one).
 */
export interface RejectedSource {
  caseKey: string;
  institution: string;
  sourceUrl: string | null;
  finalUrl?: string;
  reason: string;
  similarity: Similarity | null;
}

export interface SourceBytesManifest {
  thresholds: { tokens: number; numbers: number; dollarsEqual: true };
  thresholdsNote: string;
  holdoutDocuments: number;
  /** How the bytes were fetched: the HTTP request and the Chromium settings, as recorded. */
  fetch: Record<"http" | "chromium", Record<string, unknown>>;
  accepted: AcceptedSource[];
  rejected: RejectedSource[];
  /** Holdout documents not fetched, each with why (a key marked as not a fee schedule). */
  notFetched: Array<{ caseKey: string; institution: string; reason: string }>;
}

export function readSourceManifest(root: string = process.cwd()): SourceBytesManifest {
  return JSON.parse(readFileSync(join(root, SOURCE_BYTES_MANIFEST), "utf8")) as SourceBytesManifest;
}

/** A fixture's bytes, refused when they are not the bytes the manifest names. */
export function loadSourceBytes(entry: AcceptedSource, root: string = process.cwd()): Uint8Array {
  const bytes = new Uint8Array(gunzipSync(readFileSync(join(root, SOURCE_BYTES_DIR, entry.file))));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== entry.sha256) throw new Error(`source bytes for ${entry.caseKey} do not match the manifest's sha256`);
  return bytes;
}

/** Every accepted document read again through today's readers, by case key. */
export async function rereadAcceptedSources(
  root: string = process.cwd(),
  options: SourceReadOptions = {},
): Promise<Map<string, SourceRead>> {
  const manifest = readSourceManifest(root);
  const out = new Map<string, SourceRead>();
  for (const entry of manifest.accepted) {
    out.set(entry.caseKey, await readSourceBytes(loadSourceBytes(entry, root), entry.contentType, entry.finalUrl, options));
  }
  return out;
}
