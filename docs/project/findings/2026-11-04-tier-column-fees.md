# 2026-11-04: A relationship-tier table is one fee per tier (Knox v185, behind a switch)

**What happened:** `findings/2026-11-04-tier-matrix-misses-7450.md` traced Schools FCU's (answer key
state:7450) 15 replay misses. James then decided how a relationship-tier table is keyed and read
(DECISIONS 2026-11-04): one fee per tier, named with its tier in title case from the header, $0 tiers
included; a row with the same price in every tier is one fee; a free allowance ("1 Free → $5") is a
condition on the priced fee, not a $0 fee; the live re-check ships off with its count pending. This
change builds those decisions behind two off switches.

**Cause, at each step** (main, Knox v184, on the page "PLATINUM GOLD SILVER+ SILVER COLLEGE" over rows
such as "Courtesy Pay $20 $30 $30 $30 $30"):

- Knox (extraction): v100 split a tier row into one read per distinct price named with the row's name
  alone, wrote no $0 for a free tier beside priced ones, and left allowance rows as printed, so the
  allowance's count and glyph stayed in the name ("Cashier Checks 3 Free \"").
- Shared source check: it supports only a row's first price, so Knox's self-check held "Courtesy Pay"
  $30 `untraced`, and "Courtesy Pay" $20, the PLATINUM tier's price alone, went out as the overdraft fee
  with no tier (the #2981 error class).
- Wire scope review (`sourceOwnedWireScope`): a cell printing five prices is `unsupported_shape`, so the
  uniform row "Incoming Wire Tranfer - International $10 $10 $10 $10 $10" was declined with no hold.
- Darwin verify: the conditional-$0 check reads a free tier's $0 on a row with prices as a condition.
- Hamilton publish: two reads at one price from one line are one fee (`prior:identical`), so the tiers
  that charge the same would collapse into the first one's name.

**Fix** (`src/lib/tier-column-table.ts`, shared and pure; `TIER_COLUMN_FEES_LIVE`, off):

- Knox v185 (`withTierColumnFeeRows`, `knox/tier-columns.ts`): a row whose tiers differ is one
  "Name (Tier) | price" line per tier ("Courtesy Pay (Platinum) | $20", "Stop Payment (Platinum) |
  Free"); a not-offered cell gives no line; a uniform row is one fee (a price left as printed, free in
  every tier "Name | Free"); an allowance cell is "Name | $5 (first 1 free)", so the name loses the
  allowance, the excerpt keeps it as the condition, and no $0 is read.
- The shared source check traces a tier name to its own cell and refuses any other tier's price
  (`tierColumnFeeCheck` inside `checkFeeAgainstSource`, an extension, not a second check).
- The wire scope review reads a tier table row of equal prices as one price.
- Darwin's conditional-$0 check takes a tier's own free cell as its fee.
- Hamilton's same-line check keeps two tiers at one price as two fees.
- The header is positive evidence only (review of #2993): at most one label may be no tier word, and a rank
  word (PREFERRED, PREMIER, ELITE, PRESTIGE) counts only beside a metal or gem, so "PREFERRED PREMIER
  CHECKING" arms nothing. A row with a no-price cell before its tier cells ("—", "Varies", "N/C", "None")
  is one cell too many and is not read.
- The discontinued-account refusal (#2070) reads a tier fee's row by the row's name; business-only rows
  never reach a tier read, because Knox drops them before the tier split.
- Off, every Knox read is v184's (`tier-columns-per-tier.test.ts` checks the off read byte for byte). What
  off still adds: Darwin's re-check runs its read-only SQL each verify step and writes a `darwin.tier_column`
  event when it finds a match.

**Darwin live re-check** `darwin.tier_column` (`tier-column-check.ts`, `TIER_COLUMN_TAKEDOWN_LIVE`, off):
every live fee of a document whose stored text has a tier header line, judged on that text. A tier row's
name with no tier, on a row whose tiers charge differently, at one tier's amount, is `unscoped` (the
switch's; second look, then archived as `tier_column_unscoped`); a name keeping an allowance's words is
`allowance_name`, report only. A fee is judged only when Knox's stored line (the extraction note's
excerpt) is the tier row's own: the row as printed, or a cut of it from its start that reaches past its
first cell, or v100's split line "<row name> | <price>" at a price the row charges, and a cut or split form
only when no other line of the page prints it (v100's split lines are Knox's rewrite and never appear in
stored text). The review of #2993 found the first cut matched by name and amount alone, so a business
section's own "Stop Payment $25 per item" below the tier table would have been taken down; its re-review
found a business "Courtesy Pay $20" (a prefix of the tier row) and a printed "Stop Payment | $25" still
matched. What cannot be proved is refused: state:7450's allowance excerpts ("Debit/Credit Card
Replacement* 1 Free → $5") stop at the first cell, so the report-only `allowance_name` kind does not count
them; its split excerpts ("Courtesy Pay | $20", "Stop Payment | $25") still match. A name two tier rows carry with different cells is refused as ambiguous, by this check and
by the shared source check. It acts only while `TIER_COLUMN_FEES_LIVE` is on too, because a takedown
adds no fee: the scoped tier fees come from Knox's re-read. **Dry run: count pending.** This session had
no database access; `npm run audit:switch-dry-runs` section 12 counts it on prod (read-only), and James
runs it before either switch flips. Live accuracy stays the audit's last section (13).

**Measured** (offline; `SHADOW_LAB_EXPERIMENT=tier-column-fees npm run test:shadow-lab`, files under
`test-results/shadow-lab/`):

| Measure | Switch off (today) | Switch on |
|---|---|---|
| Frozen lab: answer-key recall | 973 / 1,302 | 979 / 1,302 |
| Frozen lab: false publication | 29 / 160 | 29 / 160 |
| Frozen lab: published fees not in the answer key | 30 | 30 |
| Source replay: recall | 922 / 1,216 | 928 / 1,216 |
| Source replay: keys lost / published outside the key, added | | 0 / 0 |
| Golden set (switch gate, `TIER_COLUMN_FEES_LIVE`) | recall 1,341 / 1,766 | 1,347 / 1,766, 0 lost |
| Frozen lab: all expected fees (answer keys, category cases, live audit) | 1,341 / 1,756 | 1,347 / 1,756 |

The two 1,341 lines are different measures: the golden set's 1,766 is its committed baseline
(`deming/__fixtures__/golden-gate-baseline.json`, publish stage: 1,766 expected, 1,341 found), and the lab's
1,756 is its "all expected fees" line in `report.md`.

- The 6 keys gained, all state:7450, each checked by hand against the page's row and header:
  atm_non_network $0 (PLATINUM's FREE on "ATM Transaction (Non Co-Op) FREE $1 $1 $1 $1"), notary_fee $0
  (PLATINUM and COLLEGE FREE), returned_mail $0 (PLATINUM, GOLD, SILVER+ and COLLEGE FREE; the key's
  account_research row, filed by the gate as returned_mail), stop_payment $0 (PLATINUM FREE), overdraft $30
  (GOLD to COLLEGE on "Courtesy Pay $20 $30 $30 $30 $30") and wire_intl_incoming $10 (the uniform
  "Incoming Wire Tranfer - International" row).
- Still missed at state:7450: card_replacement $0 and cashiers_check $0. They are allowance $0 keys, and
  James decided (Nov 4) that the answer key is re-keyed in a separate migration PR, which needs his yes
  before it merges, because the key also lives in prod's `answer_key_fees` (seed
  `20270110000018_answer_key_seed.sql`). This PR leaves the fixture and the golden set as they are, so they
  stay known misses until that PR lands. The other 7 misses are category holds the finding of Nov 4 traced.
- The two allowance fees now publish as "Debit/Credit Card Replacement" $5 and "Cashier Checks" $5, with
  "first 1 free" and "first 3 free" in their excerpts.

**Lesson:** a page's own header is the evidence a tier fee is named by. Read each tier's cell under its
header label, trace it to that cell, and keep tiers at one price apart, or one tier's price shows as the
bank's only price.

**Agent lesson:** knox/issue-1092-2026-11-04-one-fee-per-tier-column, darwin/issue-1092-2026-11-04-tier-cell-is-the-tiers-fee

**Guard:** `src/lib/tier-column-table.test.ts`, `src/lib/agents/knox/tier-columns-per-tier.test.ts`,
`src/lib/agents/darwin/tier-column-check.test.ts`, the `TIER_COLUMN_FEES_LIVE` switch probe in
`src/lib/agents/deming/switch-gate.test.ts`, the source replay's `tier-column-fees` test (no key lost, nothing
new outside the key) and section 12 of `src/lib/agents/deming/switch-dry-runs/run.test.ts`.
