# 2026-11-02: a linked page's text was stored under the page that linked to it (live fee 134861)

**What happened:** Matagorda County CU (institution 8196) has live fee 134861, "IRA Administration Fee
(annual)", $25. The live-site audit (draw 275762) checked it against https://www.matagordaccu.com/online-payment,
a loan-payment page, and could not find it there. The fee is printed on /fee-schedule.
- Oct 6: Magellan's site crawl accepted /online-payment as the bank's fee page. The link said "PAY YOUR
  LOAN", its score was 0, and the page listed 3 ProPay convenience fees, which passed the 3-fee-line
  bar (`discover.site_crawl` attempt 299119).
- Oct 11 08:43: a Rosetta re-read of that page's copy (document 28470) escalated to the JavaScript
  fallback, because the bank's fees from `read.html_dom` had not held up. The fallback took the page's
  `linked_document` route to /fee-schedule. That page was not yet one of the bank's documents, so the
  `already_a_document` guard did not apply. Rosetta stored the schedule's text (artifact 25856, text hash
  5673984b...) under document 28470.
- Knox read 28 rows from that text. 18 are live, and each one names document 28470, whose
  `document_url` is /online-payment. The published row's own `source_url` is /fee-schedule. Anything
  that cites by `source_document_id`, such as the live-site audit, evidence and the stored copy, reaches
  the payment page.
- /fee-schedule later became documents of its own (29909, 31529, 38879 and 40745) with the same text
  hash. Knox never read them: its rule against re-reading the same text under another document skips
  them while 28470's rows exist.

**Size of the class (read-only prod SELECTs, Nov 2):** 4,285 live fees on 308 documents at 275 banks
have a latest stored text whose `source_url` differs from the document's `document_url`. Pages were
compared by host (lowercase, no `www.`, no :443/:80) and path (decoded, lowercase, no trailing slash).
| Class | Live fees | Documents | Banks |
|---|---:|---:|---:|
| Same page, only the query differs (`?print=1`, `?output=amp`, `_rt` tokens) | 2,138 | 165 | 147 |
| Same page, only cosmetic differences (spaces vs %20, :443) | 531 | 34 | 34 |
| Same page, its `/print` copy | 16 | 2 | 2 |
| **Another page, same host** (/rates -> /personal/fee-schedule/, /online-payment -> /fee-schedule, a page -> its PDF) | **1,303** | **87** | **81** |
| **Another host** (a CDN PDF: website-files.com, wsimg, bfldr, S3; southmet.com -> northwindsfcu.com) | **297** | **20** | **18** |
Truly different: **1,600 live fees on 107 documents at 99 banks**. 26 of the 107 are companion pages and
76 are current copies. All 107 were read by `read.js_fallback`. 106 took the `linked_document` route.
The last one (oceanfinancial.org) took `static_variant`: the page's `?print=1` copy redirected to a PDF. Because the fallback picks a PDF first, some
linked schedules are another product's: business schedules (glcu.org, tcbk.com, caccu.org), a privacy
policy PDF (goldmarkfcu.com) and loan rates (tucsonfcu.com).

Where those 1,600 fees could move:
- 1,235 fees on 75 documents: the linked page is already its own document at the same bank. On 65 of
  them (1,146 fees), that document's latest text has the *same text hash* as the borrowed text. On the
  other 10 (89 fees), the page has changed since.
- Only 320 of the 1,235 have a verified row on the page's own document with the same category and
  amount. Only 11 of those rows are live themselves. Knox's same-text skip is why the page's own copies
  are almost never read.
- 365 fees on 32 documents: the linked page is not a document of the bank's yet.

**Cause:** this is structural, in two places.
- Rosetta (`tryJsFallback` in `rosetta/read.ts`) stored any acceptable linked read as the referring
  document's text. The guard only knew pages that were already the bank's documents.
- Magellan's site crawl accepted a page whose link named a loan payment, because its processor fees
  passed the fee-page bar.

**Fix (this PR):**
- Rosetta, `tryJsFallback`: a read is this page's only when it is the same page (`sameDocumentPage` in
  `js-fallback.ts`: the same page key, or one is the other's `/print` copy). A linked page, another path
  or another host, including a static copy that redirected to one, is returned as a pointer
  (`linkedFeePage`) and never as this page's text.
- Rosetta, `settleReadInScope`:
  - A main fee link that has no fee page of its own (`wrong_document`) is pointed at the linked page
    (`pointFeeLinkAtLinkedPage`). This happens only while the link is still this page, no person has
    locked it, and the page is not on the bank's rejected list. Magellan's next fetch then downloads it
    as the bank's document.
  - In every other case (the page lists fees itself, it is a companion page, or the pointer could not
    be set), the linked page is stored in `institution_additional_sources` as `read.js_fallback.linked_document`
    (`registerLinkedFeePage`), and the companion fetch downloads it as its own stream.
  - Loan, privacy and other non-deposit links (Magellan's `isNonDepositLink`) are not stored.
  - The linking page is judged on its own text.
- Rosetta, no fee is taken down: when the document already holds a completed text read from another
  page (one of the 107), a new read keeps it (`kept_borrowed_text`). The read still stores the linked
  page, but writes no new text and does not send the bank back. Replacing that text would leave its live
  fees untraceable, and Hamilton's source check would take them down before the page's own document
  could carry them.
- Magellan, `findBySiteCrawl`: a page whose link label or path names a loan or bill payment
  (`namesPaymentPage`) is never accepted as the fee page, and its links are still followed. In the last
  45 days, 5 of the 6 accepted payment pages came from this crawl. The sixth, telcoccu.org's "Online
  Payment Service Fee Schedule" PDF, came from the companion finder, which this change does not touch.

`ROSETTA_JS_FALLBACK_VERSION` stays at 3. A bump makes reader replay re-read every current fallback
text, which is 1,714 texts (740 of them companions) at 4 a run. Under replay's not-worse rule, every
one would keep its earlier text, so the bump would change no stored text. New reads and the ordinary
re-reads get the new behaviour.

**Existing fees (follow-up, not in this PR):** the fees should move through the pipeline, not by a
hand edit:
1. Knox: the same-text skip should not block a page's own document when the earlier copy of that text
   is a borrowed one (its `source_url` is another page than its document's). The page's own document
   is then read, and Darwin verifies its rows.
2. Hamilton: when publish skips such a row as identical to a live fee whose text was borrowed from
   that same page, the live fee moves onto it in place (`moveLiveFeeInPlace`, as
   `current-copy-repoint.ts` does along a supersession chain). The fee keeps its id, name, amount and
   category. Nothing is published or taken down.
3. The 32 documents whose linked page is not yet a document need that page stored first. This PR does
   that the next time each one is read, or a one-pass Rosetta step can store the `linked_page` its last
   fallback attempt recorded.

Dry-run size of step 2: 1,146 fees on 65 documents, where the page's own copy has the identical
text. It should change no amount or category, because the move keeps them by construction, and take
down 0 fees. That is not measured by a replay yet. The 89 fees on changed pages and the 365 on
unregistered pages would go through ordinary publish, and they need their own count. A step that takes
any of them down needs Darwin's re-check, a sampled-clean dry run and an off switch.

**Not verified:** the forward change was not run against prod. The counts above are read-only SELECTs.
The per-page classification approximates percent-decoding in SQL (`%20`, `+`, `%28`, `%29`).
