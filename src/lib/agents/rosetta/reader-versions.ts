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
 *   GLYPH_REPAIR_VERSION         glyph-repair.ts
 */
export const ROSETTA_READ_VERSION = 3;
export const PDF_LAYOUT_VERSION = 5;
/** Existing prose rereads stay settled; the new detector has its own due witness. */
export const PDF_PROSE_REREAD_VERSION = 4;
export const PDF_STACKED_REPAIR_VERSION = 1;
export const ROSETTA_OCR_VERSION = 2;
export const ROSETTA_JS_FALLBACK_VERSION = 3;
/**
 * v2 (#1912): HTML table rows keep each cell's grid column (`columns`, `line`; table-rows.ts).
 * Nothing selects a stored text by this version, so the bump re-reads nothing: a page's new
 * rows arrive on its next ordinary read.
 */
export const ROSETTA_TABLE_ROWS_VERSION = 2;
export const PDF_READER_AGREEMENT_VERSION = 1;
/** Record-only layout recheck receipts (#2219, layout-recheck.ts); never reopens a document. */
export const LAYOUT_RECHECK_VERSION = 1;
/**
 * Unknown glyphs restored where unambiguous, and non-UTF-8 pages decoded in their own charset
 * (#2598, glyph-repair.ts). A completed text still carrying U+FFFD or a U+FB00-U+FB06 ligature
 * is read once more at each bump; nothing else is reopened. Oct 26 (#1513): dropped-ligature
 * repair (PDF texts with a broken fee word are due too) joined v1 without a bump. A text is
 * settled at v1 by any read attempt on its current hash with `detail.glyph_repair` >= 1, and
 * every glyph-repair reader's read since Oct 25 records that, so a PDF read after Oct 25 would
 * count as settled without this repair. Skipping the bump is safe only because, checked on prod on
 * Oct 26, none of the 8 PDF texts the new test selects has such an attempt or a lane receipt on
 * its current hash. A PDF read between Oct 25 and this change's deploy would need a bump.
 */
export const GLYPH_REPAIR_VERSION = 1;
