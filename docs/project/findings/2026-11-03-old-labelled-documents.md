# 2026-11-03: Live fees published from documents whose own address calls them old

**Lesson:** The address a bank links to is never taken as its fee link when its path or link label
calls the document old or archived. A fee already live from such a document comes down only when the
bank's current schedule shows it is stale.

**What happened:** Read-only prod queries on Nov 3 found live fees (published_fee_records with
`rolled_back_at` and `quarantined_at` both NULL, traced through `lineage_ref` ->
`verified_fee_observations` -> `raw_fee_observations.source_document_id` -> `source_documents`) on 5
documents that label themselves old or archived. Together they hold 86 live fees at 5 banks:

| Bank | Document | Live fees | Bank's fee link (`fee_schedule_url`) / remembered address |
|---|---|---|---|
| Westreet FCU (6933) | `westreet.org/wp-content/uploads/2021/06/Fee-Schedule-Old.pdf` (doc 2229) | 32, fee 43316 among them | `http://www.westreet.org/documents/fee-schedule`, which redirects to the "Old" file: fetch attempts 1832859 (Oct 14) and 2909890 (Oct 26) landed on doc 2229 |
| WinSouth FCU (8661) | `winsouthcu.com/_/kcms-doc/1526/59288/PDF.FEE.SCHED.716.OLD.pdf` (doc 14834) | 24 | the old document itself (both) |
| Central Jersey Police & Fire FCU (4740) | `cjpolicefirefcu.org/old-web-site/` (docs 18186, 30666) | 16 | the old document itself (both) |
| Citizens Bank & Trust Co. (3767) | `cbt-co.com/deposit-accounts/schedule-of-fees-old` (doc 38970) | 12 | the saved link is the old document; the remembered address is `/deposit-accounts/common-features` |
| Clackamas County Bank (2619) | `clackamascountybank.com/archive-2021/personal-checking.php` (doc 20233) | 2 | `/personal-checking.php` (doc 16917) |

Two more saved links match the same rule but carry no live fee from an old document: Cleo State
Bank (3642, `/old-home.html`) and Access FCU (7235, `/pdf/truthnsavings_old.pdf`).

**Cause:** Magellan never read a candidate's address or link label for its age. Its address checks
already refuse business-only, error, article, legacy and non-fee documents (`find-validate.ts`), but
a file named "Fee-Schedule-Old.pdf" passed as a fee schedule. Once such a document was the saved
link, the weekly fetch kept re-reading it. Nothing downstream could see the problem: the live-site
audit checks the page a fee cites, and an old page still prints its old prices.

**Fix (process first):**

- The rule lives in Magellan (`src/lib/agents/magellan/old-labelled-link.ts`). It reads path
  segments, filename words and camel case. It never reads the host. A path is old when any of these
  hold:
  - "superseded", "obsolete" or "outdated" appears anywhere in it.
  - A segment is, or starts with, "archive", "archives" or "archived" (`/archive/`,
    `/archive-2021/`), but not inside a run-together word such as `/DocumentArchive/`.
  - "expired" is the last word of a segment.
  - "old", "previous" or "prior" is the last word of a segment (before the extension), or comes
    right before a document or site word ("old-fee-schedule", "old-web-site", "old-home").
  - A link label is old when one of these words stands next to a document word ("Old Fee Schedule",
    "Fee Schedule (Archived)").
- The rule reads the address the bank links to, never where a redirect lands. Westreet's current
  link redirects to "Fee-Schedule-Old.pdf", and that file may well be its current schedule, so the
  bank keeps its link.
- How Magellan applies it:
  - Discovery: such a candidate scores 0 (`scoreLink`), is refused before it is opened
    (`old_labelled`, on the linked address only), and is never a companion.
  - Rosetta never points a fee link at such a file (`linkedFeePageCompanion`).
  - Fetch (`oldLabelledFetchAction`), always before anything is downloaded or stored:
    - An old saved link goes back to discovery: `failure_reason = 'magellan_old_labelled_link'`, the
      URL added to `rejected_source_urls`, and the remembered address dropped. This happens whatever
      address the profile remembers (Citizens Bank & Trust).
    - An old remembered address beside a current saved link is set aside, and the saved link is
      fetched.
    - A person's locked correction is never moved.
