# 2026-10-25: Hamilton had five answer gates that decided alone and one that never ran

**Lesson:** Before one check replaces several, run it beside them on every path and record both
decisions in the run ledger. Then switching it on is a decision about counted disagreements, not
a guess about how many answers it will hold.

**What happened (#1077, claim contract step 4):** each surface decided with its own mix of checks.
The written-answer route ran `writtenAnswerCheck` plus `writtenAnswerBinding`, and only when the
request said `mode: "analyze"`, so the two admin chats (no mode) were never checked. The buffered
`gate_citations` path ran the same pair but refused on any left-out sentence. The Ask memo ran the
shared gate, its own binding and its own rules. The Simulate stream had no gate; its eval ran the
shared gate only. No verdict said which rule held an answer, and nothing could say what one gate
would change.

**Fix (shadow only; no reader sees a change):**
- `src/lib/hamilton/output-gate.ts`: `gateAnswer` reads the same evidence as today's checks (the
  test proves the check and binding are equal on every golden written case) and returns one
  verdict: `validated`, `ready_partial` or `held`, with each failure's code, whether it is critical
  and which check found it. Critical: untraced figures (James's line of 2026-10-15), conflicting
  filed peer reads, `account_as_subject`, `instruction_text`, `premise_contradicted` with no
  correction line, the account institution named with no fact about it, a surface's own rule, and
  any text-level problem that cannot be pinned to a sentence. Advice, internal names, house wording
  and stated causes that can be pinned are cut sentence by sentence; nothing left is held.
- `output-gate-signals.ts` holds the step 3 interface: the broad cause rule is a shadow input,
  read from `checkAnswerEvidence`'s `shadowProblems` (PR #2572), and premises are the binding's
  omit reasons. A change to step 3 edits that file only.
- `output-gate-shadow.ts`: `shadowGate` never throws; the record keeps codes and counts, never
  the answer's text. `tallyGateShadow` counts agreements and each disagreement (`unified_holds`,
  `unified_shows`, `partial_differs`) per surface and path.
- Recorded in the run ledger, no migration: a written answer (streaming, every mode, and buffered)
  gets a `pro.answer_gate_shadow` run; the Ask memo and the Simulate stream add `gate_shadow` to
  the `pro_request` run they already write. `countGateShadowDisagreements(days)`
  (`output-gate-shadow-store.ts`) reads them back.
- `memo.ts`: `memoOwnProblems` splits out the memo-only checks, with `memoProblems` unchanged in
  output and order.

**Golden set replay (`claim-gate-replay.ts`, set 2026-10-25.6):** the unified gate meets the
target on 28 of 28 and validates all 9 controls. It agrees with today on 25. It holds 3 answers
that today shows: `ca-fee-only`, `ca-fee-only-pricing` and `ca-financial-traced`, the cases the set
marks wrong today, each a stated cause. The cause rule flags 7 cases and alone holds 4 of them
(those three plus `ca-financial-pricing`, which today's NCUA rule already holds). It cuts sentences
from none, because every golden answer is one sentence.

**Left open:** the report path (`generateVerifiedSection`) is design step 6, so it is not shadowed
here. The Ask bar's deterministic answers are not shadowed either: no model writes them. Admin chats
will be held once the gate is switched on, so check with the admin screens' owners first. Whether
a cut sentence should become `ready_partial` rather than a hold is James's decision before step 5.

**Guard:** `src/lib/hamilton/output-gate.test.ts` (same evidence as today's checks; partial and
cut; untraced figures critical; account identity; shadow records, tally and read-back; memo and
Simulate shadows; golden replay counts) and `src/app/api/research/hamilton/route.answer-gate.test.ts`
(an admin chat with no mode is gated in shadow only; streaming and buffered give the same verdict;
a shadow that fails changes nothing).
