# 2026-10-25: Hamilton's buffered reply sent the text of the sentences its view left out

**Lesson:** When a view leaves a sentence out, the reply must leave out its text too, not only hide
it on screen: send the reason and the count, and keep the text only where it is saved and read
server side. A payload nobody renders today is still a payload the next caller renders.

**Guard:** `src/app/api/research/hamilton/route.omitted-payload.test.ts` (switch on: an ok
`ready_partial` reply whose binding keeps `omitted[].reason` but no text, and a refused reply that
names a left-out sentence by its reason; switch off: the refused reply the same way, an ok reply
unchanged; the streamed answer unchanged, switch on and off) and
`src/lib/hamilton/written-answer-binding.test.ts` (`readerNarrativeBinding`).

**What happened (#1077, claim contract step 5 review):** with `HAMILTON_GATE_REPAIR` on, the
buffered `gate_citations` path in `src/app/api/research/hamilton/route.ts` can answer
`status: "ok"` with a `ready_partial` view. Its JSON carried the gate's full `narrativeBinding`,
whose `omitted[].text` holds the very sentences the view left out; a sentence the gate cut (advice,
house wording, an unsupported cause) could also still sit in the binding's `supported`,
`interpretation` or `readingBasis` lists. Both refused replies quoted left-out sentences in
`problems` too: switch off as `Left out (reason): "<sentence>"`, switch on as the binding failure's
`message`, which is the sentence itself. No screen sends `gate_citations: true` today, so no reader
saw any of it.

**Fix:** `readerNarrativeBinding` (`src/lib/hamilton/written-answer-binding.ts`) is the binding a
buffered reply sends: each omitted sentence becomes `{ reason }` (so reasons and the count stay),
and any sentence the gate cut is dropped from the supported, reading and basis lists. Both buffered
`ok` replies send it; both refused replies name a binding sentence as `Left out (<reason>).`. The
saved row and the run ledger are unchanged: saved answers keep the full binding, since reports read
it server side. Switch off, an `ok` reply only ever carried a binding with nothing omitted, so its
JSON is unchanged; the refused reply's `problems` line loses its quote, which no screen shows.

**The streamed answer is not changed, on purpose.** Its start chunk and final metadata already send
the full binding, `omitted[].text` included, to the browser today. Stripping that text alone would
put the sentences on screen: the stream replays the first draft's text whole
(`writer.merge(result.toUIMessageStream())`), left-out sentences included, and the Analyze screen
hides them by matching the binding's `omitted[].text` (`applyNarrativeBinding` in
`AnalyzeWorkspace.tsx`). So readers see no change from this PR. Keeping the text out of the stream
needs the server to write the shown text in place of the replay, which is the streaming spike in
`2026-10-25-claim-repair-partial.md`; until then the browser gets the left-out sentences in both the
text and the binding, and a non-held stream (no mode) streams them before any verdict.

**Provider calls:** none added. **Golden set:** unchanged.

**Left open:** the streamed payload (above). A density refusal still returns
`claims_without_citations`, the density gate's own sentence list, on both paths; it is not a
binding's left-out list and is unchanged here.
