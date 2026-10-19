import { strToU8, zipSync } from "fflate";

/**
 * Test samples of the World Bank Remittance Prices Worldwide (RPW) workbook. Not imported by app
 * code.
 *
 * The real file (rpw_dataset_2011_2025_q1.xlsx, linked from remittanceprices.worldbank.org/
 * data-download) could not be downloaded from the container this was written in: the World Bank
 * hosts refuse the egress proxy. The layout here is the documented one, from open-source code
 * that reads the workbook: two data sheets, "Dataset (up to Q1 2016)" (product column "product")
 * and "Dataset (from Q2 2016)" (product column "payment instrument"), a header in the first row
 * with lower-case names (period, source_name, destination_name, firm, firm_type, cc1 lcu amount,
 * cc1 lcu fee, cc1 fx margin, cc1 total cost %), plus columns the loader does not read. A notes
 * sheet comes first. Firms and values are illustrative.
 */

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** An xlsx with one worksheet per entry, shared strings for text and plain <v> for numbers. */
export function rpwWorkbook(sheets: string[][][]): Uint8Array {
  const shared: string[] = [];
  const idx = (s: string) => (shared.includes(s) ? shared.indexOf(s) : shared.push(s) - 1);
  const cell = (v: string, r: number, c: number) =>
    v === ""
      ? ""
      : /^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(v)
        ? `<c r="${colName(c)}${r}"><v>${v}</v></c>`
        : `<c r="${colName(c)}${r}" t="s"><v>${idx(v)}</v></c>`;
  const files: Record<string, Uint8Array> = { "xl/workbook.xml": strToU8("<workbook/>") };
  sheets.forEach((rows, n) => {
    const xml = `<?xml version="1.0"?><worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, i + 1, j)).join("")}</row>`).join("")}</sheetData></worksheet>`;
    files[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(xml);
  });
  files["xl/sharedStrings.xml"] = strToU8(`<sst>${shared.map((s) => `<si><t>${s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></si>`).join("")}</sst>`);
  return zipSync(files);
}

const COMMON = ["id", "period", "corridor", "source_code", "source_name", "destination_code", "destination_name", "firm", "firm_type"];
const COSTS = ["speed actual", "cc1 lcu code", "cc1 lcu amount", "cc1 lcu fee", "cc1 fx margin", "cc1 total cost %", "transparent", "date"];

export const RPW_NOTES_SHEET = [["Remittance Prices Worldwide"], ["Notes: see methodology"]];

export const RPW_OLD_SHEET = [
  [...COMMON, "product", ...COSTS],
  ["1", "2011_1Q", "USAMEX", "USA", "United States", "MEX", "Mexico", "Old Bank", "Bank", "Account transfer", "1 day", "USD", "200", "12", "1.1", "7.1", "yes", "2011-03-01"],
];

export const RPW_NEW_SHEET = [
  [...COMMON, "payment instrument", ...COSTS],
  ["2", "2025_1Q", "USAMEX", "USA", "United States", "MEX", "Mexico", "Acme Bank", "Bank", "Cash", "Same day", "USD", "200", "5", "1.5", "4.2", "yes", "2025-02-01"],
  ["3", "2025_1Q", "USAMEX", "USA", "United States", "MEX", "Mexico", "Acme Bank", "Bank", "Account", "Same day", "USD", "200", "3", "5.0000000000000001E-2", "1.55", "yes", "2025-02-01"],
  ["4", "2025_1Q", "ESPMAR", "ESP", "Spain", "MAR", "Morocco", "X Money", "MTO", "Cash", "1 hour", "EUR", "140", "3", "1", "4", "yes", "2025-02-01"],
];

export const RPW_DATA_PAGE_HTML = `<html><body>
<p>The full dataset is available to <a href="/sites/default/files/rpw_dataset_2011_2024_q4.xlsx">download in MS Excel format (older)</a>.</p>
<p>The full dataset is available to <a href="https://remittanceprices.worldbank.org/sites/default/files/rpw_dataset_2011_2025_q1.xlsx">download in MS Excel format</a>.</p>
<p><a href="/sites/default/files/rpw_main_report_and_annex_q424_13.pdf">Report</a></p>
</body></html>`;
