# 2026-11-04: Most of state:7450's "tier matrix" misses wait on a keying decision, not on Knox

**What happened:** PR #2991's finding (`findings/2026-11-03-pdf-structure-tags.md`) said the 15
misses at Schools FCU (answer key state:7450) on the source replay "come from what Knox does with a
tier matrix (R3)". Before changing Knox, each miss was traced on main 9c54e198c (Knox v184, after
#2981, #2983 and #2984) to its stored line and to what Knox and Darwin do with it. Its outcome is
**no build**: of the 15, only 2 are Knox's tier-matrix reading, and the largest group needs a
keying decision James has not made. No production code changed.

**Method** (offline, no database, no provider):
- `npm run test:shadow-lab` on main: frozen lab recall 973 / 1,302, false publication 29 / 160;
  source replay recall 922 / 1,216, 28 published outside the key. state:7450: 25 of 40 found on
  both the frozen text and the re-read, and the two texts are the same (`textChanged: false`).
- A probe ran the lab's `currentVariant` over the state:7450 case and listed each stage's reads,
  holds and refusals (`data/2026-11-04-tier-matrix-7450/zz-probe-7450.test.ts.txt`, output
  `probe-7450.txt`). A second probe ran `runFreeSpecialists` on single rows under the tier header
  (`zz-probe-tier.test.ts.txt`, output `probe-tier-rows.txt`). Both are stored as `.txt` so they do
  not run in CI.
- The key is the hand-keyed row set in `knox/__fixtures__/state-answer-keys.json.gz` (tid 7450),
  as the golden set (`deming/__fixtures__/golden-set.json`, `shadow:missed_fees:state:7450`) carries
  it. Its 41st row, eStatements $0, is left out of recall on both sides as
  `retired_category_no_home` (Darwin refuses it as `retired_category`), so 40 count.

