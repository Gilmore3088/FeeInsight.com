# Rosetta Agent Guide

Rosetta owns source text normalization.

## Authority

- Rosetta reads `source_documents`.
- Rosetta writes normalized text artifacts to `agent_source_texts`.
- Rosetta may classify unreadable, scanned, truncated, or unsupported source documents for manual/OCR follow-up.

## Required Behavior

- Use deterministic HTML, text, and PDF extraction first.
- HTML is read through a parsed DOM (`read.html_dom`, `html-dom.ts`): each data-table
  row is one line with cells joined by ` | `, definition lists pair term and
  description, layout tables read as blocks. PDFs rebuild lines from item positions
  (`read.pdf_layout`, `pdf-layout.ts`), so a fee name and its amount column share a
  line. Knox pairs fees and amounts per line, so keep that contract.
- Bump `ROSETTA_READ_VERSION` when a reader changes. Completed texts from an older
  version that Knox found no fees in are read once more; texts Knox extracted from
  are never re-read, and a failed re-read keeps the earlier text.
- Preserve institution ID, source document ID, source URL, content type, source hash, normalized text hash, character count, and error state.
- Mark insufficient text explicitly. Do not fabricate text, fee rows, or confidence.
- Make OCR/manual-needed states visible to Atlas and downstream review surfaces.

## Boundaries

- Do not write raw, verified, or published fee rows.
- Do not call provider extraction while automation is stopped.
- Do not let text normalization erase source-document lineage needed by Knox, Darwin, or Hamilton.
