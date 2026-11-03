# 2026-11-03: Live fees published from documents whose own address calls them old

**Lesson:** A document whose path or link label calls it old or archived is never a bank's fee
link, and a fee already live from one comes down only when the bank's current schedule proves it
stale.

**What happened:** Read-only prod queries on Nov 3 found live fees (published_fee_records with
`rolled_back_at` and `quarantined_at` both NULL, traced through `lineage_ref` ->
`verified_fee_observations` -> `raw_fee_observations.source_document_id` -> `source_documents`) on 5
documents that label themselves old or archived. Together they hold 86 live fees at 5 banks:

| Bank | Document | Live fees | Bank's fee link |
|---|---|---|---|
| Westreet FCU (6933) | `westreet.org/wp-content/uploads/2021/06/Fee-Schedule-Old.pdf` (doc 2229) | 32, fee 43316 among them | `http://www.westreet.org/documents/fee-schedule`, never captured |
| WinSouth FCU (8661) | `winsouthcu.com/_/kcms-doc/1526/59288/PDF.FEE.SCHED.716.OLD.pdf` (doc 14834) | 24 | the old document itself |
| Central Jersey Police & Fire FCU (4740) | `cjpolicefirefcu.org/old-web-site/` (docs 18186, 30666) | 16 | the old document itself |
| Citizens Bank & Trust Co. (3767) | `cbt-co.com/deposit-accounts/schedule-of-fees-old` (doc 38970) | 12 | the old document itself |
| Clackamas County Bank (2619) | `clackamascountybank.com/archive-2021/personal-checking.php` (doc 20233) | 2 | `/personal-checking.php` (doc 16917, captured) |

Two more stored fee links match the same rule but carry no live fee from an old document: Cleo
State Bank (3642, `/old-home.html`) and Access FCU (7235, `/pdf/truthnsavings_old.pdf`).

**Cause:** Magellan never read a candidate's address or link label for its age. Its address checks
refuse business-only, error, article, legacy and non-fee documents (`find-validate.ts`), but a file
named "Fee-Schedule-Old.pdf" passed as a fee schedule, and once it was the stored link the weekly
fetch kept re-reading it. Nothing downstream could see it: the live-site audit checks the page a fee
cites, and an old page still prints its old prices.

**Fix (process first):**

- Magellan (`src/lib/agents/magellan/old-labelled-link.ts`, one rule): a path is old when a segment
  carries "archive", "archived", "archives", "superseded", "expired", "obsolete" or "outdated"
  anywhere, or "old", "previous" or "prior" as the segment's last word (before the extension) or
  right before a document or site word ("old-fee-schedule", "old-web-site", "old-home"). A label is
  old when one of those words stands beside a document word ("Old Fee Schedule", "Fee Schedule
  (Archived)"). The host is never read. Such a candidate scores 0 (`scoreLink`), is refused before it
  is opened (`old_labelled`, also where a candidate redirects to), is never a companion, and a stored
  link like that goes back to discovery on its next fetch (`failure_reason =
  'magellan_old_labelled_link'`, the URL kept in `rejected_source_urls` so it is never taken again).
- Exclusions, tested: "/older-adults-checking", "/prior-notice", "oldnational.com/fees.pdf" (host),
  "/old-national-fee-schedule.pdf", "/senior-savings", "/goldstar/fees", "/bold/fees",
  "Compliance-Folder" and "Schedule-of-Fees-2022-No-Bold.pdf" (both live documents on prod), "gold-card",
  "priority-checking", "golden-eagle". "Retired", "former" and "legacy" are left out on purpose:
  "Retired Military Accounts" is a current product, and legacy pages are `legacy-page.ts`'s rule.
- Darwin (`src/lib/agents/darwin/old-labelled-document-check.ts`, the live re-check the standing rule
  requires): a loose path pre-filter picks candidates and the same rule decides. A fee comes down
  only when the bank's current fee link is a different, non-old address with a stored copy whose
  newest text does not state the fee (`checkFeeAgainstSource`). It is kept when the bank has no link,
  when the link is the old document or another old one (Magellan sends that link back to
  discovery), when the current link was never captured, or when the current text still prints the
  fee. This errs toward keeping a fee whenever nothing proves a newer schedule exists. Behind
  `OLD_LABELLED_DOCUMENT_TAKEDOWN_LIVE`, which is off.

**Decision on "no other captured document":** the brief allowed taking a fee down whenever the
bank's current link is a different, non-old URL. This check also asks for a stored copy of that link
with text: Westreet's current link has never been fetched, so nothing shows it answers or that it is
a schedule. And it keeps a fee the current copy still states, since that price is today's
(Clackamas). Once Magellan captures the current links, the next pass judges these fees again.

**Dry-run count (prod, read-only, Nov 3):** the pre-filter matched 238 live fees; 152 are not
old-labelled under the exact rule (gold, golden, priority, Compliance-Folder, No-Bold and the like),
and 86 are. **0 would come down**: 52 sit on a document that is the bank's own fee link (WinSouth 24,
Central Jersey Police & Fire 16, Citizens Bank & Trust 12), 32 at Westreet whose current link was
never captured, and Clackamas's 2 (95581 Regular Checking $7.00, 95582 NOW $8.50) are stated at the
same amounts on its current page (doc 16917). The verdicts were computed by running
`findOldLabelledDocuments` on the rows the step's SQL returns; only doc 16917's text is read by the
rule, and it was loaded from its stored copy.

**Not verified:** the session that built this could not reach any of the five banks' sites (the
egress proxy refused every host), so no bank's current live schedule was checked. Whether
Westreet's `/documents/fee-schedule` exists, and whether the WinSouth, Central Jersey and Citizens
Bank & Trust old documents still match those banks' current prices, is unknown. Hence the switch
stays off.

**Not changed:** no fee is touched by this PR, and no stored link changes until Magellan's next fetch
of the three old links (and of Cleo State Bank's and Access FCU's). Clackamas's live NOW $8.50 appears twice
(95582 from the archive copy and 160398 from the current page); that duplicate is the duplicate
checks' job, not this one's.

**Guard:** `src/lib/agents/magellan/old-labelled-link.test.ts`, `src/lib/agents/magellan/find-validate.test.ts`, `src/lib/agents/magellan/finders.test.ts`, `src/lib/agents/magellan/second-document.test.ts`, `src/lib/agents/magellan/fetch.test.ts`, `src/lib/agents/darwin/old-labelled-document-check.test.ts`

**Agent lesson:** magellan/issue-1455-an-old-labelled-document-is-not-the-fee-link, darwin/issue-1455-an-old-label-needs-a-newer-schedule-to-take-down

**Issues:** #1026 (master tracker), #1455
