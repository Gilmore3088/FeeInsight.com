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
 * Each row's `cells.join(" | ")` is exactly one line of `normalized_text`, so a row can
 * always be traced back to the text Knox already reads. Empty cells are dropped, the
 * same as in the text. Rows of one table share `table` and appear in document order.
 */

export const ROSETTA_TABLE_ROWS_VERSION = 1;
export const TABLE_ROWS_STRATEGY = "read.table_rows";
/** Bounds the jsonb size; a fee schedule has a few hundred rows at most. */
export const MAX_TABLE_ROWS = 2000;

export type TableRowOrigin =
  | "html_table"
  | "html_definition_list"
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
  return rows.filter((row) => lines.has(row.cells.join(CELL_SEPARATOR))).slice(0, MAX_TABLE_ROWS);
}

export function tableRowsPayload(rows: SourceTableRow[]): SourceTableRows | null {
  return rows.length > 0 ? { version: ROSETTA_TABLE_ROWS_VERSION, rows: rows.slice(0, MAX_TABLE_ROWS) } : null;
}

const columnsReadyCache = new WeakMap<object, boolean>();

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
