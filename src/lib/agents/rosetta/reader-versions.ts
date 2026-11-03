/**
 * Rosetta's reader versions, in one module with no imports, so Bayes's manifests (#1120) can read
 * them without loading the PDF, OCR and fallback readers. Each module re-exports its own and keeps
 * the history of what each version changed:
 *   ROSETTA_READ_VERSION         read.ts (every primary reader)
 *   PDF_LAYOUT_VERSION           pdf-layout.ts
 *   ROSETTA_OCR_VERSION          ocr.ts
 *   ROSETTA_JS_FALLBACK_VERSION  js-fallback.ts
 *   HTML_READ_VERSION            html-dom.ts, html-row-pairing.ts, html-cell-list-pairing.ts (read.html_dom, read.js_fallback)
 *   PDF_READ_VERSION             pdf-layout.ts and pdf-text-direction.ts (read.pdf_layout), for replay
 *   ROSETTA_TABLE_ROWS_VERSION   table-rows.ts
 *   PDF_READER_AGREEMENT_VERSION pdf-reader-agreement.ts
 *   GLYPH_REPAIR_VERSION         glyph-repair.ts
 */
export const ROSETTA_READ_VERSION = 3;
export const PDF_LAYOUT_VERSION = 6;
/**
 * v6 (Mountain Star FCU fee 159428, Nov 2): side-by-side fee tables keep each cell in its own
 * table (pdf-layout.ts `tableCellColumns`). Reader replay (reader-replay.ts) reads once more every
 * current completed `read.pdf_layout` text that holds a cell break (" | ") and has no layout read
 * of its bytes at this version, once PDF_CELL_REPLAY_LIVE is on. A later layout bump replays
 * nothing unless this number moves with it.
 */
export const PDF_LAYOUT_REPLAY_VERSION = 6;
/** Existing prose rereads stay settled; the new detector has its own due witness. */
export const PDF_PROSE_REREAD_VERSION = 4;
export const PDF_STACKED_REPAIR_VERSION = 1;
/**
 * v3 (fix plan step 7, Oct 27): a page that reads poorly gets one more read from a cleaned copy
 * (upscaled, straightened, black on white; `cleanForOcr`). The bump replays free-OCR texts
 * through reader-replay.ts, which keeps a new text only when it is not worse.
 */
export const ROSETTA_OCR_VERSION = 3;
export const ROSETTA_JS_FALLBACK_VERSION = 3;
/**
 * The HTML readers' own version (#1092): what `read.html_dom` (and the JavaScript fallback, which
 * reads its rendered page through the same DOM reader) writes as text. Every read attempt whose
 * reader is one of HTML_READ_READERS records it as `detail.html_read`; an attempt without it (every
 * read before Nov 2) counts as HTML_READ_BASE_VERSION.
 *
 * Above its base, reader replay (reader-replay.ts) reads once more every current completed text an
 * HTML reader wrote with no read of its bytes at this version, and no other reader's text. At its
 * base the replay selection is exactly what it was before this version existed.
 *
 * Each HTML reader switch on adds one: `HTML_ROW_PAIRING_LIVE` (html-row-pairing.ts) and
 * `HTML_CELL_LIST_PAIRING_LIVE` (html-cell-list-pairing.ts). The PR that flips either must move this
 * up by one in the same change (reader-replay.test.ts fails otherwise), so turning a switch on
 * re-reads HTML pages and no PDF. Kept as a literal so this module stays free of imports.
 */
export const HTML_READ_BASE_VERSION: number = 1;
export const HTML_READ_VERSION: number = 1;
/** Readers whose text HTML_READ_VERSION versions. Equal to read.ts's HTML reader and JS_FALLBACK_STRATEGY. */
export const HTML_READ_READERS: readonly string[] = ["read.html_dom", "read.js_fallback"];
/**
 * The PDF reader's replay version (#1092), the PDF twin of HTML_READ_VERSION: every read attempt
 * whose reader is one of PDF_READ_READERS records it as `detail.pdf_read`; an attempt without it
 * (every read before Nov 3) counts as PDF_READ_BASE_VERSION. PDF_LAYOUT_VERSION still records which
 * layout rules wrote a text; it replays only texts with a cell break (PDF_CELL_REPLAY_LIVE), so a
 * change that can alter any PDF text needs this version instead.
 *
 * Above its base, reader replay (reader-replay.ts) reads once more every current completed text a
 * PDF reader wrote with no read of its bytes at this version, and no other reader's text. At its
 * base the replay selection is exactly what it was before this version existed.
 *
 * v2 is `PDF_TEXT_DIRECTION_LIVE` (pdf-text-direction.ts): flipping that switch must move this to 2
 * in the same PR (reader-replay.test.ts fails otherwise), so turning sideways pages upright re-reads
 * PDFs and no HTML page. Kept as a literal so this module stays free of imports.
 */
export const PDF_READ_BASE_VERSION: number = 1;
export const PDF_READ_VERSION: number = 1;
/** Readers whose text PDF_READ_VERSION versions: read.ts's PDF reader. */
export const PDF_READ_READERS: readonly string[] = ["read.pdf_layout"];
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
