import type { PdfReaderExposureRow } from "./types";

/**
 * `PDF_TEXT_DIRECTION_LIVE` (#1092, rosetta/pdf-text-direction.ts): the exposure of a flip, counted
 * from the database alone. The audit cannot re-read a PDF (the bytes are in the document vault),
 * so it counts the current PDF texts the flip's version bump re-reads, and the documents a read
 * since Nov 3 found sideways pages in. The shadow lab's source replay measures the change on the
 * answer-key documents' own bytes instead. Pure.
 */

export interface PdfTextDirectionSummary {
  /** Current documents whose newest text the PDF reader wrote: what the PDF_READ_VERSION bump re-reads. */
  pdf: { documents: number; institutions: number; documentsWithLiveFees: number; liveFees: number };
  /** Of those, how many have a read of their bytes that records the text direction, and how many it found sideways. */
  directionKnown: number;
  sideways: { documents: number; liveFees: number };
  /** Always false: the audit has no bytes, so it never counts changed texts. */
  textDiffed: false;
}

export function summarizePdfExposure(rows: readonly PdfReaderExposureRow[]): PdfTextDirectionSummary {
  const row = rows[0];
  const n = (value: number | string | undefined) => Number(value ?? 0);
  return {
    pdf: {
      documents: n(row?.documents),
      institutions: n(row?.institutions),
      documentsWithLiveFees: n(row?.documents_with_live_fees),
      liveFees: n(row?.live_fees),
    },
    directionKnown: n(row?.direction_known),
    sideways: { documents: n(row?.sideways), liveFees: n(row?.sideways_live_fees) },
    textDiffed: false,
  };
}
