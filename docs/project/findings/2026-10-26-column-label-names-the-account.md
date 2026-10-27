# 2026-10-26: a price labelled for one account traced a fee named for another
**What happened:** Capital City Bank's savings comparison table prints its IRA closing fee, "$50 fee
to close prior to maturity", in the IRA column, with the CD column's cell beside it empty. Rosetta
dropped the empty cell, so the value sat under the CD column's "Early withdrawal penalty (CD)", and
the paid read filed it as "Early closure of CD" (live fee 140269, text 29131, #1912). #2737 fixed
the reader: the shifted value is now written with its column's name, "$50 fee to close prior to
maturity (ira)". The shared source check still traced the CD fee to that line, so the live fee would
pass every re-check after its document is re-read.

**Cause:** `checkFeeAgainstSource` matched the fee's words and amount anywhere on the line; nothing
read which account the price's own cell belongs to.

**Fix:** `column-account.ts` `pricedForOtherAccount`: when every cell of the traced line that prints
the amount closes with an account label in parentheses, and each label names a different account
than the fee's own name (money market, IRA, HSA, CD or certificate, checking, club, savings), the
check fails with `amount_not_the_fee`. A fee name that names no account, an unlabelled cell with the
price, or a label carrying a figure ("(Share minimum of $25.00)", a condition) decides nothing.

**Dry run** (prod, read-only, Oct 26): 552 live fee and line pairs where the fee's amount appears in
a cell closing with a parenthetical and the fee's name names an account. 3 lines are labelled for
another account (fees 44086, 84048 and 93262); each fee traces to its own line elsewhere in its
text, so 0 live fees change today. 140269 fails once its document (31378) is re-read under #2737's
reader; the bank's IRA closing fee is already live as fee 90972.

**Lesson:** a price labelled with an account's column is that account's price.

**Agent lesson:** darwin/issue-1912-column-label-names-the-account
**Guard:** `src/lib/custom-report/column-account.test.ts`
