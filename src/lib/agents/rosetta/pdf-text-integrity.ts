/**
 * A PDF can draw a readable glyph while its own ToUnicode CMap maps it to U+FFFD.
 * Once decoded, that character has lost its identity: it is not necessarily "ti".
 * Refuse damaged words/numbers before Knox sees them; never guess their spelling.
 * Standalone marks and dot leaders are outside this scoped semantic-loss check.
 */
export class PdfTextIntegrityError extends Error {
  constructor(readonly page: number | null = null) {
    super(`PDF text contains U+FFFD in a word or number${page == null ? "" : ` on page ${page}`}; full-page visual transcription required (the image-only scan reader cannot recover text-layer glyphs)`);
    this.name = "PdfTextIntegrityError";
  }
}

/** Unicode letters/numbers include accented names; whitespace and separators stay intact. */
export function assertPdfTextIntegrity(text: string, page: number | null = null): void {
  // The shared storage normalizer removes NULs; they must not hide adjacency here.
  if (/[\p{L}\p{N}]\uFFFD|\uFFFD[\p{L}\p{N}]/u.test(text.split("\u0000").join(""))) {
    throw new PdfTextIntegrityError(page);
  }
}
