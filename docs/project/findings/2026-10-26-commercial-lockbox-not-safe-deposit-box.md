# 2026-10-26: a commercial lockbox service went live as a safe deposit box
**What happened:** Forte Bank's fee table (institution 2078, document 29204) prints "Lock Box Service,
per month | $225.00". A commercial lockbox is a remittance-processing service for businesses: the bank
collects the payments a business's customers mail to a post office box and deposits them. The same
page says "Fees not included in this table: Safe Deposit Boxes". Knox filed the row as a safe deposit
box by its "lock box" words, and it went live as fee 135270, a $225 monthly "box" beside boxes that rent
for $12 to $60 a year (#1912).

**Cause:** Knox's category list filed any name containing "lock box" as a safe deposit box, and the
category guard's safe deposit box rule accepted any name. Many banks do call a safe deposit box a lock
box, so the words alone cannot decide it. All 18 other live lock box rows name a size, a key, drilling,
rent or a late charge: "Lock Box Rental 5x5", "Lock Box Annual Fee 3 x 5", "Lock box past due date late
fee" (AIM CU 144459, printed under "Lock Box Lease" with its sizes). The held raw row 184905, "Lock Box
Late Payment Fee - per month" $2 (institution 2490, document 16480), is printed beside "Lost Safe Deposit
Key" and "Safety Deposit Box Rent": it is the box's late fee, not a commercial lockbox.

**Fix:** `custom-report/commercial-lockbox.ts`. A lock box name that names the service (service,
processing, items, remittances, wholesale or retail) and nothing of a box (a size, a key, drilling, rent,
a lease, a year, a late or past-due charge, a safe deposit or a vault) is a commercial lockbox
(`COMMERCIAL_LOCKBOX_NAME`). A lock box name with no box words is also one when its stored line says so
("Lockbox | $50.00 | plus $0.25 per item") or it sits under a business, treasury or cash management
heading with no box row between (`commercialLockboxOnLine`). Knox v132 gives such a name no category and
holds any specialist's safe deposit box read of one unclassified. Guard v100 refuses it as a safe deposit
box, by name or by the stored-text flag `commercial_lockbox` that `withCollectionSection` reads for
Darwin's verify, Hamilton's live guard and the restore bar. None of the 50 types holds a lockbox service,
so `refileFromLine` re-files it nowhere and the fee comes down through the guard's second look.

**Dry run** (prod, read-only SELECTs on `published_fee_catalog` and `agent_source_texts`, Oct 26): 7,759
live safe deposit box fees; only the 19 whose names contain "lock box" can change verdict (both checks
need those words; a 20th, "Change Lock/Box Drilling" 92516, does not match and is unchanged). Old guard
v99 vs new v100 on those 19 with their stored text: 1 fails (135270, taken down), 0 re-file, 18 stay
safe deposit boxes. The 2 live lockbox rows in other categories (102754, 144194, document reproduction)
are unchanged. The answer-key gates are unchanged.

**Lesson:** "lock box" names two things: look for the box (a size, key, drilling, rent or late charge)
before filing a lock box as a safe deposit box; a lock box service with no box is a business's
remittance processing, which no fee type holds.

**Agent lesson:** knox/issue-1912-commercial-lockbox
**Guard:** `src/lib/custom-report/commercial-lockbox.test.ts`, `src/lib/agents/knox/commercial-lockbox.test.ts`
