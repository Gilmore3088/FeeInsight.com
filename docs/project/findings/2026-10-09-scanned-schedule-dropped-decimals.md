# 2026-10-09: A scanned fee schedule dropped its decimal points
**What happened:** Central Bank (institution 1192, document 4422) had six fees live at 100 times
their likely price: temporary checks $200, photocopy $200, notary $500, ACH software $2,500, lost
safe-deposit key $1,000 and safe-deposit late fee $1,000. The same page prints other fees with
cents ($5.00, $15.00, $100.00). Top 50 found the $1,000 late fee on 2026-10-09.
**Cause:** the scan's text lost the decimal point ("$1000" for "$10.00"). The source check traces
"$1000" to the line as written, so nothing flagged it.
**Fix:** guard v52 adds price ceilings for counter checks ($100), copies ($100), late payment
($250), notary ($300) and a lost or replaced safe-deposit key ($300). A fee above a ceiling fails
as `amount_implausible`, which means flag, a 12h second look, then archive. It is never
re-priced, because the true price is inferred. The $2,500 ACH software fee is left alone, since
a real software fee could cost that. Seven live rows match (read-only SQL). This PR.
**Lesson:** tracing a price to its line proves the text says it, not that the text is right. A
scanned page needs a plausibility bound per category.
