# 2026-10-30: Monthly maintenance fees went live "per item"

**What happened:** The Hamilton proof run found 17 live monthly maintenance fees
(`canonical_fee_key = 'monthly_maintenance'`) stored `per_item` (16) or `per_transaction` (1). A
maintenance fee is charged per month or per statement cycle. Checked against the banks' own stored
text (`agent_source_texts`): document 14232 prints "A service charge of $3.00 will be charged each
calendar month", 20371 "$5.00 / $15.00 will be charged each statement cycle", 23011 "A monthly
service fee of $3.00 will be charged on the 1st day of each calendar month", 29055 "$10.00 will be
charged each calendar quarter". Four of the 17 are not maintenance fees at all: "$2 Item Fee
Service Charge for each additional" withdrawal (26458), "$1.00 per withdrawal after 6 per statement
cycle" (28346), "Non-Account owner | $16 each" in a check-cashing column (6273) and "$35 per
overdraft" (38228).

**Cause:** the shared frequency rule `settledFrequency` (`src/lib/fee-frequency.ts`), used by Knox at
extraction, Darwin's verify and Hamilton's frequency fill. Its rule "a per-item reading never lands
on a period category" only dropped the line's own per-item reading; a per-item frequency passed in
as the stated one was kept, because a period category "keeps its stated period" whatever was
stated. Knox passes its own reading of the fee's row in as the stated frequency (specialists.ts,
`settledFrequency(checked.row, amount, rowFrequency, hint)`), so a line read per item stayed per
item: 13 of the 17 raw rows carry Knox's `per_item`. The other 4 (raw frequency blank, Oct 5-7)
were settled per item by Darwin's verify under the rules of that week, before "each statement
cycle" read as monthly; nothing re-checks a stored frequency on a live fee, so they stayed. The
period reader also missed "each calendar month", "each statement period" and "each calendar
quarter", reading "each" as per item.

**Fix (process first):**
- `settledFrequency` drops a stated per-item frequency on an inherently periodic category
  (`INHERENTLY_PERIODIC_KEYS`, monthly maintenance only: safe deposit boxes, dormant accounts and
  paper statements also carry real per-event charges) and settles from the line's period, else
  blank. The period reader reads "each calendar month/quarter" and "each statement period". Knox
  v141.
- Darwin's verify holds a maintenance fee whose own line prices it per item
  (`ownLinePricesPerItem`: per-item wording right after its own price, or an item fee in its name)
  with the new reason `maintenance_per_item` (needs_review), instead of verifying it.
- Darwin's live re-check `src/lib/agents/darwin/maintenance-frequency-check.ts`, behind
  `MAINTENANCE_FREQUENCY_ACTS` (off): each verify step reads every live maintenance fee stored per
  event and either takes it down (`hold`), sets its line's period (`refile`) or clears the per-item
  default (`clear`). Each change is logged to `pipeline_feedback` (`maintenance_frequency_rechecked`,
  old value kept).

**Dry run (prod, read-only, Oct 30, switch off):** 17 live fees read.
- `hold` 4: 69927 ($16 each), 124953 ($2 item fee), 125734 ($35 per overdraft), 152158 ($1 per
  withdrawal).
- `refile` 6: monthly 5 (70749, 70750, 72530, 100041, 149338), quarterly 1 (134658).
- `clear` 7: 106618, 113636, 127148, 130957, 140755, 143161, 147168 (the line states no period, or
  "each fee period").
Other period categories still hold per-event rows by design (safe_deposit_box 305, paper_statement
68, dormant_account 62, continuous_od 35, minimum_balance 24 on Oct 30); this fix does not touch them.
