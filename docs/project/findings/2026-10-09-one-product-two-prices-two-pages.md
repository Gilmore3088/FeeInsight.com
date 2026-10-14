# One product, two prices, two current pages

**Date:** 2026-10-09
**Found by:** Darwin, through the coordinator (institution 551, cbtn.com)
**What:** Citizens Bank of TN had two live paper statement fees for "Cash Back Checking". One was $5
from the compare-accounts page (doc 13386, fetched Oct 3) and the other $4 from the account PDF
(doc 20941, fetched Oct 7).
**Cause:** `decidePriorFee` treats a price on another page as its own fee line. That is right for
two products but wrong when both pages name the same product. 100434 went live at 02:05 Oct 9 when
guard requeue republished it beside 79432.
**Fix (guard v56):** `hamilton/cross-page-conflict.ts` (check `hamilton.cross_page_conflict`)
runs in every publish step. A pair must meet all of these:
- both fees are live at the same institution and in the same category, as dollar amounts that differ;
- both documents are current (not superseded);
- each document prints its own price for the fee under the same product heading, and not the other's.

A product heading is a short line naming one product, such as "Cash Back Checking". A section title
or one entry in a list of products does not count. The newer document's price stays. The older fee
is archived after the 12h second look with both document ids in its reason. Its verified row is
rejected and Hamilton's publish stage gets a `stale_price` lesson. Nothing is deleted.
**Dry run (read-only, 06:00 UTC):** 1,581 live fees sit at an institution where one category has
different prices on different documents. Exactly one pair qualifies: 551's paper statement fee
(100434 down, 79432 stays). Looser heading rules matched section titles ("Account Service
Charges"), lists of products and two copies of one text, so the rule stays narrow.
**Lesson:** "another page" is not "another product". The product heading decides.