- Exclusions, tested:
  - "/older-adults-checking", "/prior-notice", "oldnational.com/fees.pdf" (host),
    "/old-national-fee-schedule.pdf", "/senior-savings", "/goldstar/fees", "/bold/fees".
  - "/lost-or-expired-card-fees", "/DocumentArchive/".
  - "Compliance-Folder" and "Schedule-of-Fees-2022-No-Bold.pdf", both live documents on prod.
  - "gold-card", "priority-checking", "golden-eagle".
  - "Retired", "former" and "legacy" are left out on purpose: "Retired Military Accounts" is a
    current product, and legacy pages fall under `legacy-page.ts`'s rule.
- Darwin (`src/lib/agents/darwin/old-labelled-document-check.ts`) is the live re-check the standing
  rule requires. A loose path pre-filter picks candidates, and the same rule decides.
  - The current link's copy is the document its newest plain fetch stored, when the profile
    remembers that link. Otherwise it is the newest stored copy at the link's address.
  - A fee comes down only when all of these hold: the current link is a different, non-old address;
    its copy is one Rosetta typed `fee_schedule`; and that copy's newest text does not state the fee
    (`checkFeeAgainstSource`).
  - A fee stays live in any of these cases:
    - It has no amount or no name (`not_judged`).
    - The bank has no link.
    - The link is this old document, or the link's own fetch landed on and stored it (Westreet).
    - The link is itself old-labelled.
    - The current link has no stored copy.
    - The copy is not a fee schedule (a landing or product page).
    - The current text still prints the fee.
  - So the check keeps a fee whenever nothing proves a newer schedule exists. It runs behind
    `OLD_LABELLED_DOCUMENT_TAKEDOWN_LIVE`, which is off.

**Decisions (review of #2968):**
- The label rule reads the address we ask for, not where it redirects (Westreet). A first version
  read Westreet's current link as "never captured". That was wrong: the link was fetched, and it
  redirects to the "Old" file.
- Taking a fee down also needs the current link's copy to be a fee schedule, and the fee to be absent
  from it. A fee the current copy still states keeps its price, because that price is today's
  (Clackamas).

**Dry-run count (prod, read-only, Nov 3, after review):**
- The pre-filter matched 238 live fees. 152 are not old under the exact rule (gold, golden, priority,
  Compliance-Folder, No-Bold and the like). 86 are.
- **0 would come down:**
  - 80 sit on a document that is the bank's own fee link, or that the link's fetch lands on:
    Westreet 31, WinSouth 23, Central Jersey Police & Fire 14, Citizens Bank & Trust 12.
  - 4 have no amount and are `not_judged`: 138882, 155615, 155424, 156124.
  - Clackamas's 2 (95581 Regular Checking $7.00, 95582 NOW $8.50) are stated at the same amounts on
    its current page, doc 16917. Rosetta types that page `product_page`.
- The verdicts come from running `findOldLabelledDocuments` on the rows the step's own SQL returns.
  The only text the rule read was doc 16917's, loaded from its stored copy.
- Saved links the fetch would send back to discovery: 3767, 4740, 8661, 3642 and 7235. Westreet
  (6933) is excluded: its saved link and remembered address are `/documents/fee-schedule`. No other
  profile remembers an old-labelled address.

**Not verified:** the session that built this could not reach any of the five banks' sites, because
the egress proxy refused every host. So no bank's current live schedule was checked. It is unknown
whether Westreet's "Old" file is its current schedule, and whether the WinSouth, Central Jersey and
Citizens Bank & Trust old documents still match those banks' current prices. Hence the switch stays
off.

**Not changed:**
- This PR touches no fee.
- No saved link changes until Magellan's next fetch of those five banks.
- Clackamas's live NOW $8.50 appears twice (95582 from the archive copy and 160398 from the current
  page). That duplicate is the duplicate checks' job, not this one's.

**Guard:** `src/lib/agents/magellan/old-labelled-link.test.ts`, `src/lib/agents/magellan/find-validate.test.ts`, `src/lib/agents/magellan/finders.test.ts`, `src/lib/agents/magellan/second-document.test.ts`, `src/lib/agents/magellan/fetch.test.ts`, `src/lib/agents/rosetta/read.test.ts`, `src/lib/agents/darwin/old-labelled-document-check.test.ts`

**Agent lesson:** magellan/issue-1455-an-old-labelled-document-is-not-the-fee-link, darwin/issue-1455-an-old-label-needs-a-newer-schedule-to-take-down

**Issues:** #1026 (master tracker), #1455
