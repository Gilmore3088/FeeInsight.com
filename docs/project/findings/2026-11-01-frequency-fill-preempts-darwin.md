# 2026-11-01: Hamilton's frequency fill wrote a switched Darwin change live, and looped every hour

**What happened:** At 01:30 UTC on Oct 31 (run 16584, the first publish step after #2814 merged)
Hamilton's frequency fill (`src/lib/agents/hamilton/frequency-fill.ts`, v15) cleared the frequency
of 10 of the 17 live monthly maintenance fees stored per item: 69927, 106618, 113636, 127148,
130957, 140755, 143161, 147168, 149338 (`per_item` to blank) and 152158 (`per_transaction` to blank),
each logged in `pipeline_feedback` (`hamilton.frequency_fill`, `frequency_cleared`). 149338 took
`monthly` on the next pass (02:10, run 16612). 164800 (14:10 cleared, 15:00 monthly) and 165692
(Nov 1 00:50, cleared) followed. Two of the 10 are per-item prices, not maintenance fees, as the
banks' own stored text shows: document 6273 "maintenance fee | • Non-Account owner | $16 each"
(69927) and document 28346 "$1.00 per withdrawal after 6 per statement cycle" (152158). Darwin's
maintenance re-check (#2814, `MAINTENANCE_FREQUENCY_ACTS` off) would hold both, but it read only
fees stored per event, so once blank they left its read and stayed live as monthly maintenance fees.

Separately, the hourly catalog sweep (#2822) reported "frequencyFill 5" on every run. Five fees were
rewritten each hour: 48831 (annual), 54739 (monthly), 71136 (monthly), 138656 (monthly) and 164885
(monthly). Each is a blank whose stored line Knox cut before its price; v15 fills it from the full
line of its document ("Invalid Address Fee .... $10.00 per month", document 40500; "IRA maintenance
fee .... $20.00 per year", document 13022), and the next pass read the stated value on the cut
excerpt alone, found no period there and cleared it. `pipeline_feedback` shows only the first fill
and the first clear of each (dedupe keys), so the loop was visible only as the steady count.

**Cause:** (1) #2814 changed the shared rule `settledFrequency` to drop a per-item frequency on
monthly maintenance, and shipped the live change for the fees already published behind a Darwin
switch. Hamilton's fill calls the same rule on live fees with no switch, so it wrote the change the
switch held back, and ran first. (2) v15 read the full stored line only for a blank, so a value it
wrote from that line was judged on the next pass by a line that cannot show it (the v14 fixed-point
rule, broken by v15).

**Fix (process first):** fill v16 leaves a monthly-maintenance fee stored per item alone (Darwin's
re-check owns it), and keeps a stated frequency that its own full stored line fills. Darwin's
maintenance re-check v2 also reads blank live maintenance fees, for a hold only, on their own line
(not the name), still behind `MAINTENANCE_FREQUENCY_ACTS` (off). Dry run, prod read-only Nov 1: the
fill change writes nothing new (it only stops writes: the 10-fee clear class and the 5-fee loop);
the Darwin v2 read would hold 3 of 298 blank live maintenance fees (18089 "$2.00 each" buy-down,
69927, 152158) when switched on. No live fee was changed by this work.

**Open:** 138656 (Oregon Coast Bank, "A $5 transaction fee will be charged for each additional
debit") fills `monthly` from "each statement cycle" on its full line and is filed under
`atm_non_network`; v16 keeps it stable at `monthly`, which is the wrong period and category. That
is a separate frequency-reading and categorisation cause.

**Agent lesson:** hamilton/frequency-fill-switchless-writes-wait-for-darwin
