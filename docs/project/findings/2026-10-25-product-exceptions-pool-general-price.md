# 2026-10-25: an institution's value pooled a named account's exception price with its general price

**Lesson:** An institution's statistics value for a category is one price its customers pay. When
it states a general price and also a price for one named account as an exception (U.S. Bank's Safe
Debit money order at $1.65 beside the general $5.00), the value rests on the general rows; the
exception stays on the bank's page as that account's own fee. With no general row, the named
accounts' prices count as before. Monthly maintenance and minimum balance are priced per account,
so a product name there is never an exception.

**What happened (#1911, numeric-policy phase):** PR #2179 gave Knox, Darwin and publication
ancillary product ownership: a fee read from one primary account's document (U.S. Bank's "Safe Debit
Pricing and Information") carries that product to `raw_fee_observations.product_name`, which
`published_fee_catalog` exposes as `account_product_type`. Nothing downstream used it. The
statistics contract (`src/lib/data-store/fee-stats.ts`, rule 2) took the median of every counted
row, so U.S. Bank's ATM value was $2.75 ($2.50 Safe Debit + $3.00 general) and its money order
$3.325 ($1.65 + $5.00), prices no customer is charged.

**Cause:** the per-institution reducer (`valuePerInstitution`, `institutionValue`) and its SQL
copies (`CASE WHEN overdraft THEN MAX ELSE percentile_cont END` in market-study, state-visuals,
local-market and Hamilton's studies) had no notion of applicability. Product metadata alone does
not choose a benchmark policy (#1911 body).

**Fix:**
- `isProductException` and its SQL twin `productExceptionSql` (`src/lib/fee-product.ts`): a row
  with a non-blank product in a category other than `ACCOUNT_PRICED_CATEGORIES` (monthly
  maintenance, minimum balance). Knox's ancillary owner reads the same constant.
- `statisticsRows` (`src/lib/fee-institution-value.ts`): general rows when any, else all rows.
- Statistics rule 11 (`fee-stats.ts`): `valuePerInstitution` and `summarizeRates` apply it;
  `STATS_SCHEDULE_KEYS` selects `product_exception` for every reader whose rows reach
  `summarizeFees`; `institutionValueSql` is the one SQL aggregate (general rows through `FILTER`,
  `COALESCE` back to all rows) that market-study, state-visuals, local-market and Hamilton's study
  prices now use. `STATS_METHOD_VERSION` 19 -> 21 so cached figures recompute.
- The institution page's headline value, `getInstitutionOwnFees`, `getOwnFeesForInstitutions` and
  `getFeeValuesForInstitutions` follow the rule. Exception rows stay listed, named with their product
  ("Personal money order (Safe Debit Account)", `own-fee.ts` `ownFeeName`).
- Darwin's peer envelopes (`darwin/peer-checks.ts`, `darwin/learned-envelopes.ts`,
  `state-expert/memory.ts` state peer levels) are unchanged: they decide which fees verify, and a
  change there would need its own Darwin dry run. This change moves statistics only; no fee is held,
  re-filed or taken down, so there is no Darwin re-check.

**Live effect (read-only, 2026-10-25, `published_fee_catalog` under `statsRowFilter` and active
institutions):** 57,987 institution/category values; 17 hold an exception row (17 rows); 1 also
holds a general row. One value changes: Iowa State Bank (1899) excess withdrawal, $6.00 to $2.00
(general savings $2.00 beside the Invest@Home Money Market $10.00). U.S. Bank's live rows still
carry no product (PR #2179 does not repair existing NULL metadata), so its values stay $2.75 (ATM)
and $3.325 (money order) until the separately authorized current-data recovery phase assigns
the Safe Debit product; then they become $3.00 and $5.00.

**Not yet known:** whether every unassigned row beside a named exception is truly the general
price, or an unlabeled second account. Today one live value depends on that judgement.

**Agent lesson:** hamilton/issue-1911-general-over-product-exception

**Guard:** `src/lib/data-store/fee-stats.test.ts` ("general price over product exceptions"),
`src/lib/data-store/product-exception-value.db.test.ts` (SQL and TypeScript agree)
