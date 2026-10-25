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
`figureClauses` split), or, when the clause names none, the fees the sentence names. When a fee is
named, a fee record binds only if its category is one of them, or its fee name or product is
written out in that text. If the only records at that value are other fees, the sentence is left
out with a new omit reason, `wrong_category`, under the existing "did not match its fee record"
limitation. A sentence that names no fee binds as before (value, unit and institution), so
sentences that already bound correctly keep their outcome; a later sentence's "it" carries the
institution, not the fee. Filing figures and derivations are unchanged (they have their own metric
checks). The new reason is added to every reader of omit reasons: `OMIT_REASONS` in
`written-answer-binding.ts` (or a saved binding with it would read as no binding), the memo's
repair feedback (`memo.ts`), and the golden set's reason type. The output gate and its shadow
tally take any omit reason as a failure code, so they need no change; `wrong_category` is not
critical, like `wrong_institution`.

**Known limits:** a fee name the Ask bar's names do not know binds as before; a clause naming two
fees accepts a record of either; phrase matches can name a broader fee too ("overdraft" inside
"overdraft protection transfer"), which only ever lets a record bind, never leaves one out.

**Measured:** no existing test or golden case changed outcome (Hamilton suites: 3050 passed before
the change, the same after, plus the new cases). The five new golden cases (group
`wrong_fee_category`, set 2026-10-25.7) and the new unit tests fail with the check turned off: the
three wrong-category cases were shown with the figure supported by the stop-payment record.

**Guard:** `src/lib/hamilton/narrative-bound.test.ts` ("a fee figure binds only to a record of the
fee its clause names") and the `wrong_fee_category` cases in `src/lib/hamilton/claim-golden-set.ts`
(run by `claim-golden-set.test.ts` and replayed through the unified gate in `output-gate.test.ts`).
