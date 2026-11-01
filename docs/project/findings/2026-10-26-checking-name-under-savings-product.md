# 2026-10-26: a checking fee filed under a savings-named product was set aside
**What happened:** statistics rule 11 keeps a savings, money market, club or IRA account's own
monthly maintenance or minimum balance fee out of the bank's checking value. It decided this from
`account_product_type` alone, so a fee whose own name says checking was set aside when Knox filed it
under a savings-sounding product: "Share Draft Checking Service Monthly service charge" under
"Share Value" (institution 5141) and "Monthly Maintenance Fee (on dividend checking)" under
"Membership Savings Accounts" (5958) (#1912).

**Cause:** `isProductException` and `productExceptionSql` (`fee-product.ts`) never read the fee name
for the two account-priced categories.

**Fix:** statistics method 27/28. In `monthly_maintenance` and `minimum_balance`, a row whose fee
name says checking, share draft or demand is not an exception, whatever its product. The SQL twin
reads the same words from `fee_name`.

**Dry run** (prod, read-only, Oct 26, the SQL twin over every approved catalog row): 2 rows leave
exception status (87791, 112079) and none enter. Each is its institution's only monthly
maintenance row, so no institution value changes today; the rule keeps future rows of this shape
in the checking value.

**Lesson:** a fee that names checking is a checking price, whatever product it was filed under.

**Agent lesson:** hamilton/issue-1912-checking-name-is-checking
**Guard:** `src/lib/fee-product.test.ts`, `src/lib/data-store/fee-stats.test.ts`
