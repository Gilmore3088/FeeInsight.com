# 2026-11-02: A service's own monthly fee read as the checking account's monthly maintenance

**What happened:** River City Bank's fee schedule (state answer key 5608, CA, holdout) prints an online
banking section:

```
Consumer Online Banking Services and Mobile Banking Fees
Set Up Fee            | No charge
Monthly Maintenance Fee | No charge
```

When the row is a table row, Knox's free read files "Monthly Maintenance Fee | No charge" as
`monthly_maintenance` $0. Published, that tells readers the bank has free checking. The row's own words
name no service, so the name rule for a service's monthly charge (`SERVICE_MONTHLY_CHARGE_NAME`, guard
v102, `src/lib/service-monthly-charge.ts`) cannot see it, and `classifyFeeText` gives the heading no
category. The frozen text stacks the label and the value on separate lines, which Knox does not read as a
row, so today nothing in the lab or the gates shows it. Rosetta's DOM row pairing (`HTML_ROW_PAIRING_LIVE`,
off, open on branch `feat/rosetta-html-row-pairing`) pairs those rows, and then Knox reads it: re-reading
the 38 holdout documents from their public bytes (#2939) with pairing on, this row is the only monthly
maintenance read of 23 under a service's heading.

**Taxonomy:** no category of the 50 holds a service's own monthly fee. `bill_pay` and `mobile_deposit`
take a bill payer's or a mobile check deposit's monthly charge by its name (guard v102); online, internet
or text banking, remote capture and the other services have no type and come down by name. DECISIONS has
no entry that places one. So a match is held, never re-filed. A bill-pay-only heading is held too: guard
v102 re-files by the fee's name, and a heading-only re-file would be a new rule of its own.

**Fix:** one pure test, `src/lib/service-maintenance-heading.ts` (`serviceMaintenanceOf`,
`serviceMaintenanceRead`), structural, and it refuses rather than matches when in doubt:
- The row is found in the text by its own line (or its label on a line of its own when label and value are
  stacked). Every printing must pass; a row printed nowhere is never one.
- Its nearest heading is the first line above it that is shaped like a heading (short, no price, no cell
  break, no list mark, not ending like a sentence or a bracketed note) and is not a stacked row's label
  ("Set Up Fee" over "No charge"). Sibling rows, values and notes are passed over; a note between that names
  an account refuses the match. No heading within 20 printed lines refuses it.
- The heading names only services (online, mobile, internet or text banking, bill pay, e-statements, remote
  deposit, Zelle, treasury) with only audience and schedule words beside them ("Consumer", "Business",
  "Services", "Fees", "and"). It must open its own section: no heading-shaped line, colon lead or "includes /
  features / benefits / following / offers" line right above it.
- The row's own label names no account.
- Knox rules v165 (`knox/extract.ts`) holds a matching read as a range for review, $0 (in
  `insertHeldCandidate`) and priced (`holdServiceMaintenanceCandidate`, on the free, paid and re-read
  paths), flag `knox_service_maintenance:<services>`. Never sent to Darwin.
- Darwin's verify refuses one as `service_maintenance_heading` (needs review) on Knox's row and the line
  the shared check traces it to both: a name the shared check traces to an account's row stays.
- Darwin's live re-check (`darwin/service-maintenance-check.ts`, `darwin.service_maintenance_heading` v1)
  reads every live flat monthly maintenance fee whose text prints a service's words and reports matches.
  Behind `SERVICE_MAINTENANCE_TAKEDOWN_LIVE` (off), a match goes through the 12-hour second look and is
  archived, never deleted. Admin-corrected fees are never read. Section 8 of `npm run
  audit:switch-dry-runs` counts what it would take down, by the re-check's own SQL and function.
- `checkFeeAgainstSource` is unchanged, and so is Hamilton's `reproducibleFees` (the rules re-check that
  can take live fees down), so nothing live moves until the switch does.

