# 2026-10-25: Hamilton repeated the question's premises and checked causes only with NCUA data

**Lesson:** A figure the reader's question asserts as an institution's own fee, or a change it
states, is a claim like any other: it needs a record, and a record that says otherwise must win.
Only an assertion is a premise. A question, a comparison, a threshold or another subject's figure
is not, and when unsure the check keeps today's outcome rather than leave a sentence out. A new
rule that could hold more answers ships in shadow first, recorded but not deciding.

**What happened (#1077, claim contract step 3):** the number check and the sentence binding both
treated any figure the question named as traced (`checkNarrativeFigures`' asked figures,
`bindNarrative`'s "asked" outcome), so "Bank A raised overdraft to $35" let "Bank A's $35 overdraft
fee" show as supported against a $10 record, and a $5 fee with no record show the same way.
Nothing compared "why did fee income fall" with filed quarters that rose, or noticed a question
about overdraft revenue that the filings never separate. The causal checks ran only when the data
held NCUA or filed-peer figures (`checkAnswerInterpretations`' early return) and knew only size and
pricing causes, so "because it competes" or "due to its $35 NSF fee" passed.

**Fix:**
- `narrative-bound.ts`: `questionPremises` reads each question sentence on its own. Supposing words
  ("what if", "should", "plan") count only in the sentence that holds the figure. A figure is a
  premise only when its sentence names the institution and asserts the figure as its fee ("Bank A's
  overdraft fee is $30", "Bank A charges $30", "Bank A raised its fee to $35", "its $5 paper
  statement fee"). A question ending in "?", except in the "its $5 ... fee" form, is not a premise.
  Neither is a sentence with a comparison or threshold ("more than", "above", "compare",
  "threshold", "versus") or another subject ("most banks", "peers", "average", "median"). An answer
  sentence that repeats a premise its record contradicts is omitted as the new
  `premise_contradicted`, with a correction line written from the record. One the institution's
  read records do not hold is omitted as `premise_unsupported`. A "why did fee income fall" premise
  is checked against the filed standalone quarters, which must all agree; a yes-or-no "did it fall?"
  is not a premise. A narrower income line the filings do not separate (overdraft revenue) cannot be
  answered with the broad total. Quoted, negated, withdrawn or supposed answer sentences keep
  today's outcome. Corrections go first in `limitations` (shown today) and in a new optional
  `corrections` field; both reasons and the field read back (`readNarrativeBinding`).
- `memo.ts`: `OMIT_FEEDBACK` has repair lines for both new reasons.
- `answer-interpretations.ts` / `answer-gate.ts`: `causalClaimProblems` (the NCUA size and pricing
  patterns, now shared constants, plus "because", "due to", "driven by", "led to" in a clause with
  a material claim) is **shadow only**. `checkAnswerEvidence` records its lines as `shadowProblems`
  and saves them with the verdict, but they never fail the gate. The gate holds exactly what it held
  before. The shadow rule does not flag method notes ("because Hamilton subtracted"), arithmetic
  ("because $10 is less than $35"), fee schedule terms (waivers, conditions, caps, per-item counts),
  or a clause that negates or supposes.
- From the PR #2571 re-review: a later clause with no basis words that states a running total
  ("bringing its total to", "in all") gets an unknown basis and binds nothing, rather than
  inheriting the quarter basis and being omitted as `wrong_basis`.

**Golden set (`claim-golden-set.ts` 2026-10-25.5, then .6):** wrong today 7 of 28 before step 3, 3 of 28
after. The premise cases are closed. `ca-fee-only`, `ca-fee-only-pricing` and `ca-financial-traced`
are still shown, each with its shadow line recorded (`expect.shadow`). Every control passes. Version 2026-10-25.6 grows the filed peer fixture to ten peers, the median
minimum since #2568, with no peer's own figure equal to the median, so `sb-median-as-subject` and
its asked variant are now held as `median_as_fee`, the reason they target, instead of
`wrong_institution` from a peer whose own quarter equalled the median.

**Where the design differs from the code:**
- The design narrows the asked-figure rule in `figure-check.ts` too. The number check holds no
  facts, so it cannot tell a contradicted figure from a restated one. It is unchanged, and the
  binding decides. The written answer is held when the binding leaves nothing, so the hole is
  closed there. The report path (`generateVerifiedSection`, number check only) is not covered.
- The design puts premises and causal checks in the one gate (step 4). There is no gate yet, so
  premises live in the binding and causes stay a shadow line in the shared gate.
- A filing figure in the question gets no correction line, only `premise_unsupported`.

**Left for step 4:** count the shadow lines from saved verdicts and decide whether to enforce them.
The shadow rule skips any clause with "not", so "lower because it does not compete" is not
flagged.

**Guard:** `src/lib/hamilton/claim-premise-causation.test.ts` and `src/lib/hamilton/claim-golden-set.test.ts`.
