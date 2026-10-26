import type { sql } from "@/lib/data-store/connection";

import { CELL_SEPARATOR } from "./html-dom";

type SqlTag = typeof sql;

/**
 * `read.table_rows`: structured table rows stored next to the text, so Knox can pair a
 * fee name with its amount by cell instead of by guessing at a line.
 *
 * Contract (`agent_source_texts.table_rows`, jsonb, see rosetta/AGENTS.md):
 *   { "version": 1, "rows": [{ "table": 0, "page": null, "cells": ["Overdraft fee", "$35.00"],
 *                              "header": false, "origin": "html_table" }, ...] }
 * Each row's `line` (when set) or else `cells.join(" | ")` is exactly one line of
 * `normalized_text`, so a row can always be traced back to the text Knox already reads.
 * Empty cells are dropped from `cells`. Rows of one table share `table` and appear in
 * document order.
 *
 * Version 2 (#1912): an HTML table row also stores `columns`, its text per grid column with
 * "" for an empty cell or a column a span covers, so a value keeps its column. Dropping empty
 * cells moved Capital City's "$50 fee to close prior to maturity" from its IRA column under
 * the CD column, and the fee was filed as a CD early closure. A cell an empty cell displaced is
 * written in the text with its column's header name after it ("$50 fee to close prior to
 * maturity (ira)"), and that row's text is in `line`. `cells` is unchanged, so v1 readers work.
 */

import { ROSETTA_TABLE_ROWS_VERSION } from "./reader-versions";
// The number lives in reader-versions.ts (bump it there); the history stays above.
export { ROSETTA_TABLE_ROWS_VERSION };
export const TABLE_ROWS_STRATEGY = "read.table_rows";
/** Bounds the jsonb size; a fee schedule has a few hundred rows at most. */
export const MAX_TABLE_ROWS = 2000;

export type TableRowOrigin =
  | "html_table"
  | "html_definition_list"
  | "docx_table"
  | "pdf_layout"
  | "ocr_layout"
  | "embedded_data"
  | "paid_transcription";

export interface SourceTableRow {
  /** Table index within the document, from 0. */
  table: number;
  /** 1-based PDF page, or null when the document has no pages (HTML, plain text). */
  page: number | null;
  cells: string[];
  /**
   * v2, HTML tables only: the row's text per column of the table's grid, as wide as the table's
   * widest row. "" is an empty cell, a column a colspan or a rowspan from above covers, or no cell.
   */
  columns?: string[];
  /** v2: the row's text line, only when it is not `cells.join(" | ")` (a displaced cell with its header's name). */
  line?: string;
  /** A header row (`<th>` cells only, or inside `<thead>`). Rows read from text are never headers. */
  header: boolean;
  origin: TableRowOrigin;
}

export interface SourceTableRows {
  version: typeof ROSETTA_TABLE_ROWS_VERSION;
  rows: SourceTableRow[];
}

function splitCells(line: string): string[] {
  return line
    .split(CELL_SEPARATOR.trim())
    .map((cell) => cell.replace(/\s+/g, " ").trim())
    .filter((cell) => cell.length > 0);
}

/**
 * Rows from text whose lines use the " | " cell separator (PDF layout, OCR layout, paid
 * transcription). A run of consecutive row lines is one table; any other line ends it.
 * `pages` (one text per page) adds page numbers; otherwise rows have no page.
 */
export function tableRowsFromText(
  text: string | string[],
  origin: TableRowOrigin,
  firstTable = 0,
): SourceTableRow[] {
  const pages = Array.isArray(text) ? text : [text];
  const paged = Array.isArray(text);
  const rows: SourceTableRow[] = [];
  let table = firstTable - 1;
  pages.forEach((pageText, pageIndex) => {
    let inTable = false;
    for (const line of pageText.split("\n")) {
      const cells = line.includes(CELL_SEPARATOR.trim()) ? splitCells(line) : [];
      if (cells.length < 2) {
        inTable = false;
        continue;
      }
      if (!inTable) table += 1;
      inTable = true;
      if (rows.length < MAX_TABLE_ROWS) {
        rows.push({ table, page: paged ? pageIndex + 1 : null, cells, header: false, origin });
      }
    }
  });
  return rows;
}

/** Rows that still appear in the stored text after whitespace normalization. */
export function rowsInText(rows: SourceTableRow[], normalizedText: string): SourceTableRow[] {
  const lines = new Set(normalizedText.split("\n").map((line) => line.trim()));
  return rows.filter((row) => lines.has(row.line ?? row.cells.join(CELL_SEPARATOR))).slice(0, MAX_TABLE_ROWS);
}

export function tableRowsPayload(rows: SourceTableRow[]): SourceTableRows | null {
  return rows.length > 0 ? { version: ROSETTA_TABLE_ROWS_VERSION, rows: rows.slice(0, MAX_TABLE_ROWS) } : null;
}

const columnsReadyCache = new WeakMap<object, boolean>();
const kindColumnsReadyCache = new WeakMap<object, boolean>();

/**
 * True once `agent_source_texts.document_kind` and `.document_kind_version` exist (migration
 * 20270110000050, #1094). Before that, Rosetta stores no kind; only a positive answer is cached.
 */
export async function documentKindColumnsReady(db: SqlTag): Promise<boolean> {
  if (kindColumnsReadyCache.get(db)) return true;
  const [row] = await db`
    SELECT COUNT(*) = 2 AS document_kind_columns_ready
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'agent_source_texts'
       AND column_name IN ('document_kind', 'document_kind_version')
  `;
  const ready = row?.document_kind_columns_ready === true;
  if (ready) kindColumnsReadyCache.set(db, true);
  return ready;
}

/**
 * True once `agent_source_texts.table_rows` and `.reader` exist (migration
 * 20270106020000). Before that, Rosetta writes texts exactly as it did; only a positive
 * answer is cached.
 */
export async function rosettaTextColumnsReady(db: SqlTag): Promise<boolean> {
  if (columnsReadyCache.get(db)) return true;
  const [row] = await db`
    SELECT COUNT(*) = 2 AS rosetta_text_columns_ready
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'agent_source_texts'
       AND column_name IN ('table_rows', 'reader')
  `;
  const ready = row?.rosetta_text_columns_ready === true;
  if (ready) columnsReadyCache.set(db, true);
  return ready;
}
