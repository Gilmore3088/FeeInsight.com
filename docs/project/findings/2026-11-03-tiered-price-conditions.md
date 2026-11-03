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

**The class, live (prod, read-only, Nov 3):** of 2,981 live fees above $0 whose Knox excerpt states a
balance, amount or count condition, 88 sit in a tier group by the shared reader (`@/lib/tiered-price`), and
50 of those, at 35 institutions, are wrong: 31 are a tier whose name does not state its condition
("unscoped") and 19 are a scoped tier whose sibling tiers are not all live ("incomplete"). Moose Lake's
116685 is one (unscoped, 0 of 2 tiers live under scoped names). The 50 ids: 18812, 22129, 34461, 37262,
55140, 68550, 68551, 72020, 72021, 74644, 75943, 80578, 81377, 81422, 81866, 83996, 83997, 84084, 84085,
84502, 89440, 89748, 91565, 95341, 96889, 101785, 101786, 102393, 102642, 103056, 103078, 104534, 104545,
110375, 115586, 116120, 116685, 120265, 120270, 121611, 124568, 126548, 127659, 127660, 132800, 136874,
136933, 148646, 159922, 165707. Three are doubtful and should be read before any takedown: 148646 (its two
tiers share a price), 95341 (every tier is $25) and 102393 ("≥$10").

**Fix:**

- `src/lib/tiered-price.ts` (shared, pure): finds a tier group, two or more lines (or clauses of one line)
  of one fee, each with one balance, amount or count condition and its own price above $0, with distinct
  conditions. A cap ("maximum $150 per day"), a waiver threshold ("waived with $500 balance"), a $0 band,
  two different fees on one line, and monthly maintenance and minimum balance reads are not tiers.
- Knox v183 (`src/lib/agents/knox/tier-names.ts`): each tier read keeps its condition in its name (the
  figure back in its own slot, or the condition in brackets); a tier printed on the same line that no
  reader read gets its own read; a group Knox cannot read in full under Darwin's checks, or whose reads
  sit in two categories, is held whole as `tier_incomplete`.
- Category guard v110: a priced name's own trailing tier bracket is not read by the exclusions; includes
  still read the whole name. On 1,038 live priced names ending in a bracket with a condition, the bracket
  is read off 408 and the verdict changes on 0.
- Darwin verify: a read that is one tier of a group whose name does not state the tier is held
  (`tier_unscoped`), judged on Knox's own line and the traced line, not the name alone.
- Darwin live re-check `darwin.tier_completeness` (`tier-completeness-check.ts`), behind
  `TIER_COMPLETENESS_TAKEDOWN_LIVE`, off: the dry run above. Switching it on takes these fees down without
  replacing them until Knox re-reads their texts (Knox's stale-read floor stays at v97, so no re-read
  follows on its own); pair it with re-read requests for the 35 institutions.

**Moose Lake now:** Knox v183 reads document 35684's text as "Overdraft fee per item per presentment
(overdraft balance $30.00 or less)" $15 and "Overdraft fee per item per presentment (overdraft balance
more than $30.00)" $30; both pass Darwin's verify and the shared source check. No other read of the page
changes. The live 116685 stays until the re-check is switched on or the text is re-read.

**Agent lesson:** knox/tiered-price-2026-11-03-each-tier-keeps-its-condition, darwin/tiered-price-2026-11-03-judge-the-whole-row

**Guard:** `src/lib/tiered-price.test.ts`, `src/lib/agents/knox/tier-names.test.ts`,
`src/lib/agents/darwin/tier-completeness-check.test.ts`, the `TIER_COMPLETENESS_TAKEDOWN_LIVE` switch probe in
`src/lib/agents/deming/switch-gate.test.ts`.
