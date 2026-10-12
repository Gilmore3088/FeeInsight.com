# Rules re-check treated distinct same-priced fees as copies

**Found:** 2026-10-10, Pinnacle Bank (institution 47), recorded in #978.
**Fixed in:** the PR that adds this file.

## What happened
`rollBackUnreproducedFees` in `src/lib/agents/hamilton/rules-recheck.ts` kept one live fee per
document for each category and price (`feeKey(canonical_fee_key, amount)`). Any second live fee
with the same category and price was flagged as an older copy. That ignored the fee's name, its
audience and how many lines the text states. Pinnacle's legitimate $30 overdraft Paid Item fee
(#121441) was flagged on 2026-10-10 15:02 UTC beside a repeated paragraph of the same charge
(#121442). The flag cleared on 2026-10-11 04:26 UTC once the repeat was taken down by the
same-line-duplicate check, so no legitimate fee came down. The same key also blocked restoring a
distinct fee that shared a category and price with a live one.

## Fix
Live fees now claim the text's own lines. Today's rules return every name they read under a
category and price, so a document with "Overdraft Fee (consumer) | $30" and "Overdraft Fee
(business) | $30" holds two lines, and both fees stay. A fee is a copy only when the line it is
named as is already held, or when no unclaimed line is left. Consumer and business publications
of one line claim separately. Restores use the same claims.

## Lesson
A fee's identity is its line in its source (name, audience, document), not its category and
price. Two real fees at one bank often share a price.
