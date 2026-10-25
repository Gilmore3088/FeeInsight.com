# 2026-10-25: lines of the schedule in force today stayed unpublished behind a held next edition

**Lesson:** A line skipped as identical to a fee is settled only while that fee stays up for a
reason about the fee. When the kept copy comes down because its document is not yet in effect,
decide the skipped line again, but only a schedule's line: a product page's line prices one account
and cannot stand in for the bank's fee.

**Agent lesson:** hamilton/issue-1915-edition-hold-twins

**Guard:** `src/lib/agents/hamilton/publish-selection.db.test.ts` (`editionTwin` selected again,
`productPageEditionTwin` left decided), `src/lib/agents/hamilton/publish.test.ts`, and the ONE
Credit Union boundary tests in `src/lib/agents/darwin/edition-effective-check.test.ts`.

**What happened (#1915, PR #2531):** on Oct 11 ONE Credit Union (7174) published its 2027 schedule
(doc 28999) and its current one (doc 29000, "Effective November 1, 2024") in one step. The 2027
rows went first, and 16 verified lines of doc 29000 were logged `unchanged` ("Identical fee already
published") against them. On Oct 21 Darwin's edition check (#2523) rolled the 2027 rows back as
`not_yet_effective: 2027-01-01 #28999`. Publish's no-replay filter never selects a decided
`unchanged` row again unless its kept copy came down for a listed reason, and `not_yet_effective`
was not one, so the bank kept one live fee (Visa Gift Card $5).

**Fix:** `EDITION_HOLD_RESELECT_SQL` in `src/lib/agents/hamilton/publish.ts` re-decides such a row.
A row from a schedule itself not yet in effect is still held by `selectEditionHolds` and waits for
its date. A row read from a product page (Rosetta's kind `product_page`, or a product-area address,
`productPageUrlSql`) stays decided: Security Federal's (722) "Paper statements available for $3 per
month" on docs 25730/25731 is the Money Market account's price (the same page prices Regular
savings statements at $1.00 a month), and the read carries no product.

**Dry run (prod, read-only, Oct 25):** 91 verified rows are selected again, all of them blocked on
main. 16 at 7174 (doc 29000, in effect) would publish. 75 come from schedules effective Dec 1, 2026
(5297 docs 16640/23342, 722 docs 316/16682) and stay held until that date. The PR's Oct 21 run had
93; the 2 Security Federal product-page rows are the difference.
