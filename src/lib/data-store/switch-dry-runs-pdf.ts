/**
 * `PDF_COLUMN_READING_LIVE` (#1092) dry-run read: current documents, and the live fees on them,
 * whose newest stored text a reader that lays text out through `pdf-layout.ts` wrote. It runs
 * `HTML_READER_EXPOSURE_SQL` (the statement takes the reader names as `$2`) with these readers.
 * Database-only: the PDF bytes are in the document vault, so the count is the exposure, an upper
 * bound on the documents whose text the switch could change.
 */

/** The PDF layout reader and free OCR, whose recognised words `layoutOcrWords` lays out the same way. */
export const PDF_LAYOUT_READERS = ["read.pdf_layout", "read.ocr_tesseract"];
