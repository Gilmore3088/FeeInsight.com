# 2026-10-25: a fee figure was supported by any record of the same price, whatever the fee

**Lesson:** A figure is supported only by a record of the thing the sentence says it is. For a fee,
that means the fee category: the binder reads which fee a clause names with the fee names Hamilton
already uses for questions (`feeCategoriesIn`), and a record of a different fee at the same price
never supports it.

**What happened (Cycle A trace, #1077, high severity):** `bindNarrative` in
`src/lib/hamilton/narrative-bound.ts` bound a sentence's dollar figure to a fee record on value,
unit and institution only (`claimBindingMatches(fact, { unit, value })`, no `feeCategory`). So
"Our overdraft fee is $30." was marked supported against the bank's $30 stop-payment record. It
was saved as a supported claim, carried into reports and printed as fact.

**Cause:** the sentence binding never read which fee a sentence names. The premise check in the
same file did (it matches `proseFeeName` against the question), but the figure loop did not.

**Fix:** for each figure, the binder reads the fees its own clause names (the existing
`figureClauses` split). It takes the fees the whole sentence names only when the clause leaves
its fee out ("and Bank B's is $30", "its is"). When a fee is named, a fee record is the wrong fee
only when its category is clearly a different fee: not one of the named fees, its fee name and
product not written out, and not in the same fee family (`getFeeFamily`, `FEE_FAMILIES` in
`src/lib/fee-taxonomy.ts`), so a daily overdraft cap, an overdraft transfer or an extended
overdraft still fits "overdraft", an international ATM fee fits "ATM", and a wire sub-type fits
"wire". If the only records at that value are such other fees, the sentence is left out with a new
omit reason, `wrong_category`, under the existing "did not match its fee record" limitation. A
clause that names no fee, and a record with no category (the catalog row's `fee_category` is
null), bind as before (value, unit and institution), so sentences that already bound correctly
keep their outcome; a later sentence's "it" carries the institution, not the fee.

**Review of the first version:** it fell back to the sentence's fees for any clause that named
none, did not allow sub-types, and treated a record with no category as the wrong fee. That cut
correct sentences ("Bank A's overdraft fee is $35, and it charges $30 to stop a check.", "plus $7
a day after five days", "$15 for incoming wires", a $175 daily overdraft and NSF cap, a $10
overdraft transfer from savings, an ATM fee abroad, and any fee whose record has no category).
Each is now a golden control and a unit test. Filing figures and derivations are unchanged (they have their own metric
checks). The new reason is added to every reader of omit reasons: `OMIT_REASONS` in
`written-answer-binding.ts` (or a saved binding with it would read as no binding), the memo's
repair feedback (`memo.ts`), and the golden set's reason type. The output gate and its shadow
tally take any omit reason as a failure code, so they need no change; `wrong_category` is not
critical, like `wrong_institution`.

**Known limits:** the rule errs toward binding, so it catches a clearly different fee and nothing
finer.
- Only the figure's own clause decides. A clause that names no fee binds as before, except a
  clause that leaves its fee out ("Bank B's is $30"), which takes the sentence's fees. So "Bank A's
  overdraft fee is $35, and it charges $30 for that" still binds $30 to any $30 fee of Bank A.
- A record with no category binds as before to any sentence, whatever fee it names.
- Within one fee family the swap is not caught: an overdraft figure at the NSF price, or an ATM
  figure at the card-replacement price, still binds, because the taxonomy has families, not a
  parent for each sub-type.
- A fee name the Ask bar's fee names do not know (including some plurals, such as "incoming
  wires") counts as no fee named.
- A clause naming two fees accepts a record of either.

**Measured:** no existing test or golden case changed outcome (Hamilton suites: 3050 passed before
the change, the same after, plus the new cases). The golden set (version 2026-10-25.8) has a
`wrong_fee_category` group: three must-hold cases (the trace sentence in a written answer and in a
bundle answer, and the swapped two-fee sentence) and nine controls. With the check turned off the
three must-hold cases are shown, the figure supported by the stop-payment record. With the first
version of the rule, all seven review controls were held as `wrong_category`.

**Guard:** `src/lib/hamilton/narrative-bound.test.ts` ("a fee figure binds only to a record of the
fee its clause names") and the `wrong_fee_category` cases in `src/lib/hamilton/claim-golden-set.ts`
(run by `claim-golden-set.test.ts` and replayed through the unified gate in `output-gate.test.ts`).
