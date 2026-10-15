# 2026-10-15: live duplicates across page copies

**What happened:** On 2026-10-15 (read-only, about 00:50 UTC), `published_fee_catalog` held 3,153 dollar rows
that repeat another live row with the same institution, category, audience and amount. They fall in
2,964 groups. The 6 pairs that #1329 handles were left out of the count. Each extra row was classed
against the other rows in its group:

| Class | Rows | Hand sample (stored text) |
|---|---|---|
| A. Same document, same name after punctuation, plural and "fee" are set aside | 90 | 10: 9 duplicate, 1 unclear |
| B. Same document, one name is the other plus one qualifier word | 24 | 7: 5 duplicate, 2 separate lines |
| C. Same document, different name | 1,326 | 14: 1 duplicate, 13 separate lines |
| D1. Two stored captures of one page, same or near name | 122 | 3: 2 duplicate, 1 unclear |
| D2. Two different documents, same or near name | 98 | 3: 2 same fee in two documents, 1 separate (personal and business schedules) |
| E1. Two captures of one page, different name | 676 | 5: 2 duplicate, 3 separate lines |
| E2. Two different documents, different name | 817 | 3: 3 same fee in two documents |

The sample covers 45 pairs. 19 are the same printed line published twice, 19 are separate printed
lines, 5 are the same fee printed in two different documents of the bank (a fee schedule and an EFT
disclosure, a PDF and a web page), and 2 are unclear. The classes come from SQL on names, documents and
URLs. Without a database connection in the session, `nearNames` and `linesApartOnPage` were not run
on the whole set, so the class sizes are not the number of rows the code would close.

All 122 rows in D1 have a partner whose document has `superseded_by_id` or `duplicate_of_id` set.
These are rows from an older capture of a page that stayed live beside the current capture's row for
the same line, because the two readings name it slightly differently. Examples are 117355 and 83484 (Dutch Point,
"Overdraft Transfer Fee from Primary Share - each transfer" with and without the dash) and 120373 and
101625 (FedChoice, "+" footnote mark). Across the catalog, 4,143 live rows come from superseded documents
and 863 from documents marked as duplicates. Those totals include fees that only the old copy states.

**Cause:** Two checks miss these rows.
- The exact duplicate collapse (`collapsePublishedDuplicates`) needs the same lower-cased name and agreeing frequencies.
- The near-name collapse from #1316 is switched off (`NEAR_NAME_COLLAPSE_LIVE = false`), and it only compares rows of one `source_document_id`.
- A newer capture keeps an old-copy fee live while the fee is still named in the newer copy (`newer-copy-retire.ts`). Nothing links the old row to the new row when the two names differ by punctuation.

**Fix:** Not yet.
1. Turn on #1316's collapse. In the sample, 14 of the A and B pairs were true duplicates. By its rules, #1316 would close 10 of them. It would keep the 2 separate "Stop Payment" / "ACH Stop Payment" lines through the #1303 page check. It would not touch the unclear pair (identical names with different frequencies). It would close none of the separate lines. The Oct 14 hand check on #1302 also passed (19 of 20, the miss fixed by #1328). Switching it on takes live rows down, so it is James's call.
2. A follow-up is needed for D1 and E1: run the same near-name and page check across captures of one page (the `superseded_by_id` chain), not only within one document.

**Lesson:** A duplicate check keyed on `source_document_id` misses the commonest repeat: the same page
captured twice. Key repeats on the page, meaning the document and its supersession chain.
