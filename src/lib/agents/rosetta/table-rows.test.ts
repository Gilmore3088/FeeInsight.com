import { describe, expect, it } from "vitest";

import { extractHtmlDomText } from "./html-dom";
import { rowsInText, tableRowsFromText, tableRowsPayload } from "./table-rows";

describe("Rosetta table rows", () => {
  it("keeps HTML table cells, header rows and definition-list pairs as structured rows", () => {
    const html = `
      <table>
        <thead><tr><th>Service</th><th>Fee</th></tr></thead>
        <tbody>
          <tr><td>Overdraft fee</td><td></td><td>$35.00</td></tr>
          <tr><td>Stop payment</td><td>$30.00</td></tr>
        </tbody>
      </table>
      <dl><dt>Wire, outgoing</dt><dd>$25.00</dd></dl>`;
    const { rows, text } = extractHtmlDomText(html);
    expect(rows).toEqual([
      { table: 0, page: null, cells: ["Service", "Fee"], header: true, origin: "html_table" },
      { table: 0, page: null, cells: ["Overdraft fee", "$35.00"], header: false, origin: "html_table" },
      { table: 0, page: null, cells: ["Stop payment", "$30.00"], header: false, origin: "html_table" },
      { table: 1, page: null, cells: ["Wire, outgoing", "$25.00"], header: false, origin: "html_definition_list" },
    ]);
    // Every row is a line of the text, so Knox can trace it back.
    const normalized = text.split("\n").map((line) => line.trim()).join("\n");
    expect(rowsInText(rows, normalized)).toHaveLength(4);
  });

  it("reads rows from laid-out text, one table per run of row lines, with page numbers", () => {
    const rows = tableRowsFromText(
      ["Schedule of Fees\nOverdraft | $35.00\nNSF | $35.00\nNotes follow\nWire | $25.00", "Cashier's check | $10.00"],
      "pdf_layout",
    );
    expect(rows.map((row) => [row.table, row.page, row.cells])).toEqual([
      [0, 1, ["Overdraft", "$35.00"]],
      [0, 1, ["NSF", "$35.00"]],
      [1, 1, ["Wire", "$25.00"]],
      [2, 2, ["Cashier's check", "$10.00"]],
    ]);
    expect(tableRowsFromText("No tables here", "ocr_layout")).toEqual([]);
  });

  it("stores nothing when a document has no rows", () => {
    expect(tableRowsPayload([])).toBeNull();
    expect(tableRowsPayload(tableRowsFromText("A | $1.00", "paid_transcription"))).toEqual({
      version: 1,
      rows: [{ table: 0, page: null, cells: ["A", "$1.00"], header: false, origin: "paid_transcription" }],
    });
  });
});
