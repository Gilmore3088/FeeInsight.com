# Rosetta review (2026-10-12)

Part of `docs/plans/pipeline-review-2026-10-12.md`. Rosetta turns each stored document into text
that Knox can read (`src/lib/agents/rosetta/AGENTS.md`). This review also follows what happens to
that text afterwards, through Knox, Darwin and Hamilton, because that is where most of the
missing coverage turned out to be.

**Measured** = read-only production query, 2026-10-12. **Code** = `main` at `4942c387`.

## What Rosetta does (code)

- Reads only each bank's current document, per stream (the main fee link and each companion
  page), and writes `agent_source_texts`.
- Free readers first: a parsed HTML DOM (table rows as `name | amount` lines), a PDF layout reader
  that rebuilds lines and reads multi-column prose column by column, Word files, plain text.
- Escalates inside the same document: table-cell reader, free OCR (tesseract, up to 10 pages,
  4 scans per run), a JavaScript fallback for script-built pages, then a paid transcription
  (`read-paid`) for scans free OCR could not read.
- Rejects pages that fail the fee-page check as `wrong_document`, which sends the bank back to
  Magellan.
- **Already reviews itself:** every 50 reads, `batch-review.ts` compares each read with what
  Knox found and records misses (`no_fees_found`, `short_text`, `missed_fee_page`,
  `unresolved_fee_page`, `unread`) in `pipeline_feedback`, each with a remedy the next run
  applies. That loop is not visible anywhere in admin.

## What it did (measured)

- Texts by status: 19,213 completed (6,037 institutions), 1,658 `wrong_document`, 432 failed,
  106 skipped, 22 `needs_ocr`, 1 empty.
- Spend, last 30 days: $16.62 on 278 paid reads. Rosetta is not a cost problem.

## The gap: readable text, no live fees (measured)

2,178 institutions have completed text but no fees in `published_fee_catalog`. Every one of them
falls into exactly one of these:

| Where it stops | Institutions | Cause |
|---|---|---|
| Knox found no fees in the text | 131 | Rosetta's batch review flags these as `no_fees_found`; whether its remedies work is not measured |
| Knox found fees, Darwin never checked them | 350 | 77 from the last 2 days (normal queue); **72 waiting more than 7 days, oldest 2026-04-17** |
| Darwin verified fees, never published | 1,263 | **Hamilton's 3-fee minimum.** 517 have 1–2 verified fees; 718 have more rows but under 3 distinct fee types; 19 have 3+ types (unexplained); 9 were all rejected |
| Published, then all taken down | 434 | Last reason: product page 137, no reason recorded 71, source check 62, rules re-check 39, refreshed 30, category guard 25, out of range 23, other bank's document 11, other 36 |

**About 1,235 institutions are held only by the 3-fee minimum.** It lives in two places:
`HAMILTON_PUBLISH_MIN_INSTITUTION_FEES = 3` in `src/lib/agents/hamilton/publish.ts`, and the
`published_fee_catalog` view (migration `20270110000000`), which shows a bank's fees only while
it has 3 distinct fee types live. The 71 "no reason" take-downs are most likely that view hiding
banks that dropped below 3, not real take-downs; to be confirmed.

**These are the wrong documents, not small fee schedules (measured).** Of the 1,235
institutions held by the minimum, 1,041 sit on a product or account page by URL
(`/personal/checking`, `/personal-savings-and-cds`, `/overdraft-protection`), 3 on CRA files, and
only 108 on a URL that names a fee schedule or disclosure. Their fees match product pages: 496
have only a monthly maintenance fee, 96 a maintenance fee and a paper-statement fee, 71 a minimum
balance and a maintenance fee. A real fee schedule lists far more. The 3-fee minimum is therefore
doing its job and stays (James, 2026-10-12, `DECISIONS.md`).

The gap is upstream: the fee-page check lets product pages through as the bank's fee document,
and nothing sends a bank whose only document is a product page back to Magellan for the real
schedule. Those 1,235 institutions are the cheapest coverage left: each has a working website,
often a known platform, and a page one or two clicks from the schedule.

## Does Rosetta need rewiring for Magellan's state-by-state order? (code)

Mostly no. Rosetta reads inside each state lane after Magellan's fetch, newest documents first
(`read.ts`, `ORDER BY crawled_at DESC`), so whatever order Magellan works in, Rosetta follows on
the same run. Two changes do matter, and both are below: reject product pages at the fee-page
check (R3), and hand thin institutions back to Magellan as priority targets (R1).

## What works

- Free readers first, paid last; 22 scans waiting is a small backlog.
- The batch review already turns misses into remedies.
- Downstream judgements reach Magellan (`wrong_document` sends the bank back).

## Changes (issues under the Rosetta tracker, #1050)

| # | Change | Owner agent |
|---|---|---|
| R1 #1051 | Send the 1,235 thin institutions back to Magellan as priority targets for the real fee schedule; keep the 3-fee minimum | Magellan (selection) |
| R2 #1052 | Darwin skips some Knox output: 350 institutions with Knox fees and no Darwin result, 72 waiting over a week | Darwin |
| R3 #1053 | Product pages pass as fee documents: 137 institutions' only fees were taken down as product-page fees; reject them at the fee-page check, before Knox | Rosetta (with Magellan #1033) |
| R4 #1054 | Measure the batch review: show miss counts and remedy outcomes (131 `no_fees_found` institutions) on the scorecard | Rosetta (with #1040) |
| R5 #1055 | Explain the 71 "no reason" take-downs and the 19 three-type institutions never published | Hamilton |
| R6 #1056 | Scans: James approved paying to transcribe scanned PDFs; confirm the paid read covers every `needs_ocr` text and report it | Rosetta |

