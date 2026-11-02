# 2026-11-01: a fee's name over its price was read only where a family reader paired the lines
**What happened:** the shadow lab (Knox v150) never read live audit 1082's lost ATM card:

```
ATM Card (Lost or Stolen)
$5.00 Per Card
```

Printed on one line ("ATM Card (Lost or Stolen) | $5.00 Per Card") base reads it, and Darwin files it as
card_replacement $5 per card, which is the audited price. #2831's follow-up on #1092 logged the same gap for
State key 2017's "Counter Checks" over "5 free - $0.25/after".

**Cause:** Knox has no general reader for a fee's name on one line over its price on the next. Each family
reader (overdraft, checks, services, account and so on) pairs those lines for its own categories and price
shapes, so a pair no family claims stays unread: the price line names no fee and the name line holds no
price. As a measure, every two-cell label row base reads in the lab (514) was re-printed as a name line over a
price line, under a section title: base's family readers read 461 of them stacked.

**First cut, and what the review found:** #2863's first head (e9efb05) read any such pair that its
refusal list did not stop. The exact-head review found six shapes where it published a fee main does not:
- a price-first list read one line off ("$10.00 / ATM Card Lost / $5.00");
- two columns merged into one name ("ATM Card (Lost or Stolen)      Night Deposit Bag");
- a discontinued or no-longer-charged fee;
- a business price published for everyone;
- a bound or partial price ("per day total", "starting at", "plus shipping", "each additional");
- a unit on the next line ("$10.00" / "per hour" published flat).

**Fix (Knox v151, `knox/stacked-rows.ts`, admit-only, on allow-lists):** the two lines are read as the label
row they state, so every field is base's own read of that row. Instead of refusing shapes one at a time, a pair
qualifies only when all of these hold:
- the price line is a plain price with at most one unit base's label-row reader maps, or v147's allowance
  form;
- the name line is one cell (no column gap or tab), names a fee by base's classifier, and names no limit,
  threshold, audience or retired fee;
- the pair's section, heading to heading, names no audience and no retired fee;
- the line before the name is not a price line, unless it closes a run of name / price pairs that opens on a
  fee's name;
- the line after the price is neither a price line nor a unit or condition.

A row read is then added only when base reads and holds nothing from either line, base reads no fee of that
name, base reads no fee of that category at that price (Knox's hint and the category Darwin files, by
`refileCategory`), it is the row's only read, and it traces to the stored text. No read that publishes today
is repriced, re-filed or dropped, so there is no switch. The shared check is unchanged. Of the 514 re-printed
rows, v151 reads 480 (19 more than base's 461), each exactly as base reads the row.

**Measured:**

| Measure | Main (v150) | v151 |
|---|---|---|
| Lab answer-key recall | 956 / 1,312 | 956 |
| Lab, all expected fees | 1,322 / 1,766 | 1,323 |
| Lab false publication | 33 / 160 | 33 |
| Seven-state gate (right / wrong) | 915 / 30 | 915 / 30 |
| Texas gate (right / wrong) | 589 / 11 | 589 / 11 |

The read diff over all 291 Texas, seven-state and lab texts adds 2 Knox reads on 2 texts and removes or
changes none. One publishes: 1082's lost ATM card, card_replacement $5 per card. Darwin refuses the other,
2001's "Overdraft Fee" / "$3.00 per item" (envelope), as it refuses the same label row.

State key 2017's counter check, which e9efb05 read, stays unread: two lines above the pair, its section prints
"Croix Club members" in another fee's waiver, and an audience word anywhere in the section leaves the pair
unread.

**Not measured:** this session had no production access, so how many live documents print the shape is not
known. The new signature sends live documents through Hamilton's rules re-check, as for every bump.

**Lesson:** when pairing a name with its price is left to each family's reader, a pair no family claims is
silently lost. When a new reading has a small recall gain, gate it with allow-lists of what it may read, so
anything ambiguous drops, rather than a refusal list that each review extends.

**Agent lesson:** knox/issue-1092-name-over-its-price
**Guard:** `src/lib/agents/knox/stacked-rows.test.ts`
