# 2026-11-01: a fee's reimbursement was published as the fee

**Lesson:** a fee word beside a figure does not make it a fee when the words after it pay that fee
back ("$500 appraisal fee reimbursement", "$35 annual fee credit towards the cost of a safe deposit
box"). A refund of the account's own service charge is the exception: it repays the charge at the
charge's own price, so the figure still prices it.

**What happened (#2137):** after #2788 (Knox v137, source check v28) the issue's open lines were the
switch's dry run, rewards stated in other shapes, and Fremont's catalog depth. A read-only sweep of prod
on Nov 1 took every live flat fee (89,059) and found 3,832 whose own stored text prints their amount on
a line with reward, refund, reimbursement or "toward" words. It read each such line with
`rewardCreditOf`, then ran `checkFeeAgainstSource` on the full stored text of every fee with a reward
line (215 fees), refusal off and on. Two live fees were rewards v137 missed, because the fee word after
the figure won: 101826 (inst 640, "$500 appraisal fee reimbursement for new mortgages with Hometown Hero
checking automatic loan payment", live as a $500 appraisal fee) and 145705 (inst 397, "$35 annual fee
credit towards the cost of a safe deposit box", live as a $35 box fee).

**Cause:** `rewardCreditOf` returned "fee" as soon as a fee word followed the figure (`FEE_AFTER`),
before looking for the reimbursement, refund or credit after that fee word, and it knew no
reimbursement words.

**Fix:** `rewardCreditOf` v2 (`src/lib/reward-credit.ts`). A reimbursement, rebate or "credit toward"
right after the figure, or after a fee's name that follows it ("$10.00/month ATM fee reimbursement", "Up
to $10 Domestic ATM Fees Reimbursed"), and "reimburse(d)" or "reimbursement of/for/up to" right before
it, pay the customer. A refund of the account's own service, maintenance or monthly charge is not one
(`OWN_CHARGE_REFUNDED`); "reimbursable" and "refunded" never count. Knox v151 drops such reads, held
reads included. Source check v29 counts the live ones; they come down only with
`SOURCE_CHECK_REWARD_CREDIT=on` (off).

**Dry run (read-only, Nov 1):** with the switch on, 9 live fees at 9 institutions are refused, each a
reward on its stored text: 36519, 141028, 111070, 111041, 133387, 63286, 147528 (v28's seven) and
101826, 145705. Two more (15666, 156985) move to a row that prices them and stay live. A first cut that
also counted "Earn a $7 service charge refund" would have refused 4 real monthly charges (159213 and
159214 at inst 3161; 68736 and 158268 at inst 152), each priced at its own refund. Not swept: a
reward stated only as a rate (no live percentage fee's name has reward words) and a reward split
across lines.

**Catalog depth:** `published_fee_catalog` shows an institution only with 3 or more distinct live
categories. Of the 9 institutions, 3 fall below that once their reward comes down: 247 Fremont (4 rows
hidden: 128342, 128343, 128344, 128345), 397 (2: 35799, 90834) and 1453 (3: 15197, 15198, 133388).
The switch removes 9 reward rows and hides 9 others. None of the three has a fee schedule captured
(only product pages: 8, 16 and 3 documents), so the missing categories are a discovery gap (#1918 for
Fremont), not a reason to keep a reward live.

**Agent lesson:** knox/issue-2137-a-fees-reimbursement-is-paid-to-the-customer

**Guard:** `src/lib/custom-report/reward-credit-check.test.ts`, `src/lib/agents/knox/reward-credit-read.test.ts`
