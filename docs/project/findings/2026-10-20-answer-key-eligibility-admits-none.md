# 2026-10-20: the answer-key eligibility gate admitted none of the 62 confirmed keys
**What happened:** since #2174 an answer key counts in scoring only with an `answer_key.eligibility`
receipt whose consumer, current and priced facts all pass. The first run (Oct 19, 23:42-23:43 UTC)
wrote receipts for 62 keys and admitted 0 (#2466). Read-only on prod (Oct 20), the newest receipt per
key: 48 had discovery stopped at `page_limit`; 31 of the 36 keys typed `html` failed `current` with
`reference_bytes_changed`; 53 had the consumer fact `consumer_scope_unproven`.
**Cause:** four rules in the gate each failed closed on ordinary evidence.
1. The admin document form pre-fills the stored `content_hash`, so editing a key's URL saved the
   old document's hash against the new URL, which can never match (`saveAnswerKeyDocument`).
2. `consumerFact` returned `consumer_scope_unproven` for any schedule without a narrow consumer
   heading, before its no-heading branch could run, although the contract asks for a consumer
   heading only in a combined consumer/business schedule.
3. Discovery marked the observation incomplete whenever any queued page was left past the 6-page
   cap, including navigation hubs (Disclosures, Forms) that are not themselves schedules.
4. HTML references were byte-bound, and an HTML page's bytes change on every fetch.
**Fix:** this PR (`fix-2466`).
1. A URL edit keeps a hash only when a new one is entered; resubmitting the old hash clears it
   (`documentHashAfterEdit`, `src/lib/data-store/answer-key.ts`).
2. A schedule with no consumer heading passes the consumer fact (`consumer_reference_lines_no_business_evidence`)
   only with no business URL/text/heading, no business section label, and every mapped confirmed
   key line present. The business-document fail and combined-schedule rules are unchanged.
3. Fee-schedule-like links are observed before hubs within the same 6-page cap, and only an
   unvisited fee-schedule-like link makes discovery incomplete (`src/lib/agents/answer-key-eligibility.ts`).
4. An HTML reference is bound to its extracted main text: the key's hash names those bytes or that
   main text, or every mapped confirmed key line is in the observed main text; otherwise
   `reference_main_text_changed`. PDFs and plain text stay byte-bound exactly as before.
The #1862 fixtures (business schedule key 114, legacy page key 6, rates hub key 83) still fail in tests.
**Still open (on #2466):** how many keys the next real run admits is not known until it runs. From the
Oct 19 receipts, at most 10 keys (10, 18, 22, 56, 66, 68, 73, 74, 85, 90) were blocked only by the
rules changed here; each still has to show its key lines in the observed text and no unvisited
fee-schedule link. 39 of the 62 receipts record `linkedFromOfficialSite: false`
(`official_current_link_unproven` once the other checks pass), and a homepage with 160 or more links
still marks discovery incomplete (`link_limit`); neither is changed here. Keys whose stored hash came
from an earlier URL edit keep it until the document is saved again.
**Lesson:** a fail-closed gate needs a count of what it admits on real data before it ships. A gate
that admits nothing reports every pipeline as unmeasured, which hides as much as admitting everything.

**Agent lesson:** deming/issue-2466-reference-binding