**The page:** one table under the header "PLATINUM GOLD SILVER+ SILVER COLLEGE", five
relationship tiers, each row printing one cell per tier. Knox v100 (`knox/tier-columns.ts`) splits a
row into one "name | price" line per distinct priced cell, writes no $0 line for a free cell beside
priced ones (its comment: "one tier's perk, not the bank's price", citing Darwin's tier-perk rule,
#1397), and leaves rows whose cells are not single tokens ("1 Free → $5") as printed.

**The key's convention:** every distinct value a row prints is keyed, $0 included. "Stop Payment
FREE $25 $25 $25 $25" is keyed $0 and $25. "Debit/Credit Card Replacement* 1 Free → $5 ..." is keyed
$0 and $5, and "Cashier Checks 3 Free " $5 ..." $0 and $5. So the key counts a free tier cell and a
free allowance ("first N free") each as a $0 fee.

**The 15 replay misses by mechanism** (stage and reason from `source-replay.json`, line and
outcome from `probe-7450.txt`):

| Mechanism | Key | Stored line | What main does |
|---|---|---|---|
| A. Free tier cell beside priced cells | atm_non_network $0 | ATM Transaction (Non Co-Op) FREE $1 $1 $1 $1 | reads $1 only (v100 writes no $0 line) |
| | notary_fee $0 | Notary Service (excluding CU business) FREE $10 $10 $10 FREE | reads $10 only |
| | returned_mail $0 | Returned Mail (Bad Address) FREE FREE FREE $5 FREE | reads $5 only |
| | stop_payment $0 | Stop Payment FREE $25 $25 $25 $25 | reads $25 only |
| B. Free allowance ("N Free → $5") | card_replacement $0 | Debit/Credit Card Replacement* 1 Free → $5 (x5) | reads $5 only, named "Debit/Credit Card Replacement 1 Free →" |
| | cashiers_check $0 | Cashier Checks 3 Free " $5 (x5) | reads $5 only, named "Cashier Checks 3 Free "" |
| C. Second price in a tier row | overdraft $30 | Courtesy Pay $20 $30 $30 $30 $30 | splits to "Courtesy Pay \| $30", held `untraced`: the self-check traces on the unsplit text, where the shared source check does not support the second price (v100, on purpose) |
| D. Uniform row, international wire | wire_intl_incoming $10 | Incoming Wire Tranfer - International $10 $10 $10 $10 $10 | read, then dropped without a hold: `sourceOwnedWireScope` (`custom-report/own-wire-scope.ts`) finds five prices in the cell (`prices.length !== 1`), so the direction review declines it. "Incoming Wire Transfer - International \| $10" alone is read and kept |
| E. Name held on purpose (v101 vocabulary) | monthly_maintenance $1 | Monthly Account Maintenance FREE FREE FREE $1 FREE | split right, held `unclassified`: v101 leaves "Monthly Account Maintenance" held (an account's here, a gift card's at tid 3141) |
| | document_reproduction $0 | Activity Print Out (per page) FREE (x5) | held `unclassified`: v101 leaves printouts held (keys disagree across banks) |
| | other_lending_fee $20 | Visa Over Limit Fee $20 (x5) | held `unclassified`: v101 leaves over-limit fees held (keys disagree) |
| | loan_origination $35 | Loan Extention Fee (per month) $35 (x5) | held `unclassified` |
| F. Account name is the only category | monthly_maintenance $4.95 | Advantage Checking FREE $4.95 $4.95 $4.95 $4.95 | held `unclassified` |
| | monthly_maintenance $10 | Direct Checking FREE FREE FREE $10 FREE | held `unclassified` |
| | monthly_maintenance $0 | Interest Checking / Teen Checking / College CheckinG FREE (x5) | read $0, refused by Darwin's verify as `category_mismatch` |

- A and B (6 misses) are what #2991 saw as the tier-matrix problem. Knox reads both rows' prices
  right; it leaves out the $0 on purpose. Recovering them means writing a $0 fee for a free tier
  cell and for a free allowance, which reverses v100's stated rule. That is a keying decision.
- C and D (2 misses) are Knox and its shared checks reading tier rows. Neither is a policy-free
  fix: C needs the shared source check (`checkFeeAgainstSource`) to support a cell other than the
  row's first price, and D needs the shared wire-scope review to read five equal cells as one price.
  Both checks also serve Darwin, and the wire-scope review serves Hamilton's international
  publication check too.
- E and F (7 misses) are category holds made on purpose (v101) or rows whose only category word is
  the account's name under "SHARE DRAFT (Checking)". Neither is about the tier matrix. Per the lesson
  from #2872, #2888, #2965 and #2972, no category is inferred from an account's name or a heading.

**#2981's tier rule** (`src/lib/tiered-price.ts`, Knox v183 `tier-names.ts`) covers none of the 15. A
tier group there needs a balance, amount or count condition on each line, and a relationship-tier
column is none of those. The probe shows no `tier_incomplete` hold and no `tier_unscoped` refusal on
this page. It does conflict with fixing C: #2981 says each tier keeps its condition in its name and a
fee is never published with fewer tiers than the page prints. Main publishes "Courtesy Pay" $20,
which is the PLATINUM column's price alone, as the overdraft fee with no condition. Reading the $30
the same way would publish two unscoped tiers. Naming them by column ("Courtesy Pay (PLATINUM)")
is a naming rule nobody has decided. It also depends on question 1: if a free tier cell is a perk and
not the bank's price, a discounted tier may be one too.

**Questions for James** (nothing is built until they are answered):
1. In a relationship-tier table, is each tier's cell a fee of its own? Examples: "Stop Payment FREE
   $25 $25 $25 $25" (keyed $0 and $25; Knox reads $25 only) and "Courtesy Pay $20 $30 $30 $30 $30"
   (keyed $20 and $30; Knox publishes $20 unscoped). If yes, how is each tier named? If no, which
   cell is the bank's price, and should the key drop the others?
2. Is a free allowance a $0 fee? Examples: "Debit/Credit Card Replacement* 1 Free → $5" and
   "Cashier Checks 3 Free " $5", keyed $0 and $5. The same question is the lab's R5 group ("first N
   free" keyed as $0).

**Fix:** none. Per the stop rule (a fix that needs a keying decision stops), no Knox, source-check
or wire-scope change was made, so no switch exists either. Once the questions are answered, C and D are
the build: D is one key, C one key plus the naming of the live $20.

**Also seen:** the $5 reads of B are published named "Debit/Credit Card Replacement 1 Free →" and
"Cashier Checks 3 Free "", with the allowance's count and glyph left in the name.

**Lesson:** before calling a group of misses one reader's problem, trace each miss to the stored
line and the step that dropped it. Here the R3 label put a keying convention ($0 tier cells and
allowances), two shared-check limits and seven category holds under one name.

**Guard:** checklist line on #1092 with the two questions; the probes in
`findings/data/2026-11-04-tier-matrix-7450/` re-trace the page on any later main.
