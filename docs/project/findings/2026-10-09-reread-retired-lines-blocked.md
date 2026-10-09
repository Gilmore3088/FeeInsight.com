# A re-read dropped lines the new text still prints

**Found:** 2026-10-09, Largest banks thread (Northern Trust, inst 25, overdraft $25).

## What happened
When Knox re-reads a document whose text changed, it first retires the unverified rows it took
from the older text (`retireRowsFromOlderText`, flag `superseded_by_reread`), then inserts
today's read. The raw dedupe index is (document, lower(name), amount). Its `ON CONFLICT`
only takes over rows held as unclassified or untraced. A line the new text still prints under
the same name and price ran into the retired row and was dropped. The fee was read, but it
never reached Darwin.

Northern Trust's "Overdrafts Paid and Items Paid against Nonsufficient Funds" $25 (raw 457013)
was read by the paid team at 07:12 on 9 Oct from text 20257 (hash 27e2…). Rosetta then
re-normalized that text in place (hash 1f6e…). At 08:46 the v63 rules re-read retired 457013
and read the same line under the same name and amount, and the insert was dropped. So the
bank had no live overdraft fee.

On prod at 09:55 there were 1,597 retired rows with no verified row, from 368 documents. 1,531
of them are on a document that is still current.

## Fix
`recheckSupersededRows` (knox/held-recheck.ts) runs in the extract step. It re-reads the
current text of a batch of retired rows with today's free team. A row goes back to Darwin only
when today's read has the same name, amount and category, and the bank has no live fee of that
category at that price. The row takes the current text's hash, so the next re-read keeps it.
Every other row is marked once per Knox version.

`SUPERSEDED_RECHECK_LIVE` starts off. While it is off, the pass is a dry read: each row is read
once per Knox version and marked with what the pass would do
(`knox_superseded_would_promote:vN`). The dry read is spot-checked against source before the
switch goes on. A row sent back still goes through Darwin's checks before Hamilton can publish
it.

## First dry read: paid rows only
The first dry read on prod (10:16 to 10:48 UTC, Knox v64) read 90 rows and would have sent 17 to
Darwin. Read against source, 11 of 17 were right. The other 6 were a $1,000 ATM withdrawal limit, an
ATM fee rebate, a courtesy-pay fee filed as an ATM fee, an ATM misuse fee filed as a non-network
ATM fee, a money market excess-transaction fee at $5 where the page says $10, and an arguable ATM
balance inquiry fee. That is below the 18/20 bar for bulk re-selects, so the switch stayed off.

The re-check now reads only rows Knox's paid reader produced (`knox_paid_extraction`, 43 rows on
9 Oct). A row comes back only when the paid reader and today's free rules agree on its name, amount
and category. Northern Trust's overdraft is one of them. The dry read runs again on these rows and
gets a new source spot check before the switch goes on.

## The pass read only its own lane
Two hours after the paid-only change, the pass had read 7 of the 43 paid rows. Each extract run read
only the rows of its own state lane or institution, so most runs read none, and Northern Trust (IL)
waited for the IL lane. The pass now reads paid rows from every bank in each run. There are few of
them, and each is read once per Knox version.
