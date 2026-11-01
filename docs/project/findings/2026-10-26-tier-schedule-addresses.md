# 2026-10-26: tier disclosures named TIS, T&Cs or "summary of fees" kept their $0s live
**What happened:** #1397 asked whether the large bank's (institution 49) remaining live $0s and Gate
City's (349) are waivers or tier perks. Read-only on prod, Oct 26 (`published_fee_catalog`, stored
texts in `agent_source_texts`, `checkFeeAgainstSource` with Darwin's `"."` pattern):
- Institution 49: 3 live $0s of 19, all on its HSA account schedule (published 146114 NSF, 146115
  overdraft protection transfer, 146116 return item). Each traces to its own row ("Non-sufficient Funds
  | $0 per item"), and the bank's general personal account guide prints the same "Return item | $0
  per item" and "$0 $0" transfer rows. These are the bank's real prices and stay. An HSA is an
  account type, not a tier.
- Institution 349: 4 live $0s of 21. 33701 (NSF "Fee for items returned. $0 per item", beside a $32
  overdraft) and 33702 (Notary $0) are real. 33703 (Stop Payment $0) is the Online Bill Pay section's
  row; the schedule prints "Stop Payment $30 per item" twice elsewhere. 33704 ("surcharge could
  happen at any ATM not owned by Gate", "$0 in Fees") reads the business accounts' surcharge refund
  as a fee. Both trace and neither is a waiver or tier perk: they are a channel-section price and a
  refund read as a fee, other root causes.

Across prod, of 733 live $0 fees in overdraft, NSF, stop payment, overdraft transfer, cashier's
check, money order and wire categories, 26 have a waiver, condition or tier word in their excerpt or
name; read one by one, most are stated free prices ("No fee for incoming wires", "Courtesy Pay FREE").
The one class with a pipeline gap is tier schedules Darwin's address test missed: 13 live $0s (all
categories) at 3 institutions, each verified and re-checked under recheck v5 with `tier_perk_zero` passing:
- 152915 (1170): "...-Bank-On-Checking-TIS.pdf", "Overdraft Fee ... NO FEE". The bank's OD Privilege
  page charges "the standard per item Insufficient Funds Charge" ($32 on its fee schedule).
- 135954-135960 (683): "BankOn_Summary_of_Fees.pdf", money order, dormant, NSF, overdraft transfer,
  returned deposit item, stop payment and online banking/bill payment all "No Fee"; the bank's
  "Retail_Summary_of_Fees.pdf" charges $3, $5, $32, $8, $6.84, $32 and "No Fee".
- 28130-28134 (26): a premier account's "..._premier_tcs.pdf" (terms and charges), NSF, account
  closing, stop payment, incoming wire and cashier's check $0.

**Cause:** `tier-perk.ts` knew a tier's own document only when its address ended in fees, schedule or
disclosures after the tier word ("/premium-account-fees") or its first line was a "<tier> ... Schedule"
title. A tier's truth-in-savings disclosure ("TIS"), terms and charges ("tcs") or "Summary of Fees"
file passed, and its titles ("First Fed Bank On Account Disclosure", "HSBC PREMIER The following...",
"Retail Summary of Fees & Minimums") do not name a schedule. The recheck reads each live row once per
version, so a widened test would not reach rows already read at v5 without a version bump, and a
bump re-reads every live fee under every check with no dry-run count.

**Fix:**
- Tier-perk rule v2 (`TIER_PERK_RULE_VERSION`): the address test also takes `tis`, `tcs`, `terms`
  and `summary-of-fees` after the tier word and its qualifiers. Not "package": institution 341's
  "PREMIUM-CHECKING-PACKAGE" PDF carries its general pricing guide for every account (4 live $0s
  there are real and stay).
- A $0 on a tier schedule stays when the text says the bank charges none of that fee for anyone
  ("The Bank does not charge NSF fees", `bankChargesNone`); a clause naming whom it spares is still
  a perk. That keeps 28130, the premier schedule's NSF $0.
- Darwin's recheck reads the newly matched live $0s through a narrow cohort, not a version bump:
  `DARWIN_RECHECK_TIER_RULE_LIVE` (off) selects live $0 rows whose source address matches
  `TIER_PATH_SQL` and that no attempt at this version read under the current tier rule; every recheck
  attempt now records `tier_rule`. Failures take the shared 12-hour second look.
- The same test applies at verify, in the conditional-$0 resolver and in Hamilton's product-page
  conflict and repeat checks (`TIER_PATH_SQL`).

**Dry run (prod, read-only, 2026-10-26):** the cohort's SQL selects 13 live $0s at 3 institutions
(the rows above). `recheckAssessment` on each, with its stored text: 12 fail `tier_perk_zero`, 28130
passes (the bank charges no NSF fee). Read against each bank's own other documents: 7 are right (the
general schedule prices the fee: 152915, 135954-135959); 1 is wrong (135960, online banking/bill
payment, which the general summary also prices "No Fee"); 4 (28131-28134) are a premier account's
perks whose general price is not in a stored text, so they are unverified. The switch stays off until
James approves the count. The 3 HSA $0s at institution 49 and Gate City's 4 are not in the cohort.

**Agent lesson:** darwin/issue-1397-tier-disclosure-addresses
**Guard:** `src/lib/agents/darwin/tier-perk.test.ts`, `src/lib/agents/darwin/verified-recheck.db.test.ts`
