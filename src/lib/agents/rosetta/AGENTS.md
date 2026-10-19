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
- After migration 67, the shared `recordReadResult` boundary retains exact future
  normalized bytes in private `agent_source_text_witnesses` (#2220). It inserts the
  current row if absent, locks it, retains a hash-valid incumbent, replaces the
  mutable current row, then retains incoming bytes in one transaction/savepoint.
  Current artifact IDs and one-row-per-document uniqueness stay unchanged. Both
  free and paid readers use it; status-only triage preserves the prior status first.
  Missing schema is reported as unavailable. A corrupt incumbent is not archived
  under its claimed hash; an archive failure aborts replacement once capture is active.
- The exact normalized-witness resolver is diagnostic only. It requires artifact ID,
  text hash, document ID and institution ID and verifies actual UTF-8 SHA256. It
  distinguishes current, retained history and unavailable evidence. Capture time
  and observed artifact metadata never become a claimed original read time. No
  existing takedown, fee verification, release or public reader gains historical
  authority. There is no seed/import, replay epoch, automatic purge or retention
  deletion. Atlas warns at 256 MiB for this table; the warning neither deletes
  evidence nor pauses a source. Application rollback keeps the table and guards.
- A document a person supplied by hand (`magellan/hand-supplied.ts`) is read from the uploaded
  bytes as it is stored (`readHandSuppliedDocument`): the same reader, fee-page check, text record
  and attempts as the read step (`settleRead`), with every outside request answered as refused,
  so the bank's site that blocked us is never asked. Later re-reads take the bytes from the vault.
- Rosetta may classify unreadable, scanned, truncated, or unsupported source documents for manual/OCR follow-up.

## Required Behavior

- Default fee-source downloads use `../fee-source-fetch.ts`, including linked fallback documents
  and the paid reader's plain download. Keep source URLs/headers and pass the selected transport
  through helpers. Vault, hand-supplied and injected test reads keep their existing transports.
  Scope and compatibility: `docs/project/findings/2026-10-19-safe-fee-source-fetch.md` (#2136).
- Use deterministic HTML, text, and PDF extraction first.
- HTML is read through a parsed DOM (`read.html_dom`, `html-dom.ts`): each data-table
  row is one line with cells joined by ` | `, definition lists pair term and
  description, layout tables read as blocks. PDFs rebuild lines from item positions
  (`read.pdf_layout`, `pdf-layout.ts`), so a fee name and its amount column share a
  line. A page set in columns of running prose (a deposit agreement in three columns) is
  read column by column instead (layout version 2, `PDF_LAYOUT_VERSION`); read across, a
  sentence took its price from the next column's sentence. A gutter is found by how many
  lines cross it (layout version 3), so a PDF that draws each letter as its own item, with
  a full-width form below its columns, is read column by column too. Fee tables, and fee lists set
  side by side, keep the row-by-row reading. Layout 5 additionally reads two independent
  stacked label/next-line bullet-price lists as columns: each band needs repeated own
  pairs, sufficient width and a gutter. Mixed label/amount table rows, monetary or waiver
  gutter crossings and nested cell columns refuse that detector and retain the earlier
  baseline reading. A PDF text an older layout read across its
  columns (`INTERLEAVED_PROSE_CELLS` prose cell breaks or more) is read once more. Word files (.docx) are unzipped and read the same way (`read.docx_text`,
  `docx.ts`): a paragraph per line, a tab as a cell break, a table row per line. A
  legacy binary .doc stays `unsupported_format`. Knox pairs fees and amounts per line,
  so keep that contract.
- Global reader changes bump `ROSETTA_READ_VERSION`. Completed texts from an older
  version with fewer than `REREAD_MAX_KNOX_FEES` (5) Knox fees are read once more with
  the current reader, so an institution whose flattened table gave up one fee gets its
  whole schedule. Texts with more Knox fees are left alone, and a failed re-read keeps
  the earlier text.
- Scoped layout 5 repairs (#2219) keep the global reader 3 and prose-layout 4 replay floors
  settled (`PDF_PROSE_REREAD_VERSION`). `PDF_STACKED_REPAIR_VERSION` v1 makes only current
  completed PDF-layout texts with at least three crossed bullet-price cells and three
  standalone bullet-price lines due for a free geometry check. The complete owner query
  also keeps current-copy, companion-stream, source/profile/access and prior-attempt
  guards. It requires a content-addressed vault key matching the selected source hash.
  At most four repair checks run per read step; they reserve part of the existing step
  limit, never expand it. Unavailable vault configuration, missing bytes or mismatched hashes keep the earlier
  text, make no outside request and leave one explicit failed request for review rather
  than retrying every lane run. Failed requests use `read.pdf_stacked_repair` v1 and do
  not enter the ordinary reader's playbook or settle its retries.
  Each requested check records `detail.pdf_stacked_requested`. A successful check
  records `detail.pdf_stacked` only in the same transaction as the saved artifact,
  bound by `persisted_text_id` and `persisted_text_hash`. Earlier unbound successful
  outputs do not settle a still-interleaved incumbent (#2313); the same v1 owner
  witness selects them through normal Extract, without a global reader replay.
  Replacement locks and rechecks the selected incumbent and source hash. The ordinary
  text-survival score remains unchanged. Only intrinsic stacked-column geometry on
  the exact vault bytes may use an alternate conservation proof: every literal token
  except whitespace and table separators must be retained with the same multiplicity.
  Prices, punctuation, units and qualifying words cannot be added, lost or changed.
  A rejected/stale replacement retains the incumbent and remains unsettled; unavailable
  or mismatched vault bytes retain their existing explicit review exclusion. The same
  committed artifact settles once, including unchanged geometry. Bayes counts successful checks and failed-review exclusions
  separately. State readiness first checks the repair capability schema, preserving ordinary backlog
  on older schemas, then uses the owner's exact query with LIMIT 1/EXISTS; Bayes
  and daily health (`stackedPdfRepairsDue`) use its full count. Reading a better text
  does not itself retire previously verified or published wrong fees.
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

  - A URL or download failure before a reader can run is logged as
    `read.document_access@1`, with the detected document type and typed failure outcome.
    Its `detail.reader_version` preserves the reader-version retry rule for permanent
    access failures such as `too_large`; historical `read.html`, `read.pdf`, `read.text`,
    `read.unknown` and `read.docx` failures keep their existing retry behavior. An
    unsupported format keeps its existing format-specific attempt; a failure from a
    reader that ran stays attributed to that reader.
  - A scan (`scanned_pdf` from `read.pdf_layout`) goes straight to free OCR: tesseract.js
    on the largest image of each page, English model bundled from
    `@tesseract.js-data/eng` (`ROSETTA_OCR_LANG_PATH` overrides), at most
    `OCR_DOCUMENTS_PER_RUN` (4) scans per read step and `OCR_DOCUMENT_TIMEOUT_MS` per
    scan. Over the allowance the scan is `deferred` (nothing written, read next run).
    OCR that fails, is too long, or has mean confidence under `OCR_MIN_CONFIDENCE` leaves
    the text `needs_ocr` for pass 3. OCR fixes only unambiguous `$` misreads (`#35.00`).
    Each page image is turned the way the page draws it (placement matrix and /Rotate);
    a page that still reads poorly is probed at the other quarter turns and read in the
    one that probes at least `OCR_TURN_MIN_GAIN` more confident. A scan an older OCR
    version rejected or found empty gets one read with the current version.
  - A PDF whose embedded text is noise (its font maps letters to control codes or shifted
    letters, "7KH UDWHV" for "The rates") is read like a scan: `hasReadableWords` in
    `learning/format.ts` finds under 2% common English or Spanish words among at least 60.
    Free OCR finds no page images in such a PDF, so it lands `needs_ocr` for pass 3.
    Texts stored before this check (17 PDF texts with control codes near the top, 5 of
    them noise, TruStone's fee schedule among them) are reopened once each
    (`reopenUnreadablePdfTexts`, step detail `reopened_unreadable_pdfs`); a readable one
    is logged `rejected` and never checked again.
  - The fee-page check (`learning/fee-page.ts`, v2) judges a bank's fee link, never a
    companion account page, as a schedule: a product address listing fewer than 10 fee lines
    and no schedule title is `wrong_document`, and the bank goes back to Magellan (#1053).
    The backlog triage re-checks stored texts under v2; a text Knox pulled fees from is kept.
  - Every text Rosetta stores gets its document kind (#1094, `learning/document-kind.ts`,
    `DOCUMENT_KIND_VERSION`): `fee_schedule`, `truth_in_savings`, `account_agreement`,
    `product_page` or `other`. The kind is decided from the content, free and with no model call,
    and kept in `agent_source_texts.document_kind` once migration 20270110000050 is applied
    (before that nothing is written). Rosetta decides it; Knox and the scorecard only read it.
    Texts stored before the migration keep NULL until their next read. Graded on 30 held-out
    production texts on 15 Oct: 26 right.
  - A JavaScript page (no text, or an app shell or a page whose link names the fee page,
    such as `/fees` or `fee-schedule`, whose text fails the fee-page check)
    tries embedded data (`__NEXT_DATA__`, JSON/ld+json scripts, Next flight chunks,
    `window.X = {...}`), then linked PDF/print versions and links that name the fee
    schedule even with no `.pdf` ending ("Schedule of Charges", `/documents/fee-schedule`)
    and PDFs shown in an iframe, embed or object viewer,
    then `?print=1`, `?output=amp`, `/print` (at most `JS_FALLBACK_MAX_FETCHES` fetches).
    A linked scan gets free OCR. A linked document the bank already has as its own
    `source_documents` row is not fetched (it is read there); the attempt's detail lists
    it as `covered_by`. The stored `source_url` is the URL actually read. With no free route the text is `skipped` with outcome
    `js_required`, the URL goes to `institution_source_profiles.rejected_source_urls`,
    `institution_sources.fee_schedule_url` is cleared and `failure_reason` is
    `rosetta_js_required`: Magellan's paid finder picks those up. No headless browser.
    Only a page built by script (no text, or an app shell) ends `js_required`; a page
    whose own text reads fine but is no fee schedule (a home page or "not found" page at
    a guessed fee link) logs the fallback as `wrong_document`.
  - Pages like that rejected as `wrong_document` before the fallback existed (an html
    text whose link names the fee page, at most one amount, never tried by the current
    `ROSETTA_JS_FALLBACK_VERSION`) are reopened once per fallback version at the start of each read step, at most
    `ROSETTA_REOPEN_LIMIT` (100) per step (`reopenScriptLoadedFeePages`): the URL leaves
    `rejected_source_urls`, a bank with no `fee_schedule_url` (and no correction lock)
    gets it back, and a `read.reopen` attempt (outcome `ok`, fingerprint = the text's
    `source_hash`) makes that text readable once more and voids its earlier permanent
    rejection. A page with more amounts is logged `rejected` and stays closed. No fee
    is touched. Only a page's current copy is reopened, and it gets its one read even
    when the bank has a newer document of another page (its main link moved on).
  - A page's current copy that Rosetta read as not a fee page and under 300 characters
    (a bot check, script shell or bare title) is set aside each read step
    (`restoreReadableCopies` in `magellan/current-copy.ts`, at most 50): the page's latest
    copy with a completed text becomes current again (`thin_copies_set_aside`).
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
    Pass 3 also takes text PDFs whose fees did not hold up after free OCR had the same
    bytes (below); their transcription replaces the stored text only when it lists at
    least as many fees with an amount, otherwise the attempt is `low_yield` and the
    earlier text stays.
    Paid response policy v2 accepts ordinary end-turn text and usable `max_tokens` or
    `model_context_window_exceeded` fragments under those same content/yield checks. The
    latter are explicitly `ok_partial`; a completed stored text means a usable artifact,
    not an exhaustive PDF transcription. Refusal, paused/tool work, unconfigured stop
    sequences, absent/unknown stop reasons and unexpected tool/result blocks settle as
    `rejected` before text/profile/table writes. No semantic continuation or retry is added
    for those native response reasons.
    Attempts bind the selected source hash, produced text hash and separately retained
    text hash when a better prior text stays. This scoped version bump does not reopen
    settled attempts on the same bytes.
    Paid detail and narration show known cost estimates plus a count of returned replies
    whose estimate is unavailable. Missing/malformed totals and unpriced models stay
    unknown, while observed zero remains zero. Unknown-cost attempt columns use an
    explicitly marked zero placeholder excluded from playbook cost statistics; those
    replies are therefore absent from that strategy's learned mean. Usage ledger cost is
    NULL. Pre-call budget denials are not unknown returned responses. Generic paid tools,
    no-return transport uncertainty and the existing incurred-spend predicate stay unchanged.
    Persistence remains non-atomic (#1050/#1048): a successfully committed usage receipt
    survives a later artifact-write failure, but that error can prevent the normal paid
    result/attempt/summary. A first text-write failure retains earlier text and can leave
    later paid selection eligible; later subwrite failures can leave partial artifact
    updates. This policy adds no atomic settlement or global no-retry guarantee.
  - Fees that hold up (`text-survival.ts`, learning plan steps 1 to 4). At most once per
    `TEXT_SURVIVAL_REFRESH_HOURS` (20) the read step judges each document's current
    completed text by the published fees Knox pulled from it since that text first
    appeared: live, or taken down for a reason the text can cause (`TEXT_LOSS_REASONS`:
    not reproduced, name not in the text, amount not the fee's, no amount). Category and
    range takedowns are not counted. Each text is one `pipeline_feedback` row about its
    reader (`check_name` `rosetta.text_survival`, `text_held_up` weight = live fees, or
    `text_lost_fees` weight = lost fees when at least 3 were lost and they are 25% of the
    judged fees). `readReaderScores` sums them per reader.
  - A lost text gets one read a rung up the ladder (`nextReaderRung`): a legacy text
    (no reader recorded) with the current primary reader; a `read.html_dom` text with the
    JavaScript fallbacks as well. A bank whose DOM texts lost fees at least as often as
    they held starts its pages on the fallbacks too. A `read.pdf_layout` text has no free
    rung (free OCR reads only page images and replaced none of 96 text-layer PDFs): the
    paid pass takes it. The alternate's text is used only when it is a fee
    page listing at least as many fees with an amount (`rungTextNotWorse`). A re-read of
    a lost text keeps the stored text unless the new one is no thinner, and never sends
    the bank back to Magellan. Each rung runs once per document: the alternate's attempt
    on the same bytes ends it. A web page has no paid rung; a legacy text the current
    reader could not improve stays as it is. Step detail: `texts_held_up`,
    `texts_lost_fees`, `reader_escalations`, `reader_escalations_used`.
  - A legacy PDF text (no reader recorded) longer than `FLAT_TEXT_MIN_CHARS` with no line
    break counts like a lost text. The first PDF reader ran whole schedules onto one line,
    which Knox's rules cannot split; the current reader reads it once, and its text replaces
    the flat one under the same no-thinner rule.
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
- `header` is true only for HTML `<thead>` rows or rows of `<th>` cells, and Word rows
  marked as a repeating header.
- `origin`: `html_table`, `html_definition_list`, `docx_table`, `pdf_layout`, `ocr_layout`,
  `embedded_data`, `paid_transcription`. Treat OCR and paid rows as less certain than
  HTML/PDF rows.
- At most `MAX_TABLE_ROWS` (2000) rows. Bump `version` for any breaking change.

- Preserve institution ID, source document ID, source URL, content type, source hash, normalized text hash, character count, and error state.
- Mark insufficient text explicitly. Do not fabricate text, fee rows, or confidence.
- Make OCR/manual-needed states visible to Atlas and downstream review surfaces.

## Batch review (after every 50 reads)

`batch-review.ts` runs in each read step, before candidates are picked. It takes the next 50
primary reads (html_dom, pdf_layout, plain_text, docx) once they are 6 hours old, so Knox and
the later readers have had them, from the last 3 days and only of each bank's current
document (a lesson on a replaced copy is never read). A failed review never stops the reads:
its error is `batchReviewError` on the step result. It judges each read against what happened next, never a guess:

| Miss | Rule | Fix that picks it up |
|---|---|---|
| `no_fees_found` | completed text, Knox ran on it, Knox has no fee from the document | web page: one read with the JavaScript fallbacks (the same rung as a lost text); PDF: lesson only |
| `short_text` | under 600 chars and under 3 Knox fees | web page: JavaScript fallbacks; PDF: the paid read pass |
| `missed_fee_page` | rejected as `wrong_document`, a later read of it gave Knox 3+ fees | lesson only (the fee-page check was wrong) |
| `unresolved_fee_page` | rejected, link names the fee page, bank has no live fee, nothing read it since | the fee-page reopen (once per fallback version) |
| `unread` | scan, script page or parse failure no reader has read since | scan: OCR then paid read; script page: Magellan's paid finder |

A read that failed and was read later counts as `recovered`, not an error. Each miss is a
`pipeline_feedback` row (`check_name = 'rosetta.batch_review'`, `evidence.remedy`, deduped per
attempt). The candidate selection treats `remedy = 'reread_js_fallback'` like a lost text, and
the paid pass treats `remedy = 'paid_read'` like one. Each batch also writes one
`kind = 'batch_error_rate'` row (errors, reads, rate, misses by kind); its `last_attempt_id` is
the cursor. At most two batches per step; a partial batch waits. The step result carries
`batchReviews`. Knox dedupes rereads, so the fee count is every Knox fee from the document,
not only rows since the read.

The admin scorecard (`/admin/scoreboard`, #1054) shows these rows with the daily goal numbers:
the miss rate by kind for each of the last 8 UTC weeks (`goal.rosetta_miss_rate_weekly`, from the
`batch_error_rate` rows) and how many misses sent to a fix later gave Knox fees
(`goal.rosetta_remedy_outcomes`: a Knox fee from the same document after the review, or from the
same institution for `magellan_paid_find`). Both live in `goal-scorecard.ts`.

## Boundaries

- Do not write raw, verified, or published fee rows.
- Do not call provider extraction while automation is stopped.
- Do not let text normalization erase source-document lineage needed by Knox, Darwin, or Hamilton.

## Daily health check (contract)

`agent-health.ts` runs with the daily scoreboard step and stores these numbers in
`pipeline_scoreboard_snapshots.detail.agent_health`, next to yesterday's. A broken rule, or any
number that moved more than 25% since yesterday, is named in the scoreboard step's summary.
Change this table and `agent-health.ts` in the same PR.

| Rule | Number | Holds when |
|---|---|---|
| Steps do not fail | `stepsFailed` (24 h) | 0 |
| No document fails the same way 3+ times a day | `repeatFailures` (read: 404, 403, 410, network, timeout, 5xx, 429) | 0 |

Also recorded, without a rule: `stepsCompleted`, `spendUsd`, `readOk`, `wrongDocument`, `readFailed`,
`stackedPdfRepairsDue` (the same complete owner selection Bayes counts).

## Current versions

The version each rules or reader constant is at now. `scripts/ci-guards.sh guide-version-kill`
fails a PR that changes one of these constants without updating its line here (#1109).

| Constant | Strategy | Version | File |
|---|---|---|---|
| `BATCH_REVIEW_VERSION` | — | v1 | `rosetta/batch-review.ts` |
| `ROSETTA_JS_FALLBACK_VERSION` | — | v3 | `rosetta/reader-versions.ts` |
| `ROSETTA_OCR_VERSION` | — | v2 | `rosetta/reader-versions.ts` |
| `ROSETTA_PAID_READ_VERSION` | — | v2 | `rosetta/paid-read.ts` |
| `PDF_LAYOUT_VERSION` | — | v5 | `rosetta/reader-versions.ts` |
| `PDF_PROSE_REREAD_VERSION` | — | v4 | `rosetta/reader-versions.ts` |
| `PDF_STACKED_REPAIR_VERSION` | `read.pdf_layout` scoped check | v1 | `rosetta/reader-versions.ts` |
| `ROSETTA_READ_VERSION` | — | v3 | `rosetta/reader-versions.ts` |
| `ROSETTA_DOCUMENT_ACCESS_VERSION` | `read.document_access` | v1 | `rosetta/read.ts` |
| `REOPEN_VERSION` | — | v1 | `rosetta/read.ts` |
| `ROSETTA_TABLE_ROWS_VERSION` | — | v1 | `rosetta/reader-versions.ts` |
| `TEXT_SURVIVAL_VERSION` | — | v1 | `rosetta/text-survival.ts` |
