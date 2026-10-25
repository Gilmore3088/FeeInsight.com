# 2026-10-25: Hamilton repeated the question's premises and checked causes only with NCUA data

**Lesson:** A figure or change the reader's question states as fact is a claim like any other: it
needs a record, and a record that says otherwise must win. A cause stated next to a figure or a
named measure with a direction is unsupported whatever data the answer holds, because nothing
Hamilton reads carries a cause.

**What happened (#1077, claim contract step 3):** the number check and the sentence binding both
treated any figure the question named as traced (`checkNarrativeFigures`' asked figures,
`bindNarrative`'s "asked" outcome), so "Bank A raised overdraft to $35" let "Bank A's $35 overdraft
fee" show as supported against a $10 record, and a $5 fee with no record show the same way.
Nothing compared "why did fee income fall" with filed quarters that rose, or noticed a question
about overdraft revenue that the filings never separate. The causal checks ran only when the data
held NCUA or filed-peer figures (`checkAnswerInterpretations`' early return) and knew only size and
pricing causes, so "because it competes" or "due to its $35 NSF fee" passed.

**Fix:**
- `narrative-bound.ts`: `questionPremises` reads the question unless it only supposes ("what if",
  "would", "plan"). A fee figure it gives for an institution whose record of that fee says
  otherwise is contradicted, with a correction line written from the record; a fee-income change
  is checked against the filed standalone quarters (every filed measure must agree); a narrower
  income line (overdraft revenue) with only broader filings read cannot be answered. An answer
  sentence that repeats a contradicted figure or change is omitted as the new `premise_contradicted`;
  a question figure the institution's read records do not hold, or a figure or change in the
  unseparated income line, as the new `premise_unsupported`. A sentence that quotes the question,
  negates, withdraws or supposes keeps today's outcome; with nothing read for that institution the
  figure is Hamilton's reading. Corrections go first in `limitations` (shown today) and in a new
  optional `corrections` field; both reasons and the field read back (`readNarrativeBinding`).
- `answer-interpretations.ts`: `causalClaimProblems` runs on every answer: the NCUA check's size
  and pricing patterns (same wording, now shared constants) plus general connectives, only in a
  clause with a material claim, with the existing withdrawal helpers. A connective whose cause is
  the data or method ("because the filing reports year-to-date totals") is not a claim.
- From the PR #2571 re-review: a later clause with no basis words that states a running total
  ("bringing its total to", "in all") gets an unknown basis and binds nothing, rather than
  inheriting the quarter basis and being omitted as `wrong_basis`.

**Golden set (`claim-golden-set.ts` 2026-10-25.4):** wrong today 7 of 28 before, 0 of 28 after.
Every control still passes.

**Where the design differs from the code:**
- The design narrows the asked-figure rule in `figure-check.ts` too. The number check holds no
  facts, so it cannot tell a contradicted figure from a restated one; it is unchanged, and the
  binding decides. The written answer is held when the binding leaves nothing, so the hole is
  closed there; the report path (`generateVerifiedSection`, number check only) is not.
- The design puts premises and causal checks in the one gate (step 4). There is no gate yet, so
  premises live in the binding and causes in the shared interpretation check.
- Filing figures in the question get no correction line, only `premise_unsupported`.

**Risk:** "because" with a figure now fails the gate for every written answer, memo and Ask bar
answer, which holds it today. Step 4's shadow run should count how often.

**Guard:** `src/lib/hamilton/claim-premise-causation.test.ts` and `src/lib/hamilton/claim-golden-set.test.ts`.
