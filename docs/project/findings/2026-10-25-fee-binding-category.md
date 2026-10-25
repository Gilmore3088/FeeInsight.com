# 2026-10-25: a fee figure was supported by any record of the same price, whatever the fee

**Lesson:** A figure is supported only by a record of the thing the sentence says it is. For a fee,
that means its category: when a figure's own clause names a fee, a record of another fee at the
same price (not a sub-type of the fee named) no longer supports it. A clause that names no fee, a
fee name Hamilton does not know, and a record with no category still bind on value and institution
alone, so those can still pass a wrong fee.

**What happened (Cycle A trace, #1077, high severity):** `bindNarrative` in
`src/lib/hamilton/narrative-bound.ts` bound a sentence's dollar figure to a fee record on value,
unit and institution only (`claimBindingMatches(fact, { unit, value })`, no `feeCategory`). So
"Our overdraft fee is $30." was marked supported against the bank's $30 stop-payment record. It
was saved as a supported claim, carried into reports and printed as fact.

**Cause:** the sentence binding never read which fee a sentence names. The premise check in the
same file did (it matches `proseFeeName` against the question), but the figure loop did not.

**Fix:** for each figure, the binder reads the fees its own clause names (the existing
`figureClauses` split), with the fee names Hamilton already uses for questions
(`feeCategoriesIn`). It takes the fees the whole sentence names only when the clause leaves its fee
out ("and Bank B's is $30", "its is"). A record fits when its category is a named fee, a sub-type
of one in the explicit map `FEE_SUB_TYPES` (`src/lib/fee-taxonomy.ts`: overdraft covers an extended
overdraft charge, an overdraft transfer and the daily cap; NSF covers the daily cap; the
non-network ATM fee covers an ATM fee abroad and a foreign transaction fee), or, for a wire, the
direction its words give ("incoming", "outgoing", "international", "domestic" each narrow it;
"wire" alone is any wire). Its own fee name or product written out also fits. Otherwise it is the
wrong fee; if the only records at that value are wrong fees, the sentence is left out with a new
omit reason, `wrong_category`, under the existing "did not match its fee record" limitation. So
overdraft and NSF, monthly maintenance and paper statement, cashier's check and stop payment, and
two wire directions are told apart.

A clause that names no fee, and a record with no category (the catalog row's `fee_category` is
null) or one outside the taxonomy, bind as before (value, unit and institution), so sentences that
already bound correctly keep their outcome; a later sentence's "it" carries the institution, not
the fee. Filing figures and derivations are unchanged (they have their own metric checks).

The new reason is added to every reader of omit reasons: `OMIT_REASONS` in
`written-answer-binding.ts` (or a saved binding with it would read as no binding), the memo's
repair feedback (`memo.ts`), and the golden set's reason type. The output gate and its shadow
tally take any omit reason as a failure code, so they need no change; `wrong_category` is not
critical, like `wrong_institution`.

**Reviews:** the first version fell back to the sentence's fees for any clause that named none,
allowed no sub-types, and treated a record with no category as the wrong fee. That cut correct
sentences ("Bank A's overdraft fee is $35, and it charges $30 to stop a check.", "plus $7 a day
after five days", "$15 for incoming wires", a $175 daily overdraft and NSF cap, a $10 overdraft
transfer from savings, an ATM fee abroad, and any fee whose record has no category). The second
version allowed any fee of the same family, which let overdraft pass at the NSF price, monthly
maintenance at the paper-statement price, a cashier's check at the stop-payment price and one wire
direction at another's. Each of these is now a golden case and a unit test.

**Known limits:** the rule errs toward binding.
- Only the figure's own clause decides. A clause that names no fee binds as before, except a
  clause that leaves its fee out ("Bank B's is $30"), which takes the sentence's fees. So "Bank A's
  overdraft fee is $35, and it charges $30 for that" still binds $30 to any $30 fee of Bank A.
- A record with no category, or a category outside the taxonomy, binds as before to any sentence,
  whatever fee it names.
- A fee name the Ask bar's fee names do not know (including some plurals, such as "incoming
  wires") counts as no fee named.
- A clause naming two fees accepts a record of either; a broader phrase inside a longer one
  ("overdraft" inside "overdraft protection transfer") only adds fees, never removes one.
- The sub-type map is hand-kept: a new category that should sit under a broader fee is the wrong
  fee until it is added to `FEE_SUB_TYPES`.

**Measured:** no existing test or golden case changed outcome (Hamilton suites: 3050 passed before
the change, the same after, plus the new cases). The golden set (version 2026-10-25.9) has a
`wrong_fee_category` group: eight must-hold cases and nine controls. With the check turned off the
first three must-hold cases are shown, the figure supported by the stop-payment record. With the
first version of the rule all seven review controls were held; with the family rule the five
sibling swaps were shown.

**Guard:** `src/lib/hamilton/narrative-bound.test.ts` ("a fee figure binds only to a record of the
fee its clause names") and the `wrong_fee_category` cases in `src/lib/hamilton/claim-golden-set.ts`
(run by `claim-golden-set.test.ts` and replayed through the unified gate in `output-gate.test.ts`).
