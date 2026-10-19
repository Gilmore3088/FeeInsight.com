/** Private financial tables: bounded CSV/XLSX, with cached formula values only. */
import {
  MAX_CELL_CHARS, MAX_COLUMNS, MAX_ROWS, MAX_SHARED_CHARS, MAX_SHARED_STRINGS,
  MAX_TABLE_CELLS, MAX_TABLE_CHARS, MAX_UPLOAD_BYTES, invalidFile, tableLimit, workbookLimit,
} from "./limits";
import { readXml } from "./xml";
import { decodeUtf8, openWorkbook } from "./zip";

export { MAX_UPLOAD_BYTES, MAX_ROWS } from "./limits";
export type Table = string[][];

class TableBudget {
  private rows = 0;
  private cells = 0;
  private chars = 0;
  row(): void {
    if (++this.rows > MAX_ROWS) tableLimit("The table has more than 5,000 rows, including its header.");
  }
  width(width: number, added: number): void {
    if (width > MAX_COLUMNS) tableLimit("The table has more than 128 columns.");
    if ((this.cells += added) > MAX_TABLE_CELLS) tableLimit("The table has more than 100,000 cells, including empty cells.");
  }
  value(value: string): string {
    if (value.length > MAX_CELL_CHARS) tableLimit("A cell has more than 16,384 characters.");
    if ((this.chars += value.length) > MAX_TABLE_CHARS) tableLimit("The table contains more than 2,000,000 characters.");
    return value.trim();
  }
}

function appendText(previous: string, text: string): string {
  if (previous.length + text.length > MAX_CELL_CHARS) tableLimit("A cell has more than 16,384 characters.");
  return previous + text;
}

/** RFC 4180 quoting; every record is checked, never a truncated financial preview. */
export function parseCsv(text: string): Table {
  if (text.length > MAX_UPLOAD_BYTES || Buffer.byteLength(text, "utf8") > MAX_UPLOAD_BYTES) tableLimit("The file is over 2 MB.");
  const rows: Table = [];
  const budget = new TableBudget();
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let recordStarted = false;
  const src = text.replace(/^\uFEFF/, "");
  const cell = () => {
    budget.width(row.length + 1, 1);
    row.push(budget.value(field));
    field = "";
    afterQuote = false;
  };
  const record = () => {
    budget.row();
    cell();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
    recordStarted = false;
  };
  for (let index = 0; index < src.length; index++) {
    const character = src[index];
    if (character === "\0") invalidFile();
    recordStarted = true;
    if (quoted) {
      if (character === '"' && src[index + 1] === '"') { field = appendText(field, '"'); index++; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else field = appendText(field, character);
    } else if (character === ",") cell();
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && src[index + 1] === "\n") index++;
      record();
    } else if (character === '"' && field === "" && !afterQuote) quoted = true;
    else {
      if (afterQuote || character === '"') invalidFile();
      field = appendText(field, character);
    }
  }
  if (quoted) invalidFile();
  if (recordStarted) record();
  return rows;
}

function sharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let value: string | null = null;
  let chars = 0;
  readXml(xml, "sst", {
    open(name, _attrs, parent) {
      if (name === "si") {
        if (parent !== "sst" || value !== null) invalidFile();
        if (strings.length >= MAX_SHARED_STRINGS) workbookLimit("up to 20,000 shared text values are accepted.");
        value = "";
      }
    },
    text(text, path) {
      // Include rich-text runs, excluding phonetic annotations (rPh).
      if (value !== null && path.at(-1) === "t" && !path.includes("rPh")) {
        if ((chars += text.length) > MAX_SHARED_CHARS) workbookLimit("shared text must total 1,000,000 characters or less.");
        value = appendText(value, text);
      }
    },
    close(name) { if (name === "si") { if (value === null) invalidFile(); strings.push(value); value = null; } },
  });
  return strings;
}

function positiveIndex(text: string): number {
  if (!/^[1-9]\d{0,7}$/.test(text)) invalidFile();
  return Number(text);
}

