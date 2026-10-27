# 2026-10-27: a reward paid to the customer was published as a fee

**Lesson:** "2) Earn $50 when you complete two or more online bill payments" is money the bank pays
the customer, not a price the customer pays. A reward, bonus, credit or refund is never a fee: read
the words right around the figure, and refuse a fee whose only row in the schedule states its amount
as one.

**What happened (#2137):** Fremont Bank's live fee 36519 (`bill_pay`, $50, name "2 Earn") is promotion
footnote 10 on its checking page (text 32292, doc 34282): new Cornerstone clients earn $50 for two
online bill payments, as one of three $50 parts of a $150 bonus. Knox read the clause as a bill pay fee
(from artifact 5610, an older rules version), Darwin verified it and it went live. It stayed live
because the shared check traced it: the fee's name and "$50" are on one line. The same check passes
every later step that leans on it.

**Cause:** no rule told money paid to the customer from money the customer pays, in Knox's read or in
the shared check. The cash-back rule (`REWARD_WORDS` in `checkRateAgainstSource`) covered rates only.

**Fix:**
- `src/lib/reward-credit.ts` (`rewardCreditOf`) decides: the fee's own figure (the first at its amount
  after its name on the line, or the line's first when the name follows its figure) has paying words
  right before it ("earn", "we'll credit", "bonus of", "refund of", or "receive"/"get" followed by an
  article or "up to", or opening a clause) or a reward noun right after it ("bonus", "reward", "credit
  toward", "statement credit"). A fee word after the figure ("receive a $20.00 late fee"), a service
  named "Receive" ("Wire Receive $15", "Receive: $45 per wire transfer", "Fax Received $1.00") and a
  deposit the customer must bring ("receive $1,000 or more in Monthly Direct Deposits") do not count.
- Knox v137 drops such a read: its self-check reads with the refusal on, so a read traces only to a row
  that prices it.
- The shared check refuses such a fee as `reward_credit` unless another row prices it
  (`withoutRewardCreditRow`). The refusal is behind `SOURCE_CHECK_REWARD_CREDIT` (off by default).
- Hamilton's source check v28 re-checks every institution, counts the live fees the refusal would take
  down (`reward_credit`, `reward_credit_samples` in its `hamilton.source_check` event) and, with both
  switches off, judges every fee exactly as before: no counting run relinks or takes down a fee. The
  rules re-check keeps a fee v137 no longer reads while the shared check (switch off) traces it and the
  category guard passes it, so the Knox bump takes nothing down either.

**Dry run (prod, read-only, Oct 27):** 82,083 live flat fees. A SQL prefilter, written as a looser
copy of `rewardCreditOf`'s patterns (the fee's own stored text for Knox fees; every stored text of the
institution for imported fees), kept the fees with a line that prints their amount beside reward
wording and no other line at that amount carrying the first word of the fee's name, plus every fee whose
stored Knox excerpt matches: 31 fees. 28 were run through the shared check, off and on, on every line of
their stored text that prints the amount (and the line above it); the other 3 (13958, 100942, 110391)
match only on a page-navigation line that does not name the fee, where the check cannot trace them. 7
at 7 institutions are refused as `reward_credit`:
36519 (Fremont, "Earn $50" for bill payments), 141028 (inst 8664, "Submit A Mobile Deposit | $5
reward"), 111070 (inst 1028, "receive a $25 credit toward the rental of a safe deposit box"), 111041
(inst 62, "Earn a $5 Starbucks Card" for referrals), 133387 (inst 1453, "$100 credit toward closing
costs" filed as an appraisal fee), 63286 (inst 4381, "a one-time service charge refund of $50" filed as
a monthly fee) and 147528 (inst 659, "receive a $100 rebate after mortgage closing" filed as check
printing). Each was read against its stored text: all 7 are a reward paid to the customer (7 of 7).
The rest are kept: a fee word follows the figure (23367 and 87795 "will receive a $20.00 late fee", 57402
"receive a $31 fee", 108895 "receive a $25 service charge"), or the fee is priced on a row of its own
(15666 "Monthly service charge | $5" beside "$5 reward status", 76497 "2” X 5” $40.00" beside "receive a
$40 discount"), or the reward line does not name the fee, so the trace lands on the fee's own row
(11 fees, among them 120598 "earns $3 cash back" and 137619 "refunds up to $15 in total non-MB&T ATM
fees"). The prefilter is looser than the rule, but a reward stated across lines, or worded in a way
neither copy lists, would be missed by both, so 7 is a floor for the class, not a census. An earlier
takedown of the same "$100 credit toward closing costs" wording (fee 15199, doc 14467) sat in the
adversarial known misses; Knox v137 no longer reads it, so it is now a case.

**Removing 36519 is thin coverage, not a gate to change:** institution 247 has 5 live dollar fees in 3
categories; without 36519 it has 4 in 2 (`monthly_maintenance`, `paper_statement`), under the catalog's
three-category depth gate, so its 4 real fees stop showing. That is the honest outcome. The gate stays;
finding Fremont's missing categories is #1918's job.

**Not covered:** a reward whose figure and words sit on different lines, a reward stated only as a
percentage (the rate path's `REWARD_WORDS`), and paid reads, which take the shared check's default
(switch off).

**Guard:** `src/lib/reward-credit.test.ts`, `src/lib/custom-report/reward-credit-check.test.ts`,
`src/lib/agents/knox/reward-credit-read.test.ts`, `src/lib/agents/hamilton/source-check.test.ts`, the
planted case `amount_reward_credit` in `src/lib/agents/deming/planted-errors.ts`, the adversarial case
`not_a_fee:15199`. **Agent lesson:** knox/issue-2137-reward-is-no-fee,
hamilton/issue-2137-reward-is-not-traced.
