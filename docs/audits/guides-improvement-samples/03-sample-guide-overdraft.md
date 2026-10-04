# Sample 03 — `overdraft-fees` rewritten to spec

Reference implementation of what a guide should look like. Compare against the shipping
version: **138 words, 3 sections, 0 of the 3 mandated sections present, every dollar figure
hardcoded.** This draft is **~950 words, 7 sections, every figure data-bound** via the
`{{category.stat}}` tokens from sample 01.

Nothing here has been written into `src/lib/guides.ts`. This is the target, not a patch.

Tokens render at request time from the same `getFeeCategorySummaries()` call the page
already makes, so the prose and the benchmark cards cannot disagree.

---

## What the reader sees today

> **Understanding Overdraft Fees**
>
> **What is an overdraft fee?**
> An overdraft fee is charged when a transaction exceeds your available balance and the
> bank covers the difference. These fees typically range from $25 to $38 per occurrence,
> though some institutions have eliminated them entirely. Overdraft fees remain one of the
> most significant sources of non-interest income for banks and credit unions.
>
> *(2 more paragraphs of the same length. 138 words total. "$25 to $38" is a literal in
> `guides.ts:25`; the live median renders in a card beside it with nothing reconciling the
> two. "non-interest income" is industry vocabulary in a consumer guide.)*

---

## Target draft

### Overdraft Fees: What They Cost and How to Stop Paying Them

*SEO title: "Understanding Overdraft Fees: What Banks Charge and How to Avoid Them"*

**What is an overdraft fee?**

An overdraft fee is what your bank charges when it lets a payment go through even though
your account doesn't have enough money to cover it.

Say you have $40 in checking and your $60 car insurance payment hits. Your bank has a
choice: pay it and charge you a fee, or decline it and charge you a different fee. If it
pays it, that's an overdraft. You now owe the $20 shortfall plus the fee.

The fee is flat. It doesn't scale with how far you went below zero. Overdrawing by $3 and
overdrawing by $300 usually cost you exactly the same.

**How much does it cost?**

Across the {{overdraft.institutions}} banks and credit unions we track:

- **Typical charge:** {{overdraft.median}} — the national median
- **Most banks fall between:** {{overdraft.p25}} and {{overdraft.p75}}
- **The highest we've recorded:** {{overdraft.max}}
- **Institutions charging nothing:** {{overdraft.zero_count}}

Two numbers matter more than the fee itself.

The first is the **daily cap** — the maximum your bank will charge in a single day. The
median cap is {{od_daily_cap.median}}. Without a cap, three overdrafts in one afternoon
cost you three full fees. With one, you stop at the ceiling.

The second is the **overdraft protection transfer fee** — what your bank charges to pull
money from your own savings instead of charging you an overdraft. The median is
{{od_protection_transfer.median}}, against an overdraft median of {{overdraft.median}}.
Linking a savings account is usually the single highest-return thing you can do here, and
it takes about five minutes.

**Who charges the most, and who charges the least?**

Three patterns hold up consistently in the data.

*Large national banks charge the most.* They also tend to have the highest daily caps,
which means a bad week compounds faster.

*Credit unions charge less.* Not always dramatically less, but consistently — and they're
far more likely to cap the number of fees per day.

*Online-only banks are the outliers.* Several have removed the overdraft fee entirely,
usually paired with a small no-fee cushion — they'll cover you up to $50 or $100 and just
ask you to bring the balance back up.

You can see the split for yourself: our
[bank-versus-credit-union breakdown](/fees/overdraft) shows medians by charter type, asset
size and state.

**How to avoid or reduce this fee**

1. **Link a savings account for overdraft protection.** The transfer costs about
   {{od_protection_transfer.median}} instead of {{overdraft.median}}. This is the biggest
   single saving available to most people.
2. **Opt out of debit card overdraft coverage.** Federal rules (Regulation E) mean your
   bank *cannot* charge you an overdraft fee on everyday debit card purchases or ATM
   withdrawals unless you opted in. If you opted in years ago and forgot, you can opt back
   out today. Your card will simply be declined instead — no fee.
3. **Turn on low-balance alerts.** Most overdrafts are timing accidents, not spending
   problems. A text at $50 prevents most of them.
4. **Move your bills to just after payday.** Two or three days of daylight between deposit
   and debit removes most of the risk.
5. **Ask for a refund.** Banks routinely waive a first overdraft fee for a customer in good
   standing. Ask once, politely, by phone. It works more often than people expect.
6. **If it keeps happening, change banks.** {{overdraft.zero_count}} institutions in our
   index charge nothing. Paying {{overdraft.median}} several times a year is a reason to
   move, not a fact of life.

**What regulators say**

Two federal rules give you leverage.

**Regulation E** requires your bank to get your explicit permission — opting *in* — before
it can charge you overdraft fees on one-time debit card purchases and ATM withdrawals. If
you never opted in, those transactions should be declined at no cost. Checks and automatic
bill payments are not covered by this rule; banks may pay those and charge you regardless.

**Regulation DD** (the Truth in Savings Act) requires your bank to disclose its fees to you
in writing and to show total overdraft fees charged on your periodic statements — both for
the statement period and year-to-date. That year-to-date figure is worth finding. Most
people underestimate their annual total by a wide margin.

The CFPB accepts complaints about overdraft practices, and overdraft is consistently among
the most-complained-about consumer banking topics.

**Compare your own bank**

Pull up your bank's fee schedule — it's usually called "Schedule of Fees" or "Truth in
Savings Disclosure" — and find the overdraft line. Then:

| If your bank charges | Where that puts you |
| --- | --- |
| {{overdraft.p25}} or less | Better than 75% of institutions |
| Around {{overdraft.median}} | Right at the national median |
| More than {{overdraft.p75}} | You're paying more than 75% of the country |
| More than {{overdraft.p75}}, with no daily cap | Worth switching over |

Then check two more lines: the daily cap and the overdraft protection transfer fee. A bank
with a middling overdraft fee, a tight daily cap and cheap savings transfers will cost you
far less in practice than one with a low headline fee and neither.

[Look up your institution →](/institutions)

---

*Fee data from the Fee Insight National Fee Index, covering {{overdraft.institutions}}
institutions' published fee schedules. Medians reflect the most recent collection period.
Individual banks change fees without much notice — always check your own institution's
current schedule.*
*Last reviewed: 2026-08-15 · Fee Insight Research · [Methodology](/methodology)*

---

## What changed, and why

| Change | Finding addressed |
| --- | --- |
| 138 → ~950 words, 3 → 7 sections | C-1, C-2 |
| Every dollar figure is a token, not a literal | **P-2** — removes the drift risk entirely |
| "What Regulators Say" section added (Reg E opt-in, Reg DD statement totals) | C-2 |
| "Compare your own bank" section with a benchmarking table | C-2, U-1 |
| Charter comparison links to the live `by_charter_type` breakdown instead of asserting it | C-3 |
| Lists, bold figures, a table, inline links | C-4 — requires the block model from sample 01 |
| Explicit link to `/institutions` | **U-1** — the missing "check my own bank" path |
| Attribution + review date + methodology link | C-7, P-4 |
| Opens with a concrete $40/$60 scenario; "non-interest income" removed | skill: 8th-grade reading level, second person |
| Surfaces `od_daily_cap` and `od_protection_transfer` as decision inputs | the guide's other two categories were previously decoration |

Reading-level check: the target draft averages ~14 words per sentence with almost no
subordinate clauses, which lands in the Grade 7–8 band the skill asks for.
