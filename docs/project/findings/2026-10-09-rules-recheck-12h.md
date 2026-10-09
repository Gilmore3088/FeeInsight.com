# The rules re-check took fees down without the 12-hour second look

**Found:** 2026-10-09, Largest banks thread (UAT on the 14 Citizens Business and ConnectOne rows).

## What happened
When Knox re-read a bank, Hamilton's rules re-check (`hamilton/rules-recheck.ts`) took a live fee
down on that same run if today's rules no longer read it. Its only "second look" was an independent
check in the same pass: the fee stayed live if `checkFeeAgainstSource` still traced its name and
price and the category guard accepted it. No `takedown_pending` flag was written and there was no
12-hour wait.

This corrects the 2026-10-07 note in `FINDINGS.md` (PR 320). That note says the rules re-check "gets
its second look in PR 320". It got the in-pass independent check, not the second look James's rule
requires (DECISIONS.md: "a takedown is a last resort ... only a later run (at least 12 hours on)
that fails it again takes it down"). DECISIONS.md already listed the rules re-check as one of the
paths that would follow, and the PR 320 lesson says "every new takedown path goes through
`secondLook`". It never did.

On prod the re-check took down 255 live fees at 180 banks in the 24 hours to 09:20 UTC Oct 9, and
4,277 in 7 days.

## How accurate those takedowns were
I took a read-only random sample of 10 of the last 24 hours' re-check takedowns, leaving out the 14
already hand-checked, and read each against its source text.

- **4 were wrong at source, so the takedown was right.** "External ATM/Shared Branch Returned Item"
  $25 was filed as NSF. "Fax transmittal" $5 was filed as account research. "Payroll ACH monthly
  fee" $4 was filed as a monthly maintenance fee. "Commercial International Wire Fee" $100 is a
  business fee.
- **6 were real fees at the right price.** "Non-Member On-Us Check Cashing | $5.00 per item",
  "Drafts Returned Due to Insufficient Funds $35.00 (per item)", "ATM transaction (each above
  6/month) $1.00", a $10 per-item overdraft protection fee, a $3 copy fee, and "Stop payment
  order, per check $30". Three of these had fragment names, but the fee and price were right.

That is 4 of 10 right, far below the 9-of-10 takedown bar. A 12-hour wait alone would not help,
because the same rules fail the same fee on the same text 12 hours later.

## Fix
- `rollBackUnreproducedFees` sends every fee that fails both the re-check and its in-pass check to
  `secondLook()` under check `hamilton.rules_recheck`. A first failure is logged
  `takedown_pending` and the fee stays live. A pending flag clears when a later run passes the fee.
- `RULES_RECHECK_TAKEDOWN_LIVE` is `false`. While it is off, first looks are logged and none is
  confirmed, so nothing comes down through the re-check. When it is on, a run at least 12 hours
  after the first look that fails the fee again takes it down and logs `takedown_confirmed`. A
  document with a due flag is then re-selected even if it was already checked at the current Knox
  signature. Turning it on is James's call, after the re-check's own misreads are fixed and a fresh
  sample of its takedowns reaches 9 of 10.
- The 14 Citizens Business and ConnectOne rows stay down. All 15 rows in that batch were checked
  wrong at source.
- Restoring the real fees among the past takedowns is a separate checked-list step. It needs a
  hand check of 20 candidates with at least 18 right, and every restore is logged.

**Lesson:** a takedown that only re-runs the same deterministic check is not a second look. The
12-hour wait gives a person time to see the flag, but accuracy has to come from the check itself.
