# 2026-10-25: Hamilton's streamed Analyze answer sent the text of the sentences its binding left out

**Lesson:** A screen that hides text by matching it has still been sent that text. When the server
knows the verdict before the reader sees anything, the server writes the text the reader is shown,
and sends a binding that matches that text, never the draft and a list of what to hide.

**Guard:** `src/app/api/research/hamilton/route.streamed-omitted.test.ts` (the whole SSE body, read
through the real UI message stream helpers: a held answer with a left-out sentence never carries
its text in the start binding, the text, the reasoning or the final metadata, keeps its tool parts
and finish, saves the full binding, and reads back on the screen with the supported sentence in the
view and the reading sentence under its label; a view that cannot be built shows the held line and
saves nothing; a held answer with nothing left out replays the provider's stream chunk for chunk
with its binding byte for byte; no held line and no mode stream the draft whole, as before),
`src/app/api/research/hamilton/route.omitted-payload.test.ts` (the held stream's start and final
binding carry the reason, not the text, switch on and off) and
`src/lib/hamilton/written-answer-binding.test.ts` (`readSentNarrativeBinding`).

**What happened (#1077 follow-up to PR #2604):** PR #2604 kept left-out sentences' text out of the
buffered `gate_citations` reply, and left the streamed Analyze answer alone on purpose. That stream
sent the full `narrativeBinding`, `omitted[].text` included, on the start chunk and in the final
metadata, and replayed the first draft whole (`writer.merge(result.toUIMessageStream())`). The
Analyze screen hid the left-out sentences by matching that text (`applyNarrativeBinding`). Every
Analyze answer with a left-out sentence (wrong institution, contradicted premise, wrong period or
basis, a median stated as a fee, and the rest) sent that sentence to the browser twice.

**Fix (`src/app/api/research/hamilton/route.ts`):** an Analyze answer is already held until the
verdict (`HELD_ANSWER_MESSAGE` is set), so the whole draft and its binding are known before the
reader sees anything.
- In `onFinish`, before the save, a held answer whose binding left sentences out gets its shown
  text from `bindingAnswerView` (`output-gate-repair.ts`): `gatedAnswerView` over a `ready_partial`
  verdict whose only cuts are the binding's own left-out sentences. No second cutter. The view
  fails closed as the repair path does (`cut_not_found`, `cut_still_shown`, `nothing_left`); then
  the answer is held, so the reader gets the held line and the answer is not saved as shown. A
  shown answer saves its full text and full binding, as before (reports read it server side).
- In `execute`, that answer still merges the provider's replayed stream, through
  `requireCompletedProviderUIStream`, but with its text and reasoning chunks taken out and the shown
  text written as one text block just before the finish chunk (`withShownText`). Tool parts, steps
  and the finish are unchanged, so the screen's figure check and the paused line for a provider
  limit read the same stream.
- The start chunk and the final metadata of a held answer send `readerNarrativeBinding(binding)`:
  each left-out sentence by its reason only. With nothing left out it serialises byte for byte as
  the full binding did, and the stream replays exactly as before.
- The screen (`AnalyzeWorkspace.tsx`) reads a sent binding with `readSentNarrativeBinding`, which
  reads a reason-only entry as empty text. `trimmedSet` now skips an empty text, so it drops
  nothing (it would otherwise drop blank lines). A reopened saved answer still reads with
  `readNarrativeBinding`.

**What the reader sees change:** an Analyze answer with a left-out sentence arrives as one block
when the verdict is in, not token by token (it was already held until then, so no later). It is
rebuilt from its parsed sections, so a backtick or a bold lead may render plainer, and it drops
Evidence and Explore Further, the repair path's rule, because the binding never reads them and a
left-out claim could be repeated there. The reading-only sentences still show under
`INTERPRETATION_LABEL`, matched by text as before. An answer whose left-out sentence the view cannot
find (a `- > ...` line splits differently, see `2026-10-25-omitted-text-payload.md`) now shows the
held line, where it used to show with the sentence hidden on screen.

**Provider calls:** none added. **Golden set:** unchanged. **Migration:** none.

**Left open:** a stream that is not held (`HELD_ANSWER_MESSAGE` null, or an admin chat with no
mode) still streams the draft whole and sends the full binding at the end, since the text has gone
before the binding is known. If the screen's own save runs (an older route, or the server save
failed), it saves the reader binding, whose left-out entries have empty text.
