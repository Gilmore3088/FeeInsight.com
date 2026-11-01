import { parseDocument } from "htmlparser2";

import type { SourceTableRow } from "./table-rows";

/**
 * `read.html_dom`: HTML to text through a parsed DOM instead of tag stripping.
 *
 * Fee schedules are usually tables. Stripping tags put each cell on its own line, so
 * Knox saw "Overdraft fee" on one line and "$35.00" on the next and paired neither.
 * Here every table row becomes one line with its cells joined by " | ", definition
 * lists pair each term with its description, <br> breaks a line, and entities are
 * decoded once by the parser.
 */

type DomNode = ReturnType<typeof parseDocument>["children"][number];

interface DomElement {
  type: string;
  name: string;
  attribs: Record<string, string>;
  children: DomNode[];
}

export const CELL_SEPARATOR = " | ";

const SKIPPED_TAGS = new Set([
  "script", "style", "noscript", "svg", "template", "textarea", "select", "option", "iframe", "object", "head",
]);

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "center", "details", "dialog", "div", "dl",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
  "html", "legend", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "ul",
]);

export interface HtmlDomExtraction {
  text: string;
  /** Data-table rows written as one line each; layout tables are not counted. */
  tableRows: number;
  /** The same rows as cells (plus definition-list pairs), for `agent_source_texts.table_rows`. */
  rows: SourceTableRow[];
}

function isElement(node: DomNode): node is DomNode & DomElement {
  return "name" in node && "children" in node && (node.type === "tag" || node.type === "script" || node.type === "style");
}

function isText(node: DomNode): node is DomNode & { data: string } {
  return node.type === "text" && "data" in node;
}

function elementChildren(element: DomElement): DomElement[] {
  return element.children.filter(isElement);
}

/** Rows of this table only: direct, or under thead/tbody/tfoot, never a nested table's. */
function tableRowsOf(table: DomElement): DomElement[] {
  const rows: DomElement[] = [];
  for (const child of elementChildren(table)) {
    if (child.name === "tr") rows.push(child);
    else if (child.name === "thead" || child.name === "tbody" || child.name === "tfoot") {
      rows.push(...elementChildren(child).filter((row) => row.name === "tr"));
    }
  }
  return rows;
}

function cellsOf(row: DomElement): DomElement[] {
  return elementChildren(row).filter((cell) => cell.name === "td" || cell.name === "th");
}

function containsTable(element: DomElement): boolean {
  return elementChildren(element).some((child) => child.name === "table" || containsTable(child));
}

/**
 * A table used for page layout (a whole page in one cell, or tables nested in cells)
 * reads as ordinary blocks; only data tables get one line per row.
 */
