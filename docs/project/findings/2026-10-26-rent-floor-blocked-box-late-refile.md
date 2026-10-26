# 2026-10-26: a category's price floor blocked a re-file into it

**Lesson:** A category's amount range is set for its main fee. Before a re-file rule moves another kind
of fee into that category, check the range against that kind of fee too, or the re-file fails the range
and the fee comes down instead of moving. And match a name's words however they are spaced or joined.

**What happened:** The review of #2639 (guard v90, #1912) traced 36020, "Safety Deposit Box-Late Fee"
$1.00 at institution 494, live as `late_payment`. v90 refuses it there and re-files it to
`safe_deposit_box`, but Hamilton's live guard moves a fee in place only when `restoreTarget` finds a
home it can publish: `passesDarwinChecks` -> `withinAmountEnvelope("safe_deposit_box", 1, ...)`, and
Darwin's box range starts at $5 (`CATEGORY_AMOUNT_ENVELOPES.safe_deposit_box`). That $5 is a rent
floor; a box late fee is a late charge. So 36020 had no home and went to the second look, pending a
takedown. Nothing else blocked it: the fold split, the re-file rule and the box guard all placed it.

The same review found that v90's night-deposit lookbehind (`(?<!night[\s-])` in
`SAFE_DEPOSIT_BOX_NAME`) allowed only one space or hyphen, so "Night Drop Deposit Box Late Fee" and the
double-spaced "Night  Deposit Box" counted as safe deposit box names, and the box rule's own
"night deposit" exclusion missed them too.

**Fix (guard v96):** a box fee whose own name says late has its own Darwin range
(`BOX_LATE_FEE_ENVELOPE` in `src/lib/agents/darwin/envelopes.ts`: $1 floor, the box's ceiling), read
wherever the hand range is read by name (Darwin verify, Hamilton publish, the guard's restore).
Hamilton's outlier sweep leaves such fees live, and Darwin's verify re-reads box late holds the new
floor takes. `NIGHT_DEPOSIT_NAME` (`night[\s/-]+(deposit|drop)`) keeps night depository names out of
`SAFE_DEPOSIT_BOX_NAME`, fails them as a safe deposit box fee and re-files them to `night_deposit`.
Dry-run counts are in the PR.

**Guard:** `src/lib/agents/darwin/box-late-envelope.test.ts`, the v96 cases in
`src/lib/fee-category-guard.test.ts` and `src/lib/agents/hamilton/category-guard.test.ts`, and the box
late cases in `outlier-rollback.test.ts` and `verify.test.ts`.
**Agent lesson:** `darwin/issue-1912-box-late-floor-and-night-drop`
