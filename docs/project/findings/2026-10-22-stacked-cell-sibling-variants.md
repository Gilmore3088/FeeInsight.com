# 2026-10-22: Knox read a cell of stacked sibling names over stacked prices as one fee

Some PDF schedules print a row's names stacked in one cell and their prices stacked in the next.
The stored text loses the line breaks, so the row runs the names together:

- State key 9308 (St Cloud Financial CU): "Wire Transfer (Within USA) Outgoing Incoming | $20.00
  $10.00" is an outgoing wire at $20 and an incoming wire at $10.

**What happened:** the shadow lab counted about 25 answer-key misses on lines whose price cell holds
two or more stacked prices, almost all in key 9308. Knox read each such row as one fee at its first
price. On the wire line the name carried both directions, so Darwin's category check refused it
(`category_mismatch`) and the incoming $10 was never read.

Listed by shape, most of the 25 are not sibling variants of one fee:
- Two different fees stacked: "Cashier's Check For Paying Bills Stop Payment | $2.00 $10.00",
  "Foreign Check Exchange Cash Letter Collection | $10.00 $25.00". Where one name ends and the
  next begins is a guess.
- Counts that differ: the box table "Safe Deposit Boxes 3 x 5 3 x 10 5 x 10 10 x 10 Lost Key
  Drilled Box" over six prices. Four sizes plus two other fees, so the sizes alone do not match the
  prices.
- Bands in the names cell: check cashing "Up to $100 $100 and over $1,000 and over" over four
  prices, and checking accounts "Reward, Regular, Dividend, Prestige Harvest Checking" over two.
- Multi-word lists: "NSF Items ... Return Item Courtesy Pay Item Deposit Item Return - ..." over
  five prices, "Wire Transfer (International) Wire out Wire recall/amendment ..." over four.

**Cause:** the line rules pair a row's prices with its names only for slash variants ("Incoming /
Outgoing | $15 / $40", v76 `pairedPriceCandidates`). A list printed with spaces only was one name
followed by a first price and a "second column" price that was dropped. The shared source check had
the same gap: it scored only the first stacked price as the row's, so a variant's own price could
not trace.