function isLayoutTable(rows: DomElement[]): boolean {
  if (rows.length === 0) return true;
  const cells = rows.flatMap(cellsOf);
  if (cells.some(containsTable)) return true;
  return rows.every((row) => cellsOf(row).length <= 1);
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

class TextWriter {
  private readonly parts: string[] = [];
  tableRows = 0;
  readonly rows: SourceTableRow[] = [];
  tables = 0;

  write(value: string): void {
    this.parts.push(value);
  }

  line(value: string): void {
    this.parts.push(`\n${value}\n`);
  }

  break(): void {
    this.parts.push("\n");
  }

  toString(): string {
    return this.parts.join("");
  }
}

function walk(nodes: DomNode[], out: TextWriter): void {
  for (const node of nodes) {
    if (isText(node)) {
      out.write(node.data);
      continue;
    }
    if (!isElement(node)) continue;
    const name = node.name.toLowerCase();
    if (SKIPPED_TAGS.has(name)) continue;
    if (name === "br") {
      out.break();
      continue;
    }
    if (name === "table") {
      writeTable(node, out);
      continue;
    }
    if (name === "dl") {
      writeDefinitionList(node, out);
      continue;
    }
    const block = BLOCK_TAGS.has(name);
    if (block) out.break();
    walk(node.children, out);
    if (block) out.break();
  }
}

/** Text of a cell or term on one line: inner blocks and breaks become spaces. */
function inlineText(element: DomElement): string {
  const inner = new TextWriter();
  walk(element.children, inner);
  return collapse(inner.toString());
}

/** HTML caps colspan at 1000 and rowspan at 65534; a fee table never needs more than this. */
const MAX_SPAN = 50;

function spanOf(cell: DomElement, attribute: "colspan" | "rowspan"): number {
  const value = Number.parseInt(cell.attribs?.[attribute] ?? "", 10);
  return Number.isFinite(value) && value >= 1 ? Math.min(value, MAX_SPAN) : 1;
}

/** One table row placed on the table's column grid (#1912). */
interface GridRow {
  row: DomElement;
  rowCells: DomElement[];
  /** Non-empty cells in document order, as the text has always written them. */
  cells: string[];
  /** Grid column of each entry of `cells`. */
  cellColumns: number[];
  /** Each grid column's own text: "" for an empty cell, a column a span covers, or no cell. */
  columns: string[];
  /** Per entry of `cells`: an empty cell of the row's own sits before it. */
  displaced: boolean[];
  /** Grid column each of `rowCells` starts at. */
  starts: number[];
}

/**
 * Places each row's cells on the table's column grid: a `colspan` cell covers its columns, a
 * `rowspan` cell holds its column in the rows below, and an empty cell keeps its column (#1912).
 * Dropping empty cells shifted Capital City's "$50 fee to close prior to maturity" from the IRA
 * column into the CD column. Pure.
 */
function gridRows(rows: DomElement[]): GridRow[] {
  const heldBelow: number[] = [];
  const result: GridRow[] = [];
  for (const row of rows) {
    const rowCells = cellsOf(row);
    const columns: string[] = [];
    const cells: string[] = [];
    const cellColumns: number[] = [];
    const displaced: boolean[] = [];
    const starts: number[] = [];
    const taken = (column: number) => (heldBelow[column] ?? 0) > 0;
    let column = 0;
    let emptyBefore = false;
    for (const cell of rowCells) {
      while (taken(column)) columns[column++] = "";
      starts.push(column);
      const text = inlineText(cell);
      const colspan = spanOf(cell, "colspan");
      const rowspan = spanOf(cell, "rowspan");
      for (let offset = 0; offset < colspan; offset += 1) {
        columns[column + offset] = offset === 0 ? text : "";
        if (rowspan > 1) heldBelow[column + offset] = Math.max(heldBelow[column + offset] ?? 0, rowspan);
      }
      if (text) {
        cells.push(text);
        cellColumns.push(column);
        displaced.push(emptyBefore);
      } else {
        emptyBefore = true;
      }
      column += colspan;
    }
    for (let index = 0; index < columns.length; index += 1) columns[index] ??= "";
    // A rowspan counts down once per row, including the row that set it.
    for (let index = 0; index < heldBelow.length; index += 1) {
      if ((heldBelow[index] ?? 0) > 0) heldBelow[index] -= 1;
    }
    result.push({ row, rowCells, cells, cellColumns, columns, displaced, starts });
  }
  return result;
}

/**
 * A header cell short enough to name its column beside a value. A header carrying a figure
 * ("Checking (balance $1,500)") would put a second amount on the line, so it names nothing.
 */
const MAX_COLUMN_LABEL_CHARS = 40;
function columnLabel(text: string | undefined): string | null {
  if (!text || text.length > MAX_COLUMN_LABEL_CHARS || /\d/.test(text)) return null;
  // The name is written in parentheses after the value, so its own parentheses go.
  return text.replace(/:\s*$/, "").replace(/[()]/g, "").replace(/\s+/g, " ").trim() || null;
}

/** Each grid column's header name: a header cell that spans columns names each of them. */
function headerLabels(header: GridRow): Array<string | null> {
  const labels: Array<string | null> = header.columns.map(() => null);
  header.rowCells.forEach((cell, index) => {
    const label = columnLabel(header.columns[header.starts[index]]);
    const span = spanOf(cell, "colspan");
    for (let offset = 0; offset < span; offset += 1) labels[header.starts[index] + offset] = label;
  });
  return labels;
}

/**
 * The row's text cells. A cell an empty cell displaced (it would read as the column to its left)
 * is followed by its column's header name in parentheses ("$50 fee to close prior to maturity
 * (ira)") when the table's header row names that column; every other cell, and every row with no
 * displaced cell, is written exactly as before. The row's first column is its own name and never
 * takes a label.
 *
 * The name goes after the value, not before it: "Stop payment | Premier Checking: $25.00" lost the
 * fee from Knox's free reading (the words before the price became its name), while "Stop payment |
 * $25.00 (Premier Checking)" reads the same fee as the old line (html-table-columns.test.ts).
 */
function lineCells(grid: GridRow, labels: Array<string | null> | null): string[] {
  if (!labels || !grid.displaced.some(Boolean)) return grid.cells;
  return grid.cells.map((cell, index) => {
    const column = grid.cellColumns[index];
    const label = column > 0 && grid.displaced[index] ? labels[column] : null;
    return label ? `${cell} (${label})` : cell;
  });
}

function writeTable(table: DomElement, out: TextWriter): void {
  const rows = tableRowsOf(table);
  if (isLayoutTable(rows)) {
    out.break();
    for (const child of elementChildren(table)) {
      if (child.name === "caption") out.line(inlineText(child));
    }
    for (const row of rows) {
      for (const cell of cellsOf(row)) {
        out.break();
        walk(cell.children, out);
        out.break();
      }
    }
    out.break();
    return;
  }

  out.break();
  for (const child of elementChildren(table)) {
    if (child.name === "caption") {
      const caption = inlineText(child);
      if (caption) out.line(caption);
    }
  }
  const headRows = new Set(
    elementChildren(table)
      .filter((child) => child.name === "thead")
      .flatMap((head) => elementChildren(head).filter((row) => row.name === "tr")),
  );
  const tableIndex = out.tables;
  out.tables += 1;
  const grid = gridRows(rows);
  const width = Math.max(...grid.map((row) => row.columns.length));
  let labels: Array<string | null> | null = null;
  for (const gridRow of grid) {
    const { row, rowCells, cells } = gridRow;
    if (cells.length === 0) continue;
    const header = headRows.has(row) || rowCells.every((cell) => cell.name === "th");
    // The nearest header row above names the columns of the rows under it; a one-cell header row
    // is a section heading ("Checking accounts") and names no column.
    if (header && cells.length >= 2) labels = headerLabels(gridRow);
    const line = (header ? cells : lineCells(gridRow, labels)).join(CELL_SEPARATOR);
    out.line(line);
    out.tableRows += 1;
    const columns = Array.from({ length: width }, (_, index) => gridRow.columns[index] ?? "");
    out.rows.push({
      table: tableIndex,
      page: null,
      cells,
      columns,
      ...(line === cells.join(CELL_SEPARATOR) ? {} : { line }),
      header,
      origin: "html_table",
    });
  }
  out.break();
}

function writeDefinitionList(list: DomElement, out: TextWriter, tableIndex?: number): void {
  out.break();
  const listIndex = tableIndex ?? out.tables++;
  let term: string | null = null;
  const flushTerm = () => {
    if (term) out.line(term);
    term = null;
  };
  for (const child of elementChildren(list)) {
    const name = child.name.toLowerCase();
    if (name === "dt") {
      flushTerm();
      term = inlineText(child) || null;
    } else if (name === "dd") {
      const description = inlineText(child);
      if (term && description) {
        out.line(`${term}${CELL_SEPARATOR}${description}`);
        out.rows.push({ table: listIndex, page: null, cells: [term, description], header: false, origin: "html_definition_list" });
        term = null;
      } else if (description) {
        out.line(description);
      }
    } else if (name === "div") {
      // <dl><div><dt/><dd/></div></dl> is valid HTML; read the group the same way.
      writeDefinitionList(child, out, listIndex);
    }
  }
  flushTerm();
  out.break();
}

/** Raw text with line structure kept; the caller normalizes whitespace. */
export function extractHtmlDomText(html: string): HtmlDomExtraction {
  const document = parseDocument(html, { decodeEntities: true, lowerCaseTags: true });
  const out = new TextWriter();
  walk(document.children, out);
  return { text: out.toString(), tableRows: out.tableRows, rows: out.rows };
}
