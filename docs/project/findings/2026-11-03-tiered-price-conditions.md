# 2026-11-03: A fee priced in tiers lost each tier's condition, and one tier went live as the only price

**Lesson:** A price that holds only under a condition (a balance, an amount, a count) is a different fee
from the price beside it under another condition. Each tier keeps its condition in its name, the tiers stay
separate fees under one category, and a fee is never published with fewer tiers than the page prints.

**What happened:** The owner's audit (Nov 3) found First National Bank of Moose Lake (institution 3457,
document 35684, Rosetta artifact 33778) live with one overdraft price, $30 (live 116685), under the name
"Overdraft fee per item per presentment". The page prints two tiers:

    $30.00 or less – Overdraft fee per item per presentment. | $15.00 per item
    More than $30.00 – Overdraft fee per item per presentment. | $30.00 per item

Knox wrote raw 760358 ($15, "or less – Overdraft fee per item per presentment") and raw 760359 ($30,
"Overdraft fee per item per presentment"). Darwin refused 760358 as `category_mismatch` and passed
760359, so the $30 tier went live as the bank's overdraft fee and the $15 tier went nowhere.

**Cause, at each step:**

- Knox (extraction): the name builders drop every dollar figure on a line as a price, so the threshold
  "$30.00" was stripped from both names. The $15 name kept the words "or less" with no figure; the $30 name
  kept nothing of its condition. No step checked that two reads on adjacent lines of one fee at two prices
  were tiers of one fee.
- Darwin (verification), 760358: the category guard judged the name alone, and its overdraft exclusions
  read "or less" as a waiver threshold (`name_contradicts`). The scoped name "Overdraft fee per item per
  presentment (overdraft balance $30.00 or less)" failed the same exclusion at guard v109, so even a right
  name would have been refused.
- Darwin (verification), 760359: the shared source check (`checkFeeAgainstSource`) answers `tiered_fee` for
  such a row, verify counts that as stated, and with no traced line no later check read the condition on
  the row. The name was judged, not the row.
- Nothing checked that the live tiers of a group were all there (completeness).

**The class, live (prod, read-only, Nov 3, re-run after the review of #2981):** of 2,982 live fees above
$0 whose Knox excerpt states a balance, amount or count condition, 86 sit in a tier group by the shared
reader (`@/lib/tiered-price`), and 48 of those, at 33 institutions, are wrong in one of two ways:

- 31, at 26 institutions, are a tier whose name does not state its condition ("unscoped"). These are the
  re-check's takedowns: 22129, 34461, 55140, 68551, 72020, 72021, 75943, 80578, 81422, 81866, 83996, 83997,
  84084, 96889, 101785, 102393, 102642, 103056, 104534, 104545, 115586, 116120, 116685, 120270, 121611,
  124568, 127659, 132800, 136874, 159922, 165707. Moose Lake's 116685 is one (0 of 2 tiers live under
  scoped names). 102393 is doubtful and should be read before any takedown (its upper tier reads "≥$10").
- 17 are a correctly scoped tier whose sibling tiers are not all live ("incomplete"): 18812, 37262, 68550,
  74644, 81377, 84085, 84502, 89440, 89748, 91565, 101786, 103078, 110375, 120265, 126548, 127660, 136933.
  Their own name and price are right, so the re-check counts them, report only; the missing tier is Knox's
  to read.

The first run (before the review) counted 50: 95341 (every tier $25) and 148646 (both tiers $35) were one
price under every condition, which is no tier group.

**Fix:**

- `src/lib/tiered-price.ts` (shared, pure): finds a tier group, two or more lines (or clauses of one line)
  of one fee, each with one balance, amount or count condition and its own price above $0, with distinct
  conditions and at least two different prices. Not tiers: a cap ("maximum $150 per day"), a waiver
  threshold ("waived with $500 balance"), a rate's minimum ("over $1,000 0.25% with a $50.00 minimum": a
  line that prints a percentage or a minimum is no tier, so no flat fee is made from the floor), a $0 band,
  one price under every condition, monthly maintenance and minimum balance reads, and clauses of one line
  that each name their own fee ("Cashier's check over $1,000 $10.00; Money order up to $1,000 $5.00": two
  fees, each read as before).
- Knox v183 (`src/lib/agents/knox/tier-names.ts`): each tier read keeps its condition in its name (the
  figure back in its own slot, or the condition in brackets); a tier printed on the same line that no
  reader read gets its own read; a group Knox cannot read in full under Darwin's checks, or whose reads
  sit in two categories, is held whole as `tier_incomplete`.
- Category guard v110: a priced name's own trailing tier bracket is not read by the exclusions when the
  only words before its condition are the threshold's own noun ("overdraft balance", "item amount",
  "balance"); a bracket with any other word ("international over $1,000", "continuous over $5") is read
  as before, so its category words still reach the exclusions. Includes still read the whole name. On
  1,038 live priced names ending in a bracket with a condition, the bracket is read off 137 and the
  verdict changes on 0.
- Darwin verify: a read that is one tier of a group whose name does not state the tier is held
  (`tier_unscoped`), judged on Knox's own line and the traced line, not the name alone.
- Darwin live re-check `darwin.tier_completeness` (`tier-completeness-check.ts`), behind
  `TIER_COMPLETENESS_TAKEDOWN_LIVE`, off, reading a window of whole lines around the fee's line. Switched
  on, it takes down only the unscoped kind (`TIER_COMPLETENESS_TAKEDOWN_KINDS`). A takedown is not
  replaced until Knox re-reads the text (Knox's stale-read floor stays at v97, so no re-read follows on
  its own); pair it with re-read requests for the 26 institutions.

**Moose Lake now:** Knox v183 reads document 35684's text as "Overdraft fee per item per presentment
(overdraft balance $30.00 or less)" $15 and "Overdraft fee per item per presentment (overdraft balance
more than $30.00)" $30; both pass Darwin's verify and the shared source check. No other read of the page
changes. The live 116685 stays until the re-check is switched on or the text is re-read.

**Agent lesson:** knox/tiered-price-2026-11-03-each-tier-keeps-its-condition, darwin/tiered-price-2026-11-03-judge-the-whole-row

**Guard:** `src/lib/tiered-price.test.ts`, `src/lib/agents/knox/tier-names.test.ts`,
`src/lib/agents/darwin/tier-completeness-check.test.ts`, the `TIER_COMPLETENESS_TAKEDOWN_LIVE` switch probe in
`src/lib/agents/deming/switch-gate.test.ts`.
