# 2026-11-02: A $0 read from a "No fee for X" item or a waiver row published as the bank's fee

**What happened:** a read-only pass over the shadow lab's 33 known-wrong publications on main
(f57e0eae9, Knox v161) found 7 that are $0 fees labelled `waiver_sentence` or `no_fee_sentence`
in the adversarial fixture (the largest single class). Re-derived on today's main, they are two
different things:

- **4 are the error.** Knox read a $0 from a line that is no priced row, and it passed every stage:
  - "No Fee for Cashier's Checks" under "Cornerstone Checking:" after "2 Boxes Personal Checks Free per
    Year" (live 56853), and "No Fee for Cashier's Checks" / "No Fee for Stop Payments" in a package's
    list after "No Fee for Elite Checks / One package per order." (live 64330, 64331). Each went live as
    the bank's $0 cashier's check or stop payment fee.
  - "Minimum Balance required to avoid a Service Charge / FREE" (live 102158): an account table's
    balance row, with the next heading's "FREE REWARD Checking:" glued on as its value, went live as a
    $0 service charge.
- **3 are not this class** (23743, 67733, 75618). Knox does not read the waiver row there today. What
  publishes is the account's own row, "Service Charge | None", "Monthly Service Charge | $0.00" and
  "Monthly Maintenance Fee | None | None | $6 | None", and the lab counts it against the fixture only
  because the fixture's forbidden fee is matched on category and amount. Those rows are the bank's
  price (the last is a tier read, a separate question), so this PR leaves them, and false publication
  can fall by 4 here, not 7.

Hamilton's name rules already call such a line no fee (`no_fee_sentence`: "A sentence about what is
free, not a priced fee line"; `waiver_sentence`: "the balance that avoids it, published as a $0 fee"),
and Darwin's verify applies them (`name_rule`). They read the fee's name, though, and Knox's name tidy
keeps only the fee the line names: "No Fee for Cashier's Checks" is read as "Cashier's Checks", and
the balance row as "Service Charge". The words that make the line no fee are gone before any rule
reads the name. The shared check (`checkFeeAgainstSource`) traces each one to its own line and passes
it. It also traces a fee read from its own row ("Monthly Service Charge | $0.00") to the balance row
above it ("Average daily balance to avoid monthly service charge | $0.00"), so a rule on the traced
line alone would have taken the bank's real $0 rows.

**Fix:** one pure test, `src/lib/zero-waiver-row.ts`, structural rather than a word list:
- `waiver_requirement`: the line's label (its first cell) is the balance, deposit or requirement that
  avoids or waives a fee. That row's value is a threshold, never a price.
- `no_fee_sentence`: the whole line is one short "No fee for / No charge on ..." sentence with no
  figure and no second cell, and every place the text prints it is one item of a list of free items
  (the nearest line above or below is another free item). The same sentence under its fee's own
  heading ("Notary Service" / "No charge for notarization of Bank documents." / "$10 per signature for
  notarization of non-Bank documents") is that row's price and stays. A pinned state answer key (tid
  5608, holdout) reads it as the bank's $0 notary fee, and a first version without the list test took it.
- Knox rules v162 (`knox/extract.ts`) holds a matching free read as a range for review
  (`knox_zero_waiver_row:<kind>`), never sent to Darwin as a free fee.
- Darwin's verify refuses one as `zero_waiver_row` (needs review), reading both Knox's line and the
  line the shared check traces it to (`zeroWaiverRowRead`). Knox's line keeps a fee read from its own
  row.
- Darwin's live re-check (`darwin/zero-waiver-row-check.ts`, `darwin.zero_waiver_row` v1) reads every
  live flat $0 whose stored line passes its prefilter, with the text Knox read, and reports matches.
  Behind `ZERO_WAIVER_ROW_TAKEDOWN_LIVE` (off), a match goes through the 12-hour second look and is
  archived, never deleted. Admin-corrected fees are never read.

**Near misses, all kept and tested** (`src/lib/zero-waiver-row.test.ts`): "Stop Payment | $0.00",
"Notary | No charge", "Notary Services No Charge", "Cashier's check | Free for Premier members" (an
audience condition in the price cell: the tier-perk and audience rules read it, not this one), "Monthly
fee $0 with e-statements" (a conditional $0), "Monthly Service Charge | $0.00", "Service Charge | None",
"Overdraft Protection Transfer (to avoid NSF) | Free", a no-fee sentence beside a heading and a priced
row, one printed twice where one place is not in a list, and one with a figure.

**Measured on the frozen data** (main f57e0eae9 against this branch, the switch off and on):

| Measure | main | branch, switch off | branch, switch on |
|---|---|---|---|
| Shadow lab answer-key recall | 972 / 1,302 | 972 / 1,302 | lab does not replay sweeps |
| Shadow lab all expected fees | 1,340 / 1,756 | 1,340 / 1,756 | |
| Shadow lab false publication | 33 / 160 | 29 / 160 | |
| Texas gate, all (right / wrong) | 586 / 11 | 586 / 11 | |
| Texas gate, held out | 60 / 4 | 60 / 4 | |
| Seven-state gate (right / wrong) | 926 / 29 | 926 / 29 | |
| Golden set recall | 1,340 / 1,766 | 1,340 / 1,766 | 1,340 / 1,766 |
| Golden set precision (right / published) | 1,386 / 1,451 | 1,386 / 1,447 | 1,386 / 1,447 |
| Golden set known-wrong refused | 254 / 287 | 258 / 287 | 258 / 287 |

Six lab publications are removed, all checked by hand against their lines: the four fees above,
plus the stop payment $0 beside 64330's cashier's check and the cashier's check $0 beside 64331's
stop payment (one document, 18829, read in two windows). No publication is added. The test matches none of the
449 keyed $0 rows in the Texas and seven-state keys or the 95 $0 expectations in the lab, and recall
does not move. The gates read Knox's free read, which this PR does not change. Switched on, the sweep has
nothing left to take down on the golden set, because verify already refuses those reads. Replayed over
what main published, it takes down the same 6 and keeps "Monthly Service Charge | $0.00", "Service
Charge | None" and the notary row.

**Live effect:** not counted in this PR. No database was read. Before the switch goes on, run
`npm run audit:switch-dry-runs` (section 7, the re-check's own SQL and function, read-only) and sample
the matches against the banks' text.

**Agent lesson:** knox/issue-1092-zero-from-waiver-row-held, darwin/issue-1092-zero-from-waiver-row-refused

**Guard:** `src/lib/zero-waiver-row.test.ts` (the near misses), `src/lib/agents/darwin/zero-waiver-row-check.test.ts`
(switch off writes nothing), and the golden-set sweep replay `darwin.zero_waiver_row` with its switch-gate probe.
