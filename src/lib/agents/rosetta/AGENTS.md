# Rosetta Agent Guide

Rosetta owns source text normalization.

## Authority

- Rosetta reads `source_documents`, and only each bank's current document: a newer download
  replaces an older one, and a newer failed download replaces an older one we hold no vault
  copy of. A document with no vault copy whose link already returned 404/410 is not
  downloaded again; the first 404 sends the bank back to Magellan.
- "Current" is per stream (`src/lib/agents/companion-streams.ts`): the main fee link is one
  stream and each companion page (`source_documents.companion_source_id`) is its own, so a
  bank's account pages and its fee schedule are all read. A companion page that is not a
  fee page, needs JavaScript, or is gone is marked `rejected` in
  `institution_additional_sources`; it never sends the bank's main link back to Magellan,
  and its reads never change the bank's source profile or playbook.
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
  version with fewer than `REREAD_MAX_KNOX_FEES` (5) Knox fees are read once more with
  the current reader, so an institution whose flattened table gave up one fee gets its
  whole schedule. Texts with more Knox fees are left alone, and a failed re-read keeps
  the earlier text.
- No bank is lost to its document's format. Readers escalate within the same document,
  free first, and every try is a `pipeline_attempts` row (stage `read`, own strategy,
  version, outcome, cost):

  | Pass | Strategy | Reads | Version const |
  | --- | --- | --- | --- |
  | 1 | `read.html_dom`, `read.pdf_layout`, `read.plain_text` | static HTML, text PDFs, text | `ROSETTA_READ_VERSION` (3) |
  | 2 | `read.table_rows` | cells of HTML tables, PDF/OCR layout columns | `ROSETTA_TABLE_ROWS_VERSION` |
  | 2 | `read.ocr_tesseract` (`ocr.ts`) | scans up to `OCR_MAX_PAGES` (10) pages | `ROSETTA_OCR_VERSION` |
  | 2 | `read.js_fallback` (`js-fallback.ts`) | JavaScript-built pages | `ROSETTA_JS_FALLBACK_VERSION` |
  | 3 | `read.paid_transcribe` (`paid-read.ts`, step `read-paid`) | scans free OCR could not read | `ROSETTA_PAID_READ_VERSION` |

  - A scan (`scanned_pdf` from `read.pdf_layout`) goes straight to free OCR: tesseract.js
    on the largest image of each page, English model bundled from
    `@tesseract.js-data/eng` (`ROSETTA_OCR_LANG_PATH` overrides), at most
    `OCR_DOCUMENTS_PER_RUN` (4) scans per read step and `OCR_DOCUMENT_TIMEOUT_MS` per
    scan. Over the allowance the scan is `deferred` (nothing written, read next run).
    OCR that fails, is too long, or has mean confidence under `OCR_MIN_CONFIDENCE` leaves
    the text `needs_ocr` for pass 3. OCR fixes only unambiguous `$` misreads (`#35.00`).
  - A JavaScript page (no text, or an app shell or a page whose link names the fee page,
    such as `/fees` or `fee-schedule`, whose text fails the fee-page check)
    tries embedded data (`__NEXT_DATA__`, JSON/ld+json scripts, Next flight chunks,
    `window.X = {...}`), then linked PDF/print versions, then `?print=1`, `?output=amp`,
    `/print` (at most `JS_FALLBACK_MAX_FETCHES` fetches). The stored `source_url` is the
    URL actually read. With no free route the text is `skipped` with outcome
    `js_required`, the URL goes to `institution_source_profiles.rejected_source_urls`,
    `institution_sources.fee_schedule_url` is cleared and `failure_reason` is
    `rosetta_js_required`: Magellan's paid finder picks those up. No headless browser.
  - A download that fails with HTTP 404/410, with HTTP 401/403 when an earlier read of
    the same document was also blocked, or for the third time in 7 days with a block,
    rate limit, server error, timeout or network error (`STUCK_LINK_*` in `read.ts`),
    sends the bank back to Magellan the same way (`failure_reason` `rosetta_dead_link`),
    but only while `fee_schedule_url` still points at that URL. A single 403 keeps the
    link: it can be a passing bot challenge. A document that is not in the vault and has
    hit that failure limit is not downloaded again until the 7 days pass.
  - Pass 3 takes texts still `needs_ocr` whose bytes the current reader already tried and
    that have no settled `read.paid_transcribe` attempt, sends the PDF as a base64
    `document` block via `paidModelCall` (agent `rosetta`, `PAID_PASS_MODELS.read()`, at
    most `PAID_PASS_ITEMS_PER_RUN`), and stores the transcription as a normal completed
    text (fee-page check included). A budget cap or the automation stop ends the step
    with `budgetStopped`; nothing is recorded for documents not sent.
  - Scans and JavaScript pages an older reader version gave up on (`needs_ocr`, `empty`)
    are read once more when `ROSETTA_READ_VERSION` is bumped. Auxiliary strategies
    (`AUXILIARY_READ_STRATEGIES`) never settle a read or block re-selection.

## Table rows contract (for Knox)

`agent_source_texts.table_rows` (jsonb, migration `20270106020000`; NULL when the
document has no tables) and `agent_source_texts.reader` (the strategy whose text is
stored). Rosetta writes them only once the migration is applied.

```json
{ "version": 1,
  "rows": [
    { "table": 0, "page": null, "cells": ["Service", "Fee"], "header": true, "origin": "html_table" },
    { "table": 0, "page": null, "cells": ["Overdraft fee", "$35.00"], "header": false, "origin": "html_table" } ] }
```

- `cells.join(" | ")` is exactly one line of `normalized_text`; rows not found in the text
  are dropped, empty cells are dropped (as in the text). Rows keep document order.
- `table` groups rows of one table (a run of consecutive row lines for text-derived
  rows); `page` is the 1-based PDF page when known, else null.
- `header` is true only for HTML `<thead>` rows or rows of `<th>` cells.
- `origin`: `html_table`, `html_definition_list`, `pdf_layout`, `ocr_layout`,
  `embedded_data`, `paid_transcription`. Treat OCR and paid rows as less certain than
  HTML/PDF rows.
- At most `MAX_TABLE_ROWS` (2000) rows. Bump `version` for any breaking change.

- Preserve institution ID, source document ID, source URL, content type, source hash, normalized text hash, character count, and error state.
- Mark insufficient text explicitly. Do not fabricate text, fee rows, or confidence.
- Make OCR/manual-needed states visible to Atlas and downstream review surfaces.

## Boundaries

- Do not write raw, verified, or published fee rows.
- Do not call provider extraction while automation is stopped.
- Do not let text normalization erase source-document lineage needed by Knox, Darwin, or Hamilton.
