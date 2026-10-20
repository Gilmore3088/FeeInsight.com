# 2026-10-14: Knox's extraction note leaked through the reader filter
**What happened:** Knox writes its provenance note ("Knox deterministic extraction from Rosetta
artifact #N. canonical_hint=...; text_hash=...; excerpt=...") into `conditions`. On 2026-10-14
(read-only SQL, about 10:17 UTC) 74,866 of 76,550 rows in `published_fee_catalog` and all 824 rows
in `published_fee_rate_catalog` held only that note. A reader filter (`readerFeeConditions`)
already existed, but its pattern stopped at the first dot, so a note that opens "Knox extract.rules
v65 ..." got through: 1,075 live dollar fees. Several readers (fee category detail, Hamilton's own
fee rows and evidence export, the subscribe benchmark, the raw-fee preview on institution pages
and the evidence API) did not use the filter at all.
**Cause:** the note is stored in a customer field, and each reader had to remember to filter it.
**Fix:** #1234 step 1 and 3: one helper (`src/lib/fee-conditions.ts`) parses every note shape Knox
writes and keeps the bank's own text, every customer data-store reader uses it, and
`src/lib/data-store/customer-fee-conditions.test.ts` fails if a reader returns a note. Step 2
(moving the note out of `conditions`) needs a migration and waits for James.
**Lesson:** a pattern over pipeline text needs a test against every live shape (query the
distinct shapes first), and a field shared by pipeline and customers needs a test at the readers,
not only at the helper.

**Guard:** `src/lib/data-store/customer-fee-conditions.test.ts:112` (every customer fee reader drops Knox's extraction note from conditions and keeps the bank's own text)
