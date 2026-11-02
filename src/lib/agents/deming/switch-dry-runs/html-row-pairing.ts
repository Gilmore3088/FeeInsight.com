import type { HtmlReaderExposureRow } from "./types";

/**
 * `HTML_ROW_PAIRING_LIVE` (#1092, rosetta/html-row-pairing.ts): the exposure of a flip, counted from
 * the database alone. The audit cannot say how many stored texts would change, because the HTML
 * bytes are in the document vault and the audit reads only the database; the shadow lab's source
 * replay measures the change on the answer-key documents' own bytes instead. Pure.
 */

export interface HtmlReaderExposure {
  reader: string;
  documents: number;
  institutions: number;
  documentsWithLiveFees: number;
  liveFees: number;
}

export interface HtmlRowPairingSummary {
  /** Current documents whose newest text the static HTML reader or the JavaScript fallback wrote. */
  html: { documents: number; documentsWithLiveFees: number; liveFees: number };
  /** Legacy texts (no reader recorded): some may be HTML; the format is not stored with them. */
  legacy: { documents: number; documentsWithLiveFees: number; liveFees: number };
  byReader: HtmlReaderExposure[];
  /** Always false: the audit has no bytes, so it never counts changed texts. */
  textDiffed: false;
}

export function summarizeHtmlExposure(rows: readonly HtmlReaderExposureRow[]): HtmlRowPairingSummary {
  const byReader = rows.map((row) => ({
    reader: row.reader,
    documents: Number(row.documents),
    institutions: Number(row.institutions),
    documentsWithLiveFees: Number(row.documents_with_live_fees),
    liveFees: Number(row.live_fees),
  }));
  const add = (list: HtmlReaderExposure[]) => ({
    documents: list.reduce((sum, row) => sum + row.documents, 0),
    documentsWithLiveFees: list.reduce((sum, row) => sum + row.documentsWithLiveFees, 0),
    liveFees: list.reduce((sum, row) => sum + row.liveFees, 0),
  });
  return {
    html: add(byReader.filter((row) => row.reader !== "legacy")),
    legacy: add(byReader.filter((row) => row.reader === "legacy")),
    byReader,
    textDiffed: false,
  };
}
