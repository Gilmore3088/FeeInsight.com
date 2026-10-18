# 2026-10-17: Fee links answered 304 for another page's copy were never stored
**What happened:** Dupaco Community CU (IA #9 by deposits, nothing live) has had its real fee
schedule link (`/hubfs/dupaco-credit-union-fee-schedule-miscellaneous-fees-jan-15-2025.pdf`) since
Oct 13. Magellan's plain fetch logged it "unchanged" on Oct 13 and Oct 15 (HTTP 304) against
document 21715, which is the checking-accounts page, so the PDF was never stored or read.
Prod (SELECT only, 2026-10-17 08:40 UTC): since the first 304 on Oct 3, 219 `fetch.http` attempts
at 219 institutions were answered 304 and recorded against a stored copy of a different address
(after ignoring scheme, `www.`, query and trailing slash). 75 of those addresses have no stored
copy at all; 23 of those 75 institutions have nothing in `published_fee_catalog`, and for 30 the
address is still the fee link.
**Cause:** `loadPreviousDocument` (`src/lib/agents/magellan/fetch.ts`) takes the institution's
latest stored document of any address, and the fetch sent its ETag and Last-Modified with the
request for the fee link. A server compares If-Modified-Since with its own file date, so a
checking page dated May 2026 makes any older PDF answer 304. The 304 was then read as "the stored
copy is current" and that other page was marked the current copy.
Separately, the companion fetch (`companion-fetch.ts`) reused a stored document with the same
bytes without putting those bytes in the vault when the reused copy predated the vault. Alliant
FCU's fee PDF (doc 1933, Feb 2026) was fetched again by the paid companion fetch on Oct 17
(215,719 bytes) and the bytes were dropped; Rosetta's read of doc 1933 had already failed with
HTTP 403 on the live link. Over Oct 3-17, 17 reused companion copies had no vault copy; 5 of them
have no completed text.
**Fix:** PR on branch `acct2/top10-coverage`: validators go only to the address the stored copy
came from (`sendsValidators`), and a 304 counts as unchanged only after our own validators; the
companion fetch stores the bytes when the reused copy has no vault key. Not merged at the time
of writing.
**Lesson:** an HTTP validator belongs to one address. When code keys a "previous copy" by
institution rather than by address, check every place that uses it as if it were that address's.
