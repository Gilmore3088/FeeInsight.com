import { unzipSync } from "fflate";

import { CELL_SEPARATOR } from "./html-dom";
import type { SourceTableRow } from "./table-rows";

/**
 * `read.docx_text`: a Word (.docx) fee schedule to text, for free.
 *
 * A .docx file is a zip whose `word/document.xml` holds the body. Each paragraph
 * becomes a line, a tab inside a paragraph becomes a cell break (Word schedules often
 * tab the price away from the fee name), and each table row becomes one line with its
 * cells joined by " | ", the same shape `read.html_dom` gives an HTML table. A legacy
 * binary .doc is not a zip and is reported as unsupported.
 */

export const DOCX_STRATEGY = "read.docx_text";

export class DocxReadError extends Error {
  constructor(
    readonly reason: "not_docx" | "no_body",
    message: string,
  ) {
    super(message);
    this.name = "DocxReadError";
  }
}

export interface DocxExtraction {
  text: string;
  rows: SourceTableRow[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Text of one paragraph: runs joined, tabs as cell breaks, line breaks as spaces. */
function paragraphText(xml: string): string {
  const parts: string[] = [];
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\s*\/>/g;
  for (const match of xml.matchAll(token)) {
    if (match[1] !== undefined) parts.push(decodeXml(match[1]));
    else if (match[0].startsWith("<w:tab")) parts.push(CELL_SEPARATOR);
    else parts.push(" ");
  }
  return parts
    .join("")
    .replace(/[ \t]+/g, " ")
    .split(CELL_SEPARATOR.trim())
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(CELL_SEPARATOR);
}

function paragraphsOf(xml: string): string[] {
  return [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((match) => paragraphText(match[0])).filter(Boolean);
}

/** Top-level elements of the body, so a table's paragraphs are read once, as cells. */
function bodyBlocks(body: string): Array<{ kind: "table" | "paragraph"; xml: string }> {
  const blocks: Array<{ kind: "table" | "paragraph"; xml: string }> = [];
  let index = 0;
  while (index < body.length) {
    const table = body.indexOf("<w:tbl>", index);
    const paragraph = body.slice(index).search(/<w:p[\s>]/);
    const nextParagraph = paragraph < 0 ? -1 : index + paragraph;
    if (table >= 0 && (nextParagraph < 0 || table < nextParagraph)) {
      // Tables can nest: find the matching close.
      let depth = 0;
      const tag = /<w:tbl>|<\/w:tbl>/g;
      tag.lastIndex = table;
      let end = body.length;
      for (let match = tag.exec(body); match; match = tag.exec(body)) {
        depth += match[0] === "<w:tbl>" ? 1 : -1;
        if (depth === 0) {
          end = match.index + match[0].length;
          break;
        }
      }
      blocks.push({ kind: "table", xml: body.slice(table, end) });
      index = end;
    } else if (nextParagraph >= 0) {
      const close = body.indexOf("</w:p>", nextParagraph);
      const end = close < 0 ? body.length : close + "</w:p>".length;
      blocks.push({ kind: "paragraph", xml: body.slice(nextParagraph, end) });
      index = end;
    } else {
      break;
    }
  }
  return blocks;
}

export function extractDocxText(bytes: Uint8Array): DocxExtraction {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name === "word/document.xml" });
  } catch {
    throw new DocxReadError("not_docx", "Not a .docx file (a legacy Word .doc has no free reader)");
  }
  const document = files["word/document.xml"];
  if (!document) throw new DocxReadError("not_docx", "No word/document.xml in the file");
  const xml = new TextDecoder("utf-8").decode(document);
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1];
  if (body === undefined) throw new DocxReadError("no_body", "The Word document has no body");

  const lines: string[] = [];
  const rows: SourceTableRow[] = [];
  let tableIndex = 0;
  for (const block of bodyBlocks(body)) {
    if (block.kind === "paragraph") {
      const text = paragraphText(block.xml);
      if (text) lines.push(text);
      continue;
    }
    const table = tableIndex;
    tableIndex += 1;
    for (const row of block.xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)) {
      const cells = [...row[0].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)]
        .map((cell) => paragraphsOf(cell[0]).join(" "))
        .filter(Boolean);
      if (cells.length === 0) continue;
      lines.push(cells.join(CELL_SEPARATOR));
      rows.push({ table, page: null, cells, header: /<w:tblHeader(\s|\/)/.test(row[0]), origin: "docx_table" });
    }
  }
  return { text: lines.join("\n"), rows };
}
