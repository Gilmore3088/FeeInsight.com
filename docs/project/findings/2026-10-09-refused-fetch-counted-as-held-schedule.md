# A refused fetch counted as a held schedule

Found on 2026-10-09 after PR 850 merged. Run 3319 added 16 of the 20 hand-found links. It skipped four: Morton 273, Leader 286, SC Federal 4493 and Jovia 4700.

- **Cause.** `addOperatorSchedules` treats a link as already held when a document for that URL was stored in the last 30 days. These four banks did have such documents, but none held a usable copy:
  - Three were failed fetches (`status = 'failed'`, HTTP 403, no content).
  - Leader's was a JavaScript shell that Rosetta skipped.
  So none of the four had a link or a live fee.
- **Fix.** A stored copy now counts as held only when Rosetta read it: an `agent_source_texts` row with `status = 'completed'`. The bank's current link and its companion rows still count as before.
- **Lesson.** Before treating a document row as "we have this page", check that it has text. A refused fetch writes a document row too.
