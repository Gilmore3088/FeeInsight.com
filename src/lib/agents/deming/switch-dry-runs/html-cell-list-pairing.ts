import type { HtmlRowPairingSummary } from "./html-row-pairing";
import type { HtmlCellListExposureRow } from "./types";

/**
 * `HTML_CELL_LIST_PAIRING_LIVE` (#1092, rosetta/html-cell-list-pairing.ts): the exposure of a flip,
 * counted from the database alone. The flip bumps `HTML_READ_VERSION`, so every current HTML-read
 * text (section 8's count) is re-read once; only a table row whose two cells list the same number
 * of items can change. The stored table rows keep cell text, not list markup, so the audit counts
 * the rows in the one-line shape of such a row (a label cell with no dollar amount beside a price
 * cell with two or more) as the reach, and never says which would split. The shadow lab measures
 * the change on the answer-key documents' bytes and on St. Cloud's archived page. Pure.
 */

export interface HtmlCellListPairingSummary {
  /** Current documents whose newest text an HTML reader wrote: what the version bump re-reads. */
  html: HtmlRowPairingSummary["html"];
  /** Of those, the documents with a stored row in the switch's one-line shape. */
  shaped: { documents: number; institutions: number; rows: number; documentsWithLiveFees: number; liveFees: number };
  /** Always false: the audit has no bytes, so it never counts changed texts. */
  textDiffed: false;
}

export function summarizeHtmlCellListExposure(
  html: HtmlRowPairingSummary["html"],
  rows: readonly HtmlCellListExposureRow[],
): HtmlCellListPairingSummary {
  const row = rows[0];
  const n = (value: number | string | undefined) => Number(value ?? 0);
  return {
    html,
    shaped: {
      documents: n(row?.documents),
      institutions: n(row?.institutions),
      rows: n(row?.rows),
      documentsWithLiveFees: n(row?.documents_with_live_fees),
      liveFees: n(row?.live_fees),
    },
    textDiffed: false,
  };
}
