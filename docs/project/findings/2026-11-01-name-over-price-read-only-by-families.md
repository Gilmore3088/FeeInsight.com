# 2026-11-01: a fee's name over its price was read only where a family reader paired the lines
**What happened:** the shadow lab (Knox v148) never read State key 2017's counter check:

```
Counter Checks
5 free - $0.25/after
```

v147 reads that allowance on a label row ("Counter Checks | 5 free - $0.25/after" publishes counter_check
$0.25), and #2831's follow-up on #1092 logged the stacked form as still unread. Live audit 1082's "ATM Card
(Lost or Stolen)" over "$5.00 Per Card" was not read either.

**Cause:** Knox has no general reader for a name on one line over its price on the next. Each family reader
(overdraft, checks, services, account and so on) pairs the lines for its own categories and its own price
shapes. A pair that no family claims stays unread: the price line names no fee, and the name line holds no
price. To measure the gap, every two-cell label row base reads in the lab (514) was re-printed as a name line
over a price line. Base's family readers read 461 of them stacked. 53 were not read.

**Fix (Knox v150, `knox/stacked-rows.ts`, admit-only):** the two lines are read as the label row they state,
so every field (name, category, frequency, audience, heading and the v147 allowance rules) is base's own read
of that row. A pair qualifies only when:
- the name line holds no price, rate or cell;
- the name line is short, is not a sentence, condition or section title, and names a fee by base's classifier;
- the price line opens with its one price, or with a counted free allowance before it;
- the price line names no fee of its own after the price;
- the price line holds no other price, rate, cell, "or" choice, and no limit, cap, minimum, balance, deposit or
  opening word.

On those grounds a description line between a name and its price ("Counter Check" / "An emergency check when
you don't have any checks left" / "$1 per check") pairs nothing.

A row read is added only when all of these hold:
- base reads and holds nothing from either line;
- base reads no fee of that name (tidied, letters and digits only);
- base reads no fee of that category at that price;
- it is the row's only read;
- it traces to the stored text by the shared check.

No read that publishes today is repriced, re-filed or dropped, so there is no switch. The shared check is
unchanged.

Of the 53 stacked rows base missed, v150 reads 24, each exactly as base reads the row. The other 29 are left
out by the price-line rules above: a balance or other condition after the price, two prices, or an "or"
choice.

**Measured:**

| Measure | Main (v148) | v150 |
|---|---|---|
| Lab answer-key recall | 956 / 1,312 | 957 |
| Lab, all expected fees | 1,322 / 1,766 | 1,324 |
| Lab false publication | 33 / 160 | 33 |
| Seven-state gate (right / wrong) | 915 / 30 | 916 / 30 (MN 126) |
| Texas gate (right / wrong) | 589 / 11 | 589 / 11 |

The read diff over all 291 Texas, seven-state and lab texts adds 7 Knox reads on 5 texts and removes or
changes none. Two publish: 2017's counter check $0.25, and 1082's lost ATM card $5, which Darwin re-files as a
card replacement as it does the label row. Darwin refuses the other five exactly as it refuses the same label
rows: 2001's overdraft $3 (envelope) and Christmas club withdrawal (category), Texas 847's "Overdraft Returned"
$40 and 5666's "Return Item/Deposit" $10 (category), and 1082's "Subordination" $350 (envelope).

**Not measured:** this session had no production access, so how many live documents print the shape is not
known. The new signature sends live documents through Hamilton's rules re-check, as for every bump.

**Lesson:** when pairing a name with its price is left to each family's reader, a pair no family claims is
silently lost. Read a layout as the rows it states with base's own row reader, and only add what base does not
already read.

**Agent lesson:** knox/issue-1092-name-over-its-price
**Guard:** `src/lib/agents/knox/stacked-rows.test.ts`
