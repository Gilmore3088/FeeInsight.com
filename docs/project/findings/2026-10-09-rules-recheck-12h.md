# The rules re-check took fees down without the 12-hour second look

**Found:** 2026-10-09, Largest banks thread (UAT on the 14 Citizens Business and ConnectOne rows).

## What happened
When Knox re-read a bank, Hamilton's rules re-check (`hamilton/rules-recheck.ts`) took a live fee
down on that same run if today's rules no longer read it. The only check before a takedown ran in
the same pass: the fee stayed live if `checkFeeAgainstSource` still traced its name and price and
the category guard accepted it. A second live copy of the same category and price on one document
came down with no check at all, as a dedupe. No `takedown_pending` flag was written and there was
no 12-hour wait.

This corrects the 2026-10-07 note in `FINDINGS.md` (PR 320), which says the rules re-check "gets
its second look in PR 320". What it got was the in-pass check, not the second look James's rule
requires. DECISIONS.md says "only a later run (at least 12 hours on) that fails it again takes it
down" and lists the rules re-check as a path still to follow. The PR 320 lesson is "every new
takedown path goes through `secondLook`", but the rules re-check never did.

## What it took down (7 days to 09:20 UTC Oct 9)
The re-check took down 4,278 live fees in that window:

- **1,351 were dedupes.** The bank still has a live fee with the same category and price. Often it
  is the same fee under a better name (for example "00 Stop payment order, per check" $30, with
  "Stop payment order" $30 still live). Sometimes it is another line at the same price.
- **99 failed the in-pass check and have no live twin.** I read a random 10 against their source
  excerpts. 8 were clearly right to come down: Positive Pay ACH filed as a monthly fee, a "3X5"
  safe deposit row, a 2x10 box read as overdraft protection, an abandoned cashier's check filed as
  a money order, a $1 threshold read as a cash advance fee, a bill-pay stop filed as bill pay, a
  business wire, and a stop payment removal. 2 are arguable: a "+$20" rush card fee, and a "$5 |
  $15" monthly fee.
- **About 2,800 came from Oct 5-6, before the in-pass check existed.** Those are among the 4,467 the
  Oct 7 restore bar already re-judged (FINDINGS.md, "Darwin's dispute threshold was too loose").
  Only 28 takedowns with no twin and no check happened from Oct 7 to Oct 9.

My first sample on Oct 9 counted 6 of 10 as "real fees taken down". All 6 were dedupes with a live
twin at the same category and price. The bank's published fees lost nothing, so no new restore is
needed.

## Fix
- `rollBackUnreproducedFees` sends every fee it would take down (in-pass failures and dedupes) to
  `secondLook()` under check `hamilton.rules_recheck`. The first failure is logged as
  `takedown_pending` and the fee stays live. A run at least 12 hours later that fails it again
  takes it down and logs `takedown_confirmed`. A later run that passes the fee clears the flag.
- A document with a flag that is due for its second look is checked again, even if it was already
  checked at the current Knox signature.
- `RULES_RECHECK_TAKEDOWN_LIVE` (on) can pause the re-check. While it is off, first looks are still
  logged but none is confirmed. The re-check never takes a fee down on the spot, whether it is on
  or off.
- The 14 Citizens Business and ConnectOne rows stay down. All 15 rows in that batch were checked
  wrong at source.

**Lesson:** before calling a takedown wrong, check whether the bank still shows the same category
and price. A dedupe removes a copy, not a fee.
