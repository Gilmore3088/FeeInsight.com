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
  for (const row of rows) {
    const rowCells = cellsOf(row);
    const cells = rowCells.map(inlineText).filter((cell) => cell.length > 0);
    if (cells.length === 0) continue;
    out.line(cells.join(CELL_SEPARATOR));
    out.tableRows += 1;
    out.rows.push({
      table: tableIndex,
      page: null,
      cells,
      header: headRows.has(row) || rowCells.every((cell) => cell.name === "th"),
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
