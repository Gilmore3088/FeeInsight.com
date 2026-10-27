# 2026-10-27: Thin banks are held for thin documents, not for wrong holds

**What happened:** 1,230 active banks had verified fees but fewer than 3 fee types, so Hamilton
never published them (prod read, Oct 27). These banks had 6,646 Knox rows with no Darwin
decision. 2,856 were Knox `unclassified` (700 banks) and 2,449 were set aside (648 banks). The
most common "names" were sentence fragments ("there", "fee", "you will receive reimbursements up
to"). 1,451 rows (506 banks) were sent to Darwin, and the latest rules decision held them:
category mismatch 563, outside the range 260, not in source 176, duplicate 131, peer outlier
71. A sample of the held names showed that most of these holds are right. The lines are balance
thresholds ("minimum balance to avoid service charge" $2,500), fragments, or money market and
savings fees (James's open audience call). One class was wrong: a monthly fee whose waiver
clause names e-statements ("monthly service charge (waived with enrollment in eStatements)" $5)
was blocked as a statement fee. The companion documents of these banks are read (1,033 of
1,045) and extracted (882), so the stall is not in reading.
**Cause:** the monthly_maintenance guard excludes any name that contains "statement", including
a statement named only in the waiver clause. Beyond that, the documents these banks have are
account agreements and product pages that print one or two prices.
**Fix:** category guard v102 (this PR). It ignores a statement named after "waive"/"waived" in a
monthly fee's name, and keeps fees for paper documents out. Dry run on the 73 held
monthly-maintenance rows whose name says "waive": 22 passed the guard before, 47 pass now, and
0 live fees come down (no live fee is named "paper document"). The bigger fix for these banks is
new documents: plan steps 3 and 4 (replace wrong links, search for the missing fee types).
**Lesson:** before loosening a hold to publish more banks, read what the hold is holding. Here
the 3-fee rule and Darwin's holds were mostly right, and the missing piece was the bank's
schedule of fees.
**Guard:** `src/lib/fee-category-guard.test.ts` ("v102 keeps a monthly fee whose waiver clause
names e-statements").
