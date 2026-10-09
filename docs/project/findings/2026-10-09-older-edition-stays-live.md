# An older edition of a bank's schedule stays live beside the current one (Oct 9, 2026)

Valley (44) shows two live overdraft fees: $35 from its 2026 deposit agreement (doc 23731, Last-Modified
25 Mar 2026) and $30 from the 2025 edition (doc 23743, Last-Modified 17 Mar 2025). The two editions sit
at different URLs under two sources (2886 and companion 2295), so Magellan never marked one as superseding
the other, and both count as current.

The cross-page rule (guard v56) missed it for two reasons:
- It needed a shared product heading, and an overdraft line has none.
- It picked the newer document by fetch time. The 2025 edition was fetched at 07:13, five minutes after
  the 2026 one, so fetch time would have kept the old $30.

Fix (`hamilton/cross-page-conflict.ts`):
- "Newer" is the document's own Last-Modified date when both documents carry one. Otherwise it is fetch
  time, as before.
- A pair also qualifies with no product heading when the two texts are editions of one document. That
  means they share at least 95% of the larger text's words, the texts differ, and their Last-Modified
  dates are at least a day apart. Each must print its own price on a line naming the fee, and neither
  may print the other's.
- The ratio is measured against the larger text. PNC's Simple Checking schedule shares 98% of its own
  words with PNC's full schedule but only 73% of the full schedule's words. It is one product's schedule,
  not an older edition, so its $0 overdraft line is left alone.

Dry read on prod data (07:45 UTC, 1,612 live fees in categories priced differently on two current
documents): 5 rows would come down, each through the 12h second look. A hand check found all 5 right:
- 100434: Citizens Bank of TN, $5 on the compare page vs $4 in the PDF.
- 95032: Bank of Hawaii stop payment, $30 in the Rev. 01/2025 edition vs $35 in the Rev. 7/27/2026 one.
- 90339: drill fee at institution 4593, $120 effective 2023 vs $130 effective June 2026.
- 103414 and 103413: Valley overdraft $30 vs $35, and expedited card delivery $25 vs $35.

Magellan marking 23743 as superseded by 23731 would also work, but only for this pair. This rule catches
every bank that keeps last year's PDF online.
