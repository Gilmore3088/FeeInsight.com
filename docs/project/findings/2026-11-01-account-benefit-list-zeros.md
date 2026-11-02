# 2026-11-01: One account's benefit list published as the bank's $0 price

**What happened:** #1397 found one large bank's $0 overdraft, NSF, wire and stop payment fees read
from a premium account's own schedule. Darwin's tier-perk rule (`tier_perk_zero`, #1400 and #2744)
now refuses a $0 from a tier's own document or named for a tier's account, and its live re-check
waits behind `DARWIN_RECHECK_TIER_RULE_LIVE`. The same error has a second shape the rule cannot see:
a general rates page lists what one account gives its holders, and Knox read each free item as the
bank's $0 fee. Read-only on prod, Nov 1: of 3,439 live $0 fees, 142 have a stored line that is a free
item ("free ...", "no fee for ...", "no charge for ...", "complimentary ..."), and 16 of those at 5
institutions are items of one named account's list:

- "(6) PremiumSpend Checking Account owners are provided the following free services: free check
  writing, free incoming domestic wire transfers, ..." (institution 8495: 152991 incoming wire,
  152992, 152993, 152995, 152996, 152997).
- "As long as you have an active Relationship Rewards Checking account, the following fee waivers
  will be offered: Free Money Orders and Cashier's checks; No fee for incoming wires" (institution
  550: 159066 incoming wire, 93919, 93920). The same bank prices incoming wires on two other live rows.
- "Business Basic Checking, $25 opening deposit, No minimum balance requirement, ..., Free incoming
  wires" (institution 6914: 100941 incoming wire, 56942, 56943, 56945).
- Heritage Checking's "Features" list (institution 763: 65227) and the Seniors' Savers Club list
  (institution 8379: 141651, 141652).

In the issue's core categories (overdraft, NSF, stop payment, wires) that is 3 live fees, all incoming
domestic wires. The shared source check (`checkFeeAgainstSource`) traces all 16 to their list line and
passes them: it reads that the line prints the fee free, not whose benefit the line is.

**Fix:** one test, `accountBenefitZeroOf` in `src/lib/account-benefit-zero.ts`, read at each step:
- Knox rules v156 (`knox/extract.ts`, held free reads) holds such a $0 as a range for review with the
  flag `knox_account_benefit_zero:<kind>` instead of sending it to Darwin as a free fee.
- Darwin's verify refuses it as `account_benefit_zero` (needs review).
- Darwin's live re-check (`darwin/account-benefit-zero-check.ts`, `darwin.account_benefit_zero` v1)
  reads every live free-item $0 each verify step and reports the matches. Behind
  `DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE` (off by default), a match goes through the shared 12-hour second
  look and is archived, never deleted.

The item must be a list entry, and the walk back over the list's short entries must reach a lead that
names one account: its holders "are provided" or "receive" what follows, "the following fee waivers /
benefits / services", "Benefits of <package>:", or the account's name over a list of its terms. A grant
to every member, a customer price beside a non-customer one, a sentence, a heading, a schedule row, and
an item the text also prints outside such a list stay free fees.

**Still open:** a benefits table cut into cells (institution 2341, live 163079, "No Fee for Stop
Payment" in an account comparison table, while the schedule charges $35 for a stop payment order), a
list whose lead names no account by name ("PERKS." in an account agreement, "Classic 50" with no
"Checking"), and a list whose lead sits more than 450 characters before the item are not read. They
are checklist lines on #1397.

**Lesson:** a $0 that traces to its own line is not yet the bank's price. Read whose price the line
states before reading a free item as a fee: a list one account gives its holders prices nothing for
the bank.

**Agent lesson:** knox/issue-1397-account-benefit-list-held, darwin/issue-1397-account-benefit-list-refused

**Guard:** `src/lib/account-benefit-zero.test.ts`, `src/lib/agents/darwin/account-benefit-zero-check.test.ts`
(the Nov 1 dry-run fixture), `src/lib/agents/darwin/account-benefit-zero-check.db.test.ts` (Knox v156
hold and the check's SQL in PostgreSQL), and the account-benefit case in `src/lib/agents/darwin/verify.test.ts`.
