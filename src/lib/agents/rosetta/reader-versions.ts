/**
 * Rosetta's reader versions, in one module with no imports, so Bayes's manifests (#1120) can read
 * them without loading the PDF, OCR and fallback readers. Each module re-exports its own and keeps
 * the history of what each version changed:
 *   ROSETTA_READ_VERSION         read.ts (every primary reader)
 *   PDF_LAYOUT_VERSION           pdf-layout.ts
 *   ROSETTA_OCR_VERSION          ocr.ts
 *   ROSETTA_JS_FALLBACK_VERSION  js-fallback.ts
 *   ROSETTA_TABLE_ROWS_VERSION   table-rows.ts
 *   PDF_READER_AGREEMENT_VERSION pdf-reader-agreement.ts
 */
export const ROSETTA_READ_VERSION = 3;
export const PDF_LAYOUT_VERSION = 5;
/** Existing prose rereads stay settled; the new detector has its own due witness. */
export const PDF_PROSE_REREAD_VERSION = 4;
export const PDF_STACKED_REPAIR_VERSION = 1;
export const ROSETTA_OCR_VERSION = 2;
export const ROSETTA_JS_FALLBACK_VERSION = 3;
export const ROSETTA_TABLE_ROWS_VERSION = 1;
export const PDF_READER_AGREEMENT_VERSION = 1;
