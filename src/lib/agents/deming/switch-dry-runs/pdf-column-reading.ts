import { summarizeHtmlExposure, type HtmlReaderExposure } from "./html-row-pairing";
import type { HtmlReaderExposureRow } from "./types";

/**
 * `PDF_COLUMN_READING_LIVE` (#1092, rosetta/pdf-columns.ts): the exposure of a flip, counted from
 * the database alone, as `HTML_ROW_PAIRING_LIVE`'s is. The audit cannot say how many stored texts
 * would change: the PDF bytes are in the document vault and the audit reads only the database.
 * The shadow lab's source replay measures the change on the answer-key documents' own bytes. Pure.
 */

export interface PdfColumnReadingSummary {
  /** Current documents whose newest text the PDF layout reader or free OCR (which lays words out the same way) wrote. */
  pdf: { documents: number; documentsWithLiveFees: number; liveFees: number };
  /** Legacy texts (no reader recorded): some may be PDFs; the format is not stored with them. */
  legacy: { documents: number; documentsWithLiveFees: number; liveFees: number };
  byReader: HtmlReaderExposure[];
  /** Always false: the audit has no bytes, so it never counts changed texts. */
  textDiffed: false;
}

export function summarizePdfExposure(rows: readonly HtmlReaderExposureRow[]): PdfColumnReadingSummary {
  const { html, legacy, byReader } = summarizeHtmlExposure(rows);
  return { pdf: html, legacy, byReader, textDiffed: false };
}
