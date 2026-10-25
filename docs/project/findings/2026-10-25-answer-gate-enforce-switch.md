# 2026-10-25: the one output gate only watched; one switch now lets it decide on every surface

**Lesson:** A gate that only runs in shadow cannot be turned on until every path has a place to
act on its verdict. Wire the held reply on each path first, behind one switch that is off by
default and never calls the gate on the request path while off, so turning it on is a single
setting and turning it off is proven to change nothing.

**What happened (#1077, V5 plan T4):** `gateAnswer` (`src/lib/hamilton/output-gate.ts`) ran in
shadow on every surface: the written answer (buffered and streamed), the Ask memo, the Simulate
read and stream, and each report section. Each surface still decided with its own older check,
and none could act on the unified verdict. Turning the gate on would have needed a code change on
every surface.

**Cause:** the shadow was built to measure disagreement, so it was a thunk run after the response
(`scheduleGateShadow`), and nothing on the request path had the verdict in hand.

**Fix:** `src/lib/hamilton/output-gate-enforce.ts` holds the switch `HAMILTON_ANSWER_GATE_ENFORCE`
(`isAnswerGateEnforced`, off unless exactly "true", "1" or "on", the `HAMILTON_GATE_REPAIR`
pattern) and one outcome rule (`enforcedOutcome`): `held`, or a gate that throws, holds; a
`ready_partial` verdict is shown in part only where the path already shows partial answers, else it
holds; `validated` keeps today's behaviour, today's checks included. Enforcement only adds holds:
it never shows what today's checks hold, and an untraced figure is critical in the gate (James,
2026-10-15), so an answer with one is never shown. With the switch on:
- Written answer, buffered (`gate_citations`, `route.ts`): an answer today's checks would show is
  refused (`status: "refused"`, `evidence_check_failed`, problems named by reason, no answer text)
  unless the gate validates it. No partial here (a left-out sentence already refuses it). With
  `HAMILTON_GATE_REPAIR` on, that path's unified gate already decides; nothing else changes there.
- Written answer, streamed: every mode is held until the gate has read the answer, admin chats
  included (they streamed ungated before). Held: the held line (`HELD_ANSWER_MESSAGE`, or the same
  source-check line if it is ever null), nothing saved. Partial (Analyze only, which already shows
  partial answers): shown as today only when every failure is a sentence the binding left out,
  since today's view, the reader binding on the start chunk and in the final metadata, and the
  saved row already mark exactly those. A partial verdict that cuts any other sentence (a cause,
  advice, an internal name, house wording) is held: the stream's binding and the save would still
  carry that sentence as supported (review of the first commit). An answer the provider never finished gets the stream's error with every text and
  reasoning chunk taken out (`withoutText`), so ungated text is never sent.
- Ask memo (`writeStorylineMemo`): a draft today's checks pass is withheld (`status: "withheld"`,
  `MEMO_GATE_HELD_REASON`) unless the gate validates it; no retry, so no provider call is added.
- Simulate read (`writeSimulateRead`, the paid eval): a new `status: "held"` with
  `SIMULATE_HELD_MESSAGE`, no text. Simulate stream (`/api/hamilton/simulate`): buffered until the
  provider has finished cleanly, then the read or `SIMULATE_HELD_MESSAGE` (`enforcedSimulateBody`).
- Report section (`generateVerifiedSection`): a section the figure check passes comes back
  `needs_review` with `SECTION_GATE_HELD` unless the gate validates it, which refuses the report as
  an untraced figure does; the report's error names no figure for it, and the ledger records it as
  `held_by: "one_output_gate"` with a section count, never under `unverified_figures`. The paid
  eval scores a held Simulate read as withheld, not unavailable.
- Every shadow record written with the switch on carries `gateMode: "enforced"`; a shadow record
  has no such field, so its bytes are as before (`gateModeOf` reads it as "shadow"). The ledger
  summary starts "Enforced gate" instead of "Shadow gate". `today` stays what today's checks decided.

**Off (the default):** byte-identical. No surface calls the gate on the request path, the shadow
record has no new field, and the route's held line and hold rule are the same values as before.

**Known limits:**
- With the switch on, admin chats and Analyze answers arrive in one block once the gate has read
  them, not token by token, and so does the Simulate read.
- A streamed Analyze answer the gate would cut for a cause, advice or wording sentence is held
  whole, not shown in part. Showing it in part needs the cut applied to the start binding, the
  final metadata and the save; that is later work.
- The Simulate stream's enforced body is covered by unit tests on `enforcedSimulateBody`; there
  is no route test for `/api/hamilton/simulate`.
- New reader-facing lines (`MEMO_GATE_HELD_REASON`, `SIMULATE_HELD_MESSAGE`, the report's "could
  not verify a statement" error) show only with the switch on and need a copy review before it is.
- Turning the switch on is James's call; this change does not set it anywhere.

**Provider calls:** none added, on or off. **Migration:** none. **Golden set:** unchanged.

**Guard:** `src/lib/hamilton/output-gate-enforce.test.ts` (switch values; the outcome rule; the
streamed decision, partial only for the binding's own cuts; `gateMode` absent in shadow and kept on read-back and on a
thrown gate; memo, Simulate read, Simulate stream body and report section each with the switch off
(unchanged, gate never called) and on (held withheld, validated shown)),
`src/app/api/research/hamilton/route.answer-gate-enforce.test.ts` (streamed, Analyze and no mode:
off byte-identical with a gate that would hold; on, held, partial and a thrown gate send only the
held line and never the draft or its reasoning; a partial verdict cutting a sentence the real
binding keeps sends that sentence nowhere and saves nothing; validated shown and saved; an unfinished answer
sends no text; buffered off unchanged, on refused with no answer text) and
`src/app/api/research/hamilton/route.streamed-omitted.test.ts` (on, with the real gate, a
left-out answer still shows in part without the left-out sentence, and an admin chat's draft is
held rather than streamed with it).