function columnIndex(ref: string, row: number): number {
  const match = /^([A-Z]+)([1-9]\d{0,7})$/.exec(ref);
  if (!match || Number(match[2]) !== row) invalidFile();
  let column = 0;
  for (const letter of match[1]) {
    column = column * 26 + letter.charCodeAt(0) - 64;
    if (column > MAX_COLUMNS) tableLimit("The table has more than 128 columns.");
  }
  return column - 1;
}

function worksheet(xml: string, strings: string[]): Table {
  const budget = new TableBudget();
  const rows: Table = [];
  let row: string[] | null = null;
  let rowNumber = 0;
  let sheetDataSeen = false;
  let cell: { index: number; type: string; value: string; inline: string; cached: boolean } | null = null;
  readXml(xml, "worksheet", {
    open(name, attrs, parent) {
      if (parent === "v" || parent === "t") invalidFile();
      if (name === "sheetData") { if (parent !== "worksheet" || sheetDataSeen) invalidFile(); sheetDataSeen = true; }
      if (name === "row") {
        if (parent !== "sheetData" || row !== null) invalidFile();
        const nextRow = attrs.r === undefined ? rowNumber + 1 : positiveIndex(attrs.r);
        if (nextRow <= rowNumber) invalidFile();
        if (nextRow > MAX_ROWS) tableLimit("The table has a row beyond row 5,000, including its header.");
        budget.row();
        rowNumber = nextRow;
        row = [];
      }
      if (name === "c") {
        if (parent !== "row" || row === null || cell !== null) invalidFile();
        const index = attrs.r === undefined ? row.length : columnIndex(attrs.r, rowNumber);
        if (index < row.length) invalidFile();
        // Budget sparse holes BEFORE creating any of those array slots.
        budget.width(index + 1, index + 1 - row.length);
        cell = { index, type: attrs.t ?? "n", value: "", inline: "", cached: false };
      }
      if (name === "v") {
        if (parent !== "c" || cell === null || cell.cached) invalidFile();
        cell.cached = true;
      }
    },
    text(text, path) {
      if (!cell) return;
      if (path.at(-1) === "v") cell.value = appendText(cell.value, text);
      else if (cell.type === "inlineStr" && path.at(-1) === "t" && path.includes("is") && !path.includes("rPh")) cell.inline = appendText(cell.inline, text);
    },
    close(name) {
      if (name === "c") {
        if (row === null || cell === null) invalidFile();
        let value = cell.type === "inlineStr" ? cell.inline : cell.value;
        if (cell.type === "s" && cell.cached) {
          const reference = cell.value.trim();
          if (!/^(0|[1-9]\d*)$/.test(reference) || Number(reference) >= strings.length) invalidFile();
          value = strings[Number(reference)];
        }
        value = budget.value(value);
        while (row.length < cell.index) row.push("");
        row.push(value);
        cell = null;
      }
      if (name === "row") {
        if (row === null || cell !== null) invalidFile();
        if (row.some((value) => value !== "")) rows.push(row);
        row = null;
      }
    },
  });
  if (!sheetDataSeen) invalidFile();
  return rows;
}

/** All ZIP metadata is checked before any selected XML part is expanded. */
export function readXlsx(buf: Buffer): Table {
  const workbook = openWorkbook(buf);
  const stringsEntry = workbook.entries.get("xl/sharedStrings.xml");
  const sheet = workbook.entries.get("xl/worksheets/sheet1.xml") ?? [...workbook.entries.values()]
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!sheet) invalidFile();
  const strings = stringsEntry ? sharedStrings(workbook.read(stringsEntry)) : [];
  return worksheet(workbook.read(sheet), strings);
}

export function readUploadTable(fileName: string, bytes: Buffer): Table {
  if (bytes.length > MAX_UPLOAD_BYTES) tableLimit("The file is over 2 MB.");
  if (/\.xlsx$/i.test(fileName) || bytes.subarray(0, 2).toString("latin1") === "PK") return readXlsx(bytes);
  if (/\.(csv|txt)$/i.test(fileName)) return parseCsv(decodeUtf8(bytes));
  throw new Error("Upload a CSV or XLSX file.");
}
