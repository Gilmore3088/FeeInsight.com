# Product-page benefit bullets published as $0 fees

**Date:** 2026-10-09
**Found by:** Top institutions thread, whole-record sample of 50 fees (/mnt/project-files/audits/whole-record-sample-2026-10-09.md, class 2)
**What:** Knox's free-fee reader reads a checking page's benefit bullets as the bank's fee. PNC's
Simple Checking page "$0 Overdraft Fees" went live as PNC's overdraft fee at $0. Northeast Bank's
"Free nationwide ATM access" went live as its non-network ATM fee. "Free Cashier Checks (Silver
Checking)" went live as one product's cashier's check fee.
**Size (read-only, 04:55 UTC):** 743 live $0 fees at 376 institutions were read by the free-fee
reader from a product or account page: an address naming checking, savings, personal, compare,
services and so on, with no schedule, disclosure, rates, fee, PDF, file or legal segment. The
reader has 3,227 live $0 fees in all, and most come from real schedules.
**Cause:** the free-fee reader takes any "Free X" or "$0 X" bullet on any page Magellan linked. A
product page lists one product's perks, not the bank's fee schedule.
**Fix:** `hamilton/product-page.ts` (check `hamilton.product_page`) archives these after the 12h
second look, rejects the verified row, and gives Knox a `not_on_schedule` lesson. Publish skips new
ones. It is off (`PRODUCT_PAGE_TAKEDOWN_ON = false`) until James answers "Product-page $0
benefits: Keep or Take down" on the Oct 9 punch list. While off, each publish step records the
count it would flag. The dry-run list is /mnt/project-files/audits/product-page-benefits-dry-run-2026-10-09.csv.
**Lesson:** a $0 line counts only when it comes from the bank's schedule. A marketing page's "free" is a
product claim.
