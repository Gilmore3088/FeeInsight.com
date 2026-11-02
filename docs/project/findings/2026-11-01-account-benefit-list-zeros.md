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
- Knox rules v157 (`knox/extract.ts`, held free reads) holds such a $0 as a range for review with the
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

**Review of #2894 (Nov 2):** an independent review blocked the first version. The `feature_list` walk
never stopped at the bank's own schedule, so after one account-terms line any account name up to 700
characters back made a bank-wide $0 row an account perk ("Basic Checking / Monthly maintenance fee $10 /
... / General Fees / Stop payment $30 / No charge for incoming wires"). The walk now ends, keeping the
$0, at a section heading ("General Fees", "MISCELLANEOUS FEES", "OTHER SERVICES", "Additional
Services"), at a priced row that is not one of the account's terms or a perk ("Stop payment $30",
"Outgoing $25", "Incoming Wires FREE"; "$25 opening deposit" and "$4.00 off each check order" do not
end it), and at a label on the item's own row ("Incoming Wires: No charge for incoming domestic wires").
The walk's reach is 450 characters for both Knox and Darwin's SQL window (`ACCOUNT_BENEFIT_WALK_CHARS`);
the first version walked 700 on Knox's whole text while Darwin read 450.

Re-count, prod read-only, Nov 2, with the fixed test: of 3,436 live $0 fees, 142 have a free-item stored
line, and 16 at 5 institutions still match, the same 16 fees as on Nov 1 (the 37 fixture rows' windows
are unchanged byte for byte; the other 105 were screened in SQL for an account name and a lead or terms
phrase; 12 passed and were read through the test, 3 more passed a looser screen and were read by hand, and none matches). None of the review's six
false shapes is among the live fees. Knox path, estimated: 1,429 distinct free-item $0 reads (by
institution, text and line) sit on 840 current texts at 539 institutions; 584 pass the same SQL screen,
and a random sample of 25 of those gives 5 matches under the fixed test (Heritage Checking, Business
Basic Checking, Banclub Checking, Senior Checking, Totally Free Checking) where the first version also
gave 5. Scaled, roughly 120 of the 1,429 reads would be held (a sample of 25, so anywhere from about
40 to 240); a read on a text that prints the line more than three times is judged on every place by
Knox, and 74 such reads may hold fewer.

**Second review of #2894 (Nov 2):** the stop list still let through a Title Case heading without a fee
word ("Wire Transfers", "Wires", "Miscellaneous", "Fee Schedule", "Other Items"), a priced row without a
$ ("Stop Payment 30.00", "Wire out 25,00", "Stop payment USD 30"), and a bare label over its value
("Incoming domestic wire" / "No charge"), on the feature-list and holder-grant paths alike. The walk is
now a whitelist: every piece between the lead and the item must be an entry of the account's own list
(a free entry, one of the account's terms such as "$25 opening deposit", "No monthly fee" or "Earns
dividends", a perk with a dollar figure, an "unlimited" or "available" feature, an image statement).
Anything else ends the walk and the $0 stays. A "Features" heading over the account's terms may sit
under up to six short lines about whom the account is for (Heritage Checking's "A great fit if:").

Re-count, prod read-only, Nov 2, same method: still 3,436 live $0 fees and 142 free-item lines, the
screened rows' windows unchanged (one, 140028, differs from my copy, and its line opens with "Waived",
which the test never reads as a free item). 12 match at 4 institutions: 56945, 100941 (6914), 65227
(763), 93919, 93920, 159066 (550), 152991, 152992, 152993, 152995, 152996, 152997 (8495). All 3 core
incoming wires (100941, 152991, 159066) still match. 4 of the earlier 16 now stay live, as known
misses: 56942 and 56943 (6914, "Plus all of the benefits of Basic Checking, including: ..., Mobile
Wallet, Debit Card Alerts, ..., Home Banking, ...": entries the whitelist does not read) and 141651,
141652 (8379, the Seniors' Savers Club's "Here is what you get. Dividends above the regular share
rate / If you have a Share Draft (checking) account, ..."). The Knox sample of 25 is unchanged: the
same 5 holds.

**Still open:** a benefits table cut into cells (institution 2341, live 163079, "No Fee for Stop
Payment" in an account comparison table, while the schedule charges $35 for a stop payment order), a
list whose lead names no account by name ("PERKS." in an account agreement, "Classic 50" with no
"Checking"), a list whose lead sits more than 450 characters before the item, and an account's list
whose entries the whitelist does not read (digital-banking services as Title Case entries, a dividend
line, a conditional sentence; 56942, 56943, 141651, 141652) are not read. They are checklist lines on #1397.

**Lesson:** a $0 that traces to its own line is not yet the bank's price. Read whose price the line
states before reading a free item as a fee: a list one account gives its holders prices nothing for
the bank.

**Agent lesson:** knox/issue-1397-account-benefit-list-held, darwin/issue-1397-account-benefit-list-refused

**Guard:** `src/lib/account-benefit-zero.test.ts`, `src/lib/agents/darwin/account-benefit-zero-check.test.ts`
(the Nov 1 dry-run fixture), `src/lib/agents/darwin/account-benefit-zero-check.db.test.ts` (Knox v157
hold and the check's SQL in PostgreSQL), and the account-benefit case in `src/lib/agents/darwin/verify.test.ts`.
