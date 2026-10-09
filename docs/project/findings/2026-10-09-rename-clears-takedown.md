# A name retidy cleared takedowns on rows that were still wrong (Oct 9, 2026)

UAT rated PR 864 partly done because hand-checked row 100161 never reached takedown_pending. City
National's $0 cashier's check is still wrong; the schedule price is $30. Knox's name retidy (v10, PR 868)
renamed it at 08:18 from "(APY) are available at any of ... banking: Cashier's Checks" to "Cashier's
Checks". The eval-verdict check only judges a labelled row while its name matches the label, so at
08:23 it cleared the flag. The $0 stayed live under a clean name.

The same happened to name-rule takedowns. Each rule judges the fee's name, and a retidy strips the
words the rule reads:
- 13878 and 88374: "ATM receipt must be presented for reimbursement of an individual ATM fee of" at
  $5, a rebate, became "ATM fee".
- 60387 and 75915: a $0 waiver ("Monthly Service Charge if any of the following qualifications are
  met") became "Monthly Service Charge".

Fix, eval verdict v6 (`hamilton/eval-verdicts.ts`): the check also judges the name before Knox's first
logged retidy (the `old_name` on the earliest `knox.name_retidied` row). A labelled row matches
under either name. A rule that fails either name takes the usual 12-hour second look. Amount and
category still must match the label, so a corrected price still releases a row.

Dry read on prod data: of the 3,607 live fees a retidy renamed, 7 fail only under their old name, and
all 7 are wrong at source. They are 100161, 13878, 88374, 60387, 75915, 29509 ("Cash Advance 10%
charge (min" at $10, the floor) and 76240 ("Collection Fee 1% of Payment (min").

Not changed: the source check (`name_not_in_text`, 23 cleared) and the category guard
(`name_contradicts`, 10 cleared) also cleared flags after renames. Both judge whether the name
itself is right, and a retidy that fixes the name answers them.

The Knox lesson that carries `two_column_glue` is written when a takedown confirms, as for every
confirmed takedown. Knox learns only from confirmed takedowns. For 100157, 100158 and 100162 that is
after 20:11 UTC.
