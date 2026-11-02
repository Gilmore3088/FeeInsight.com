import type { sql } from "@/lib/data-store/connection";

/**
 * Where each page of a PDF starts in Rosetta's stored text (`agent_source_texts.page_starts`).
 *
 * The stored text joins a PDF's pages with a blank line ("\n\n", `pdf-document-text.ts`, `ocr.ts`)
 * and keeps no page break, so a citation can name a page only when the reader records where each
 * page starts. `pageStarts[i]` is the code-point offset (an `Array.from` index, the unit
 * `foldSourceText` and `locateFeeInText` count in) where page i + 1 starts: page 1 at 0, strictly
 * increasing.
 *
 * Offsets are recorded only when they are certain: every page of the document has its own text, no
 * page is empty (an empty page cannot be given a start of its own that is strictly increasing), and
 * the normalized pages joined by a blank line are exactly the stored text. Anything else records
 * nothing (null): a wrong page is never acceptable, no page is. The offsets are pure; only
 * `pageStartsColumnReady` reads the database (the column arrives with #2929).
 */

type SqlTag = typeof sql;

/** The separator both PDF readers put between pages. */
export const PDF_PAGE_JOIN = "\n\n";

export function pdfPageStarts(normalizedText: string, pageTexts: readonly string[], totalPages: number): number[] | null {
  if (!Number.isSafeInteger(totalPages) || totalPages < 1) return null;
  if (pageTexts.length !== totalPages) return null;
  if (pageTexts.some((page) => page.length === 0)) return null;
  if (pageTexts.join(PDF_PAGE_JOIN) !== normalizedText) return null;
  const joinLength = Array.from(PDF_PAGE_JOIN).length;
  const starts: number[] = [];
  let offset = 0;
  for (const page of pageTexts) {
    starts.push(offset);
    offset += Array.from(page).length + joinLength;
  }
  return starts;
}

/**
 * True when `pageStarts` can describe `normalizedText`: page 1 at 0, strictly increasing whole
 * numbers, every page starting inside the text. The writer checks this before storing, so a row
 * never holds page starts that run past its own text.
 */
export function pageStartsFitText(normalizedText: string | null, pageStarts: readonly number[] | null | undefined): pageStarts is readonly number[] {
  if (!normalizedText || !pageStarts || pageStarts.length === 0 || pageStarts[0] !== 0) return false;
  if (!pageStarts.every(Number.isSafeInteger)) return false;
  for (let i = 1; i < pageStarts.length; i += 1) if (!(pageStarts[i] > pageStarts[i - 1])) return false;
  return pageStarts[pageStarts.length - 1] < Array.from(normalizedText).length;
}

const columnReadyCache = new WeakMap<object, boolean>();

/**
 * True once `agent_source_texts.page_starts` exists (#2929). Before that, Rosetta records no page
 * starts and readers select NULL; only a positive answer is cached (like `documentKindColumnsReady`).
 */
export async function pageStartsColumnReady(db: SqlTag): Promise<boolean> {
  if (columnReadyCache.get(db)) return true;
  const [row] = await db`
    SELECT COUNT(*) = 1 AS page_starts_column_ready
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'agent_source_texts'
       AND column_name = 'page_starts'
  `;
  const ready = row?.page_starts_column_ready === true;
  if (ready) columnReadyCache.set(db, true);
  return ready;
}
