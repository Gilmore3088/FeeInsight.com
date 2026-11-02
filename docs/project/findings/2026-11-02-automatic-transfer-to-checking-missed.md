# 2026-11-02: an automatic transfer into checking was missed, misfiled or refused (W45 live check, Citizens Savings Bank IA)
**What happened:** James's W45 live check of Citizens Savings Bank, Spillville IA (institution 3416,
document 38158, stored text 36274) found two fees printed on the bank's fee schedule page with no live
fee:

> Automatic Transfer of Funds to a Checking Account- $3.00*
>
> Debit Card Service Charge- $1.00 per month*

**Cause 1 (Knox, categorisation, and the category guard):** the transfer is an overdraft protection
transfer (savings or another account into checking), but its name has no overdraft word. Knox's
`od_protection_transfer` patterns wanted an overdraft, OD, protection or sweep word, or "transfer(s)
from savings to checking"; this name has "of Funds to a Checking Account" and none of them. With no
category and no fee word on a dash row, the rules pass dropped it (`no_fee_word_not_table_row`). The
same class shows up two more ways on other banks' stored texts: "Automatic transfer from savings to
checking | $3.00" (3950) and "... | $5.00 per transfer" (1841) were read as the transfer and then refused
by the category guard, whose `od_protection_transfer` include also wants an overdraft word; and
"Automatic Transfer of Funds from Savings to Checking (for overdraft protection) | $4.00" (2718, 2233)
was read as the overdraft fee, which the guard refused (both of those are live as the transfer now, by a
later correction).

**Fix (Knox v161, guard v105):** `AUTOMATIC_TRANSFER_TO_CHECKING` in `src/lib/fee-fold.ts`, shared by
Knox's rules (before the overdraft rule) and the guard's `od_protection_transfer` include. A name that
opens with an automatic transfer into checking, from savings or shares or from nowhere named, is the
transfer. A two-way service ("Automatic Transfer to Checking or Savings", "... Savings to Checking or
Checking to Savings") is a scheduled transfer and stays out, as do a transfer out of checking and a name
that mentions the transfer only later ("Fee for automatic transfer of funds to checking in $50
increments"). The guard change only accepts more, so no live fee comes down and Darwin needs no new
take-down re-check; rows rejected under v104 for this name are judged again. The Knox bump re-reads
stored texts.

**Cause 2 (taxonomy, by design):** the $1 a month debit card charge is held unclassified, and stays so.
Guard v70 (`CARD_PRODUCT_FEE`, `CARD_PRODUCT_TAKEDOWN_LIVE`, James's yes on Oct 17) says none of the 50
types holds a card's monthly, annual or maintenance fee; `card_replacement` is only a replacement. Filing
it would need a new type, which is James's call. Read-only on prod (Nov 2): 27 stored texts at 11
institutions have a "debit/ATM/check card service charge or fee ... $x per month" line.

**Sizing (prod, read-only, Nov 2):** over all stored texts (split into lines and into Rosetta's table rows), 14 institutions have a line that opens with
the phrase. 2 are live as the transfer already (2233, 2718); 5 are two-way rows and stay out (118, 595,
2903, 3017, 3043); 2 are a description or feature list with no price (175, 3822); 1 is a $0 row at a bank
with another live transfer fee (3262); 4 are priced rows at banks with no live transfer fee and are
read and accepted now: 3416 ($3), 3950 ($3), 1841 ($5 per transfer), 4943 ($5). No live fee outside
`od_protection_transfer` has a name the rule matches. Knox before and after, on the stored lines of 19
banks with the phrase anywhere in their text: 7 reads change, each checked against its own line (the
four above, 2233 and 2718 moved from overdraft to the transfer, 3262's $0 row read); nothing else moves,
and no new read is a false fee.

**Not fixed here:** on the same page Knox reads "Debit Card Cash Withdrawal at ATM- $210.00 per day" (a
withdrawal limit) as a $210 non-network ATM fee; it is not live (a later step stops it), but the read is
wrong and belongs to the limit rules.

**Agent lesson:** knox/w45-live-check-2026-11-02-automatic-transfer-and-card-monthly
**Guard:** `src/lib/agents/knox/automatic-transfer-checking.test.ts`

**Review follow-up (PR #2932):** the guard's `include` uses an unanchored form (`AUTOMATIC_TRANSFER_TO_CHECKING_ANYWHERE`), because the shared source check tests a category pattern against the fee's line joined after the rows above it; the anchored form made the release pass and hold re-read refuse Citizens' own line (`category_not_in_text`). The two-way exclusion also covers "and", "/", "&", ", savings", money market and loan. Knox keeps the anchored form so only names that open with the transfer are filed.
