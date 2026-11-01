# 2026-10-25: Hamilton's answer checks had no measured list of the false claims they let through

**Lesson:** before changing a check, record what it does today on cases built to break it, and
mark the ones it gets wrong. Then each later fix flips named cases, and nobody has to judge
expected outcomes by hand.

**How it was found:** step 0 of the claim-contract design (2026-10-25, section 4.2; #1077 T4/T5).
The design lists whole-answer cases for four kinds of false claim: a wrong premise, causal language,
a wrong period or basis, and a swapped bank. The reviewed regression set
(`evidence-regression-set.ts`, version 2026-10-18.1) checks the evidence contract one function at a
time. Nothing ran a whole answer through the gate and the sentence binding to show where it gets
through.

## What was built

`src/lib/hamilton/claim-golden-set.ts` (version 2026-10-25.1) holds 25 synthetic cases: 19 that
should be stopped and 6 controls that must still pass. Bank A (9001), Bank B (9002) and five
synthetic filed peers stand in for the design's 8109 and 9101. A written-answer case runs the
route's own steps for an Analyze answer: `writtenAnswerCheck` and `writtenAnswerBinding`, and the
answer is held when the gate fails or the binding leaves nothing. A bundle case runs
`checkAnswerEvidence` and `bindNarrative`, as the Ask bar and memo do. Each case's `expect` was
recorded by running that code. Its `target` is the design's wanted outcome.

The set is separate from the reviewed regression set, which is unchanged. Its review status is
`unreviewed`, and it says that no person has reviewed it. James asked not to be given cases or fees
to check by hand.

## Today's result: 10 of 25 cases wrong

A case is wrong today when today's status (held or shown) disagrees with the target's. Each one is
tagged with the hole it falls through:

| Hole | Cases | What gets through |
|---|---|---|
| `asked_figure_passes` | wp-fee-restated, wp-nonexistent-fee | A figure from the question counts as traced (`checkNarrativeFigures`, `bindNarrative`'s "asked"), so "Bank A's $35 overdraft fee" is shown as supported against a $10 record |
| `causal_check_needs_ncua` | ca-fee-only, ca-fee-only-pricing | `checkAnswerInterpretations` returns early without NCUA or filed-peer data. The same pricing-cause words are held with NCUA filings (ca-financial-pricing) and shown without them |
| `causal_words_narrow` | ca-fee-only, ca-financial-traced, wp-direction-no-quarter | The causal patterns know only size, pricing and market causes. "Because it competes" and "due to its $35 NSF fee" pass even with NCUA data |
| `premise_not_checked` | wp-direction-no-quarter, wp-metric-absent-traced | Nothing compares "why did fee income fall" with quarters that rose, or notices the data holds no overdraft revenue |
| `filing_figure_unbound` | sb-financial, sb-account-as-research, sb-median-as-subject | A filing figure has no fact record, so Bank B's income stated as Bank A's, or the peer median stated as Bank A's own, is shown with no binding |
| `no_account_identity` | sb-account-as-research | The written-answer gate is told only the research subject, so "your" on the research subject's figure passes |

Some of the design's cases are already held today, for reasons other than the one the design
names. The quarter-question check holds wp-direction, pd-quarter, pd-ytd-as-quarter and
sb-median-as-subject-asked whenever the question names a quarter. The figure check holds "fell 8%"
and "rose 12%" because neither percentage traces. The binding omits pd-fee-year (wrong_period) and
sb-fee (wrong_institution). Variants without the quarter in the question, or with a figure that
traces, show the hole beneath.

## Held out

`claim-golden-set.test.ts` fails if any case's question or answer text appears in a prompt,
knowledge or repair-feedback file (`CLAIM_GOLDEN_PROMPT_FILES`: `research/agents.ts`,
`knowledge.ts`, `voice.ts`, `written-answer-read.ts`, the memo, report and simulate prompt builders,
`answer-gate.ts`, `answer-interpretations.ts` and the binding modules), or in any other non-test
source under `src/lib/hamilton` and `src/lib/research`. Matching ignores case, quote style and
wrapping.

**Guard:** `src/lib/hamilton/claim-golden-set.test.ts`: each case's recorded outcome, the
todayWrong count (10 of 25), and the held-out check over the prompt files.

## Not done here

- `release-acceptance.ts` does not list the new test under H06-AC1 or H06-AC2, which the design
  suggested. Ten of its cases record a known miss, so it is not acceptance evidence until steps 1
  to 3 flip them.
- Steps 1 to 7 of the design (fact IDs for filings, claim binding, premise and causation, one
  gate). Each step changes the `expect` of the cases it fixes, sets `todayWrong` to false, and
  lowers the count in the test.
