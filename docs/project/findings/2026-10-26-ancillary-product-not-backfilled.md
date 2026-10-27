# 2026-10-26: live fees read before Knox's ancillary ownership kept no product
**What happened:** Knox's ancillary product ownership (#2179, `ancillary_product:v1`) gives a fee
printed in a single-product document's own fee block that product ("Safe Debit Account"). It labels
only newly inserted raw rows: the insert conflict update is off for owned candidates (`AND ${!owner}`
in `extract.ts`) and the lineup fill skips them (`&& !owner`), both "for explicit recovery". No such
recovery existed, so fees already live kept a NULL `product_name`. On Oct 26 (read-only), exactly two
live fees qualified: U.S. Bank (institution 5) published 142603 / raw 678084, "Personal money order"
$1.65, and 142604 / raw 678085, "Non-U.S. Bank ATM transaction fee" $2.50, both from the Safe Debit
Account document 33344 (text 31406). The catalog's `account_product_type` reads `fr.product_name`,
so both showed as fees of U.S. Bank's general accounts beside its $5 money order and $3 ATM fee.

**Cause:** the labelling rule shipped as an insert-time rule only. Re-running existing rows cannot
recover the label, by design, and no step re-read the rows already live.

**Fix:** `correctAncillaryOwners` (`src/lib/agents/knox/ancillary-owner-correct.ts`, strategy
`knox.ancillary_owner_correct` v1), run in Knox extract steps scoped to one bank or one state lane
(an unscoped step skips it). It re-reads the current text of
each document with a live Knox fee whose raw row has no product and fills `product_name` and the
`ancillary_product:v1` flag only where `withAncillaryProduct` witnesses the fee in the named
product's block, and only while `product_name` is NULL. One `pipeline_feedback` row per change keeps
the old and new values; attempts are keyed by version and text id. Applying waits for
`KNOX_ANCILLARY_OWNER_CORRECT_LIVE` (off by default); off, the step counts and lists only.

**Lesson:** when a new labelling rule lands, re-read the rows already live, not only the new reads.

**Agent lesson:** knox/issue-1911-ancillary-owner-recovery
**Guard:** `src/lib/agents/knox/ancillary-owner-correct.test.ts`
