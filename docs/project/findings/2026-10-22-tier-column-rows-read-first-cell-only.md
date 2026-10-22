# 2026-10-22: Knox read only the first tier of a relationship-tier fee table

A table that prints one price per relationship tier on each fee row has to be read cell by cell: the
first cell is often a top tier's perk, not the price most customers pay.

**What happened:** The shadow lab's answer-key misses were grouped by cause across both scenarios
(missed fees and the W43 live audit). One stored text, State key 7450 (CA), prints a header row
naming five tiers, "PLATINUM GOLD SILVER+ SILVER COLLEGE", over fee rows with one cell per tier:
"Stop Payment FREE $25 $25 $25 $25", "ATM Transaction (Non Co-Op) FREE $1 $1 $1 $1", "Returned
Mail (Bad Address) FREE FREE FREE $5 FREE", "Courtesy Pay $20 $30 $30 $30 $30". 21 of that key's
fees were missed. For every row free in its first tier, Knox held an untraced $0 and never read
the price the other tiers pay.

**Cause:** Knox's line rules read one price per line, the first. A row of tier cells is one line, so
every cell after the first was dropped.

**Fix:** Knox rules v100. `withTierColumnRows` (`src/lib/agents/knox/tier-columns.ts`), run in
`runFreeSpecialists` beside the sideways box table, finds a header row of 3 to 8 distinct
upper-case tier labels. A section title is not a header: its words (OF, AND, FEES, CHARGES,
SCHEDULE, ...) are excluded. Under the header, a row whose trailing cells number exactly the
header's tiers becomes one "name | price" line per distinct priced cell, in the tiers' order. Two
more rules:
- A free cell beside priced ones gives no $0 line. That cell is one tier's perk (Darwin's tier-perk
  rule, #1397).
- A row free in every tier gives one "name | Free" line.

These rows are left as printed:
- One price in every tier (Knox already read it).
- Allowance cells ("3 Free " $5").
- "Varies".
- Any line with no header above it.

Admit-only: no fee Knox read before is dropped. A row's first-tier price is still read, and no
rule holds, rejects or re-files a fee. The self-check and Darwin's verify trace the new reads on the
stored text unchanged. One new read, "Courtesy Pay" at $30, does not trace there: the shared check
takes "$20 $30" as a range. Darwin refuses it and it never publishes.

Shadow lab, before -> after:
- Answer-key recall: 924 -> 927 of 1,312 (70.4% -> 70.7%).
- All-expected recall: 1,286 -> 1,289 of 1,766.
- Live audit recall: 339 of 431, unchanged.
- Known-wrong fees published: 34 of 160, unchanged.
- Ratchet: 3 gained, 0 lost. The gains are 7450's stop payment $25, non-network ATM $1 and returned
  mail $5, locked in `ratchet-baseline.json`.

Gates, before -> after:
- Seven-state gate: 885 -> 891 right (CA 153 -> 159), 34 wrong unchanged.
- Texas gate: 590 right / 11 wrong. Held out: 60 / 4. Both unchanged.

The rest of 7450's priced tiers have other causes, left for their own rounds:
- "Monthly Account Maintenance" is a name Knox does not file.
- "Direct Checking" and "Advantage Checking" are bare account names, held unclassified.
- Hamilton's name hold takes "Notary Service (excluding CU business)" as a cut-off name.
- The $30 Courtesy Pay tier does not trace (see above).

The answer key also keys each tier perk as its own $0 fee; Knox does not follow that, by the
tier-perk rule.

The stale-read floor stays at v97 and name re-tidy at v26. Live documents get v100 on their next
read. How many stored texts print a tier table is not measured: no dry-run count has been run.

**Lesson:** A row with one price cell per column is several fees on one line. Read each column's
price under its header, and treat a free cell beside priced ones as a perk, not a price.

**Guard:** `src/lib/agents/knox/tier-columns.test.ts`; the seven-state gate floor (CA 159, all 891);
the shadow lab ratchet baseline. Agent lesson: knox/tier-column-rows.