**Near misses, all kept and tested** (`src/lib/service-maintenance-heading.test.ts`, 63 cases with the
matches): an account heading whose description says online banking is included (as a sentence and as a
title-case line), "Checking with Online Banking" as an account's name, a maintenance row under an account
heading followed by an online banking section, "Business Online Banking" below a maintenance row under
"Business Checking", an account's features printed as short lines and as bullets, a service line under a
colon lead or an "includes the following" line, a service heading right under an account heading, notes
naming an account between heading and row, a row label naming the account, another category under a
service heading, 18 headings that are not only services ("Electronic Banking", "Mobile Deposit", "Free
Online Banking", "Online Banking Account Fees", "Treasury Bills", "Kasasa Cash Checking" ...), a service
named in a sentence, a service's own table row or stacked row above the account's row, an account
comparison table, a row printed twice with one printing under an account, a heading beyond the lookback,
no heading, and no text or line. Knox's write path is tested with a fake database
(`src/lib/agents/knox/service-maintenance-hold.test.ts`): $0 and priced service rows held as ranges, the
account's $0 and priced rows sent to Darwin as before.

**Measured on the frozen data** (main 0d0e8f2b4 against this branch):

| Measure | main | branch |
|---|---|---|
| Shadow lab answer-key recall | 972 / 1,302 | 972 / 1,302 |
| Shadow lab all expected fees | 1,340 / 1,756 | 1,340 / 1,756 |
| Shadow lab false publication | 31 / 160 | 31 / 160 |
| Texas gate, all (right / wrong) | 586 / 11 | 586 / 11 |
| Texas gate, held out | 60 / 4 | 60 / 4 |
| Seven-state gate (right / wrong) | 926 / 29 | 926 / 29 |
| Golden set recall | 1,340 / 1,766 | 1,340 / 1,766 |
| Golden set precision (right / published) | 1,386 / 1,449 | 1,386 / 1,449 |
| Golden set known-wrong refused | 256 / 287 | 256 / 287 (switch on: the same, 0 members changed) |

The lab report is identical but for the Knox version and timing, and the experiment
`service-maintenance-hold-off` (the hold and refusal off) reads the same numbers. Across the 291 distinct
frozen texts (Texas, seven-state, lab and golden), Knox makes 138 monthly maintenance reads and the test
matches none. Of the keyed monthly maintenance rows (71 Texas, 67 seven-state, 68 lab, 68 golden; 193 with a
source line), the test matches none, so none can be lost. With `HTML_ROW_PAIRING_LIVE` on, over the 38
re-read holdout documents, it holds River City's "Monthly Maintenance Fee | No charge" and keeps the other
22 monthly maintenance reads. Checked by hand, none sits under a service's heading: 18 are accounts' own
rows ("Business Advantage (monthly fee) | $12.50", "Monthly Service Charge | $6.00", "Free Checking | Free",
"Interest Checking | Free" ...), and 4 are other errors outside this rule's class, left to their own
rules: 6730's "Account Research ..." $5, 2017's HSA annual service charge, 1338's "Maintenance Fee | $45.00
| (per transfer ...)", and 1338's "Online Wire Monthly Maintenance Fee | $25.00", a service named in the
row itself that the name rule misses because "online wire" is not one of its service words (a follow-up
for `SERVICE_MONTHLY_CHARGE_NAME`, not this heading rule).

**Live effect:** not counted in this PR. No database was read. Before the switch goes on, run `npm run
audit:switch-dry-runs` (section 8, read-only) and sample the matches against the banks' text.

**Agent lesson:** knox/issue-1092-service-maintenance-heading-held, darwin/issue-1092-service-maintenance-heading-refused

**Guard:** `src/lib/service-maintenance-heading.test.ts` (the near misses),
`src/lib/agents/knox/service-maintenance-hold.test.ts`, `src/lib/agents/darwin/service-maintenance-check.test.ts`
(switch off writes nothing), the golden-set sweep replay `darwin.service_maintenance_heading` with its
switch-gate probe, and section 8 of the switch dry-run audit.