**Fix:** Knox rules v103 (#2549).
- `stackedCellVariants` (`src/lib/custom-report/stacked-cell-variants.ts`) finds the shape. It
  needs a stem plus exactly as many one-word variants of one family as there are prices. The
  families are directions (outgoing, incoming, outbound, inbound), regions (domestic,
  international, foreign) and customer types (member, non-member, customer, non-customer). No
  variant may repeat, and no word of the stem may be of that family. The stem must hold no figure,
  limit, balance or waiver, and must not end on a joiner.
- `stackedVariantReads` (`src/lib/agents/knox/rules.ts`) runs before any other line rule. It reads
  each variant at the price in the same place, but only on a row of two cells whose price cell holds
  nothing but the prices. A direction or region must change the category of every variant, and a
  customer type must keep it. A wire row is split only when its own stem says its wires are
  domestic ("Within USA", "Domestic") and names no other region. Every read must pass Darwin's
  checks, or none is made and the row is read as before.
- The shared check traces the variant's own price (`stackedVariantIndex` in `source-check.ts`).
  The price of the one variant the fee's name keeps scores as the first price does. This only
  admits: no price's score drops, so every name that traced before still traces. Knox's self-check
  and Darwin's verify use this same check on the stored text.

Near misses are tests at the read level and through Knox, Darwin's verify and the publish gate
(`runCase`). They cover counts that differ either way, a limit, a daily cap or a range in the price
cell, units after each price, and two different fees stacked. They also cover a region beside a
direction, directions that do not change the fee, a balance after the list, a third cell, and the
9308 box table.

Read diff against base 65259a2, over every Texas, seven-state and shadow-lab fixture text (289
texts): one line changed, 9308's wire line.
- The outgoing $20 read is now named "Wire Transfer (Within USA) Outgoing". Before, it carried
  both directions and Darwin refused it.
- An incoming $10 read is new.
- No other read moved, and no untraced hold was added.

Shadow lab, before -> after:
- Answer-key recall: 944 -> 946 of 1,312 (72.0% -> 72.1%).
- All-expected recall: 1,306 -> 1,308 of 1,766.
- Known-wrong fees published: 34 of 160, unchanged.
- Names: 313 of 317, unchanged. Fees outside the keys: 35, unchanged.
- Ratchet: 2 gained, 0 lost, locked in `ratchet-baseline.json`: 9308's domestic wires, incoming
  $10 and outgoing $20.

Gates, before -> after:
- Seven-state gate: 907 -> 909 right (MN 122 -> 124); 34 wrong, unchanged.
- Every seven-state floor and ceiling now equals its real count. NY's right floor (43, real 44) and
  the CA, FL, IL and NY wrong ceilings had slack from earlier rounds.
- Texas gate: 590 right / 11 wrong, unchanged. Held out: 60 / 4, unchanged.

Left out, each for its own cause:
- Stacked rows of different fees (9308's cashier's check and stop payment, foreign check and
  collection): the split between two names is a guess.
- Rows whose counts differ (9308's box table, check cashing bands, checking accounts): the rule
  never pairs them.
- Multi-word variant lists (9308's NSF items, international wires, "US Currency Foreign Currency"):
  the vocabulary is one word per variant.
- A repeated stem ("Debit Card Rush Order – Overnight FedEx Rush Order – 2 day FedEx Shipping |
  $50.00 $35.00", rush card $35).
- International variants: they still answer to the #2278 direction review, which a bare
  "International" on a stacked row does not satisfy.

The shared check's refusal side is not changed. On these rows it still lets a variant trace at the
first price ("... Incoming" at $20). Making it refuse would take fees down and needs Darwin's live
re-check with a dry-run count, which this session could not run (no database access). The stale-read
floor stays at v97 and name re-tidy at v26. Live documents get v103 on their next read. No count of
stored texts with this layout has been run.

**Review of 74e0df3.** The review found one blocker. Under "INTERNATIONAL WIRE TRANSFERS",
"FOREIGN WIRES", "Wire Transfers | International" or "Wire Transfers - International", a stacked
row "Wire Fee Outgoing Incoming | $45.00 $15.00" published a domestic outgoing wire at $45 and a
domestic incoming wire at $15. Base refused all four.
- The cause: a variant's name is not printed on the page, so `sourceOwnedWireScope` found no owner
  row. The #2278 review (`internationalWireEligibility`) then let the domestic category through as
  not applicable. Darwin's international verification has the same gap.
- The fix is in Knox: a wire row is split only when its own stem says domestic. Otherwise no
  variant is read, and the row reads as base read it.
- `sourceOwnedWireScope` was not taught the stacked cell. That would change Darwin's re-check of
  live fees: a live domestic wire whose text has such a row would move from "not applicable" to a
  hold or an ambiguous owner. This session had no database access to show that it touches no live
  fee, so that part is left for a PR with a dry-run count.
- The review also found that a stem holding a word of the list's family let the stem alone trace at
  a variant's price ("Foreign Item Collection" at $50 on "Foreign Item Collection Domestic Foreign |
  $25.00 $50.00"). Such a stem is now no list.
- All five texts are near-miss tests at the read level and through `runCase`, and they fail on
  74e0df3. Every number above is unchanged by the fix, and the read diff is the same single line.

**Lesson:** A cell of stacked names over a cell of stacked prices is one fee per name only when the
names are one family of siblings, as many as the prices, and the price cell holds nothing else.
Otherwise read the row as before.

**Guard:** `src/lib/agents/knox/stacked-cell-variants.test.ts`; the seven-state gate floors (MN
124, all 909 / 34); the shadow lab ratchet baseline. Agent lesson: knox/stacked-cell-variants.
