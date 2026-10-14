# Returned bonds and coupons were filed as NSF (Oct 9, 2026)

Darwin's dry read for PR 883 found "Bond return items" $35 (raw 246460, institution 67) passing the
v57 guard as NSF. A returned savings bond or coupon is a deposited item coming back to the
customer, not the customer's own NSF fee. The same name shape is live at institution 4444:
"Bond/Coupon Returned Item Fee" $45 (83677). The nsf guard accepted these names ("returned item"),
and the deposited_item_return guard rejected them.

Fix, guard v58 (`src/lib/fee-category-guard.ts`):
- nsf excludes a name with "bond" or "coupon".
- deposited_item_return accepts a bond or coupon named with a return.
- The nsf -> deposited_item_return re-file rule covers bonds and coupons.
- Hamilton's restore re-files a takedown under nsf -> deposited_item_return only when the name says
  bond or coupon (`RESTORE_REFILES` is now a checked pattern per rule). That rule's older names
  ("deposit", "written to you") were never spot-checked.
- Darwin's `DARWIN_CATEGORY_HOLDS` entry for bond returns is dropped. Its re-select clause brings
  246460 back under v58.

In the same version: Westamerica's 96164 is "balance requirement to avoid the monthly service
charge is met. Otherwise, a fee of" at $2.50, filed as monthly maintenance. The schedule (doc 17065)
prices a non-Westamerica ATM withdrawal there. A waiver sentence's "Otherwise, a fee of" no longer
passes as monthly maintenance. The name does not say ATM, so no name rule can place it; a new
`HAND_REFILES` list in `hamilton/category-guard.ts` brings it back as atm_non_network after its
takedown, only at $2.50.

Live rows guard v58 newly fails: 83677 and 96164. Both come down through the second look and come
back re-filed. Checked against source: 246460/37701 "Bond return items" $35 (Collection Items
block), 118545/277863 "Bond/Coupon Returned Item Fee" $45, 36810 "Bond Coupon Returns" $15 per
envelope, 441800 "Returned Bonds" $35, and 96164. That is 6 of 6 distinct fees.
