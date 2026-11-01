# 2026-11-01: A service's own monthly charge was filed as the account's monthly maintenance fee

**What happened:** 17 live `monthly_maintenance` fees at 17 banks were not an account's monthly fee
but a service's: "Bill Payer (monthly fee) | Free" (52592), "BillPayer Monthly Fee | No Fee | per
account" (90758), "OLB Monthly Maintenance | $0.00" (139026), "Online Banking Monthly Service Fee |
FREE" (90012), "Mobile Check Deposit - Monthly Service FREE" (134175), "Remote Capture Monthly Fee -
$50.00" (142371), "Monthly fee if enrolled in Text Banking and no text messages ..." $2 (159894),
"VISA/MasterCard Monthly Fee | $7.75" under "Merchant Service Fees" (61576), and 9 more. 11 of them
were free rows from an electronic services block, so they inflated monthly maintenance's free share.
(Read-only queries of `published_fee_catalog`, `raw_fee_observations` and `agent_source_texts`,
2026-11-01; each row was read on its stored source line.)

**Cause:** Knox's generic monthly maintenance pattern matches any "monthly fee", "monthly service" or
"maintenance fee" words. Its follow-up filter refused only a card, loan, bill pay, EDI or box name, and
`\bbill ?pay\b` does not match "Bill Payer", "BillPayer" or "Bill Paying". Online banking, OLB, text
banking, mobile check deposit, remote capture, balance reporting, coin orders, telephone transfers
and Visa/MasterCard were not on it at all. The category guard's monthly maintenance exclusion had
remote deposit, treasury and merchant capture, but none of these names, so Darwin verified the reads
and Hamilton published them.

**Fix:** `src/lib/service-monthly-charge.ts` names such a service (`SERVICE_MONTHLY_CHARGE_NAME`),
ignoring one named only in a waiver ("Use your debit card 15 or more times ... waive") or plural
"mobile deposits" as account activity. Knox v149 files a bill payer's monthly charge as bill pay, a
mobile check deposit's as mobile deposit, and holds the rest (no type of the 50 holds them). Guard
v102 refuses them as monthly maintenance and re-files the bill payer and mobile check deposit rows
(`REFILE_RULES`, Hamilton's `RESTORE_REFILES`). Hamilton's live category guard run applies it to live
fees.

**Dry run (read-only, Nov 1):** of 4,092 live monthly maintenance fees, 17 fail guard v102. 4 re-file
in place (52592, 127920, 90758 to bill_pay; 134175 to mobile_deposit; none of the 4 banks has a live
fee of the target type, so there is no twin). 13 come down (109997, 14261, 21100, 126293, 57925,
159894, 75433, 139026, 140108, 90012, 142371, 134058, 61576). The 4 re-filed rows trace on their
stored lines under their new type (`checkFeeAgainstSource`).

**Lesson:** Ask what a row is a fee for before matching its fee words: "monthly fee" on a service's
row is that service's fee, not the account's monthly maintenance.

**Agent lesson:** knox/issue-1100-service-monthly-charge-is-not-maintenance

**Guard:** `src/lib/service-monthly-charge.test.ts` (Knox classification, guard refusal and re-file,
Hamilton's live move, and the source trace for each of the 17 rows, with the waiver and account names
that stay)
