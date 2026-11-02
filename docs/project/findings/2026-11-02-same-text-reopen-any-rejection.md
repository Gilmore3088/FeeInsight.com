# 2026-11-02: The same-text reopen would have reopened copies rejected for reasons it does not undo

**What happened:** James asked why the waiting `*_LIVE` switches were not on. We sampled
`SAME_TEXT_COPY_REOPEN_LIVE` (#2477, PR #2643) on prod, read-only, with seed `sw-2026-11-02`. The
backlog pass covered 709 current copies at 637 banks: texts marked `wrong_document` whose older copy of
the same page holds the same text and Knox rows. 19 of the 20 sampled were account pages that print
real fees. The 20th, PUD FCU text 2480 (doc 15405, a truth-in-savings page), had been rejected as "No
fee lines and only 2 dollar amounts: not a fee schedule". Its older copy's only Knox row was "The
minimum balance to open the account is 1000.00", which Darwin never verified. Reopening it would send
a page with no fees back to Knox. The other copy rejected for a reason besides the product-page rule
is text 16616 ("A news or investor article").

**Cause:** The rule was written to undo one rejection: the product-page rule (#1053) turning down a
newer copy whose text matched an older copy Knox read. The backlog query took every `wrong_document`
text with a same-text Knox copy, whatever the rejection said. An older copy's Knox rows show only that
Knox once read the page. They do not show the page holds fees.

**Fix:** `SAME_TEXT_COPY_STRATEGY` v2 (`src/lib/agents/rosetta/same-text-copy.ts`): the reopen takes only
texts whose `error_message` opens with `PRODUCT_PAGE_REASON_PREFIX`. The prefix is now exported from
`src/lib/agents/learning/fee-page.ts`, which builds the rule's own reason from it, so the two cannot
drift apart. Re-count (prod, read-only, Nov 2): 707 copies at 635 banks.

A fresh sample of 20 (seed `sw-2026-11-02b`) is clean. Every text prints account fees (monthly service
charges, statement or check image fees). In 19 of the 20, the identical older copy holds a fee Darwin
verified against that same text. The 20th (Security State Bank) has no verified fee, but its text still
states "a $6.00 a month service charge" when the balance is below $10,000. `SAME_TEXT_COPY_REOPEN_LIVE`
is on.

**Not changed:** The read-time rule (`sameTextCopyOf` in `read.ts`, and triage) still spares a new read
from any fee-page rejection when an identical older Knox copy exists. It was on before this change and
is outside this switch. #2477 tracks whether it should name the product-page rule too.

**Guard:** `src/lib/agents/rosetta/same-text-copy.test.ts` ("v2: reopens only copies the
account/product-page rule rejected"). Agent lesson: rosetta/same-text-reopen-only-the-rule-it-undoes.
