# 2026-10-25: a read date is not a schedule date

**Lesson:** When Magellan reads a document, record the date the document states, not just when it
was fetched. A schedule dated more than two years ago goes back to discovery to look for a newer
one, and its link is replaced only by a page that states a later date. A recent fetch of an old
schedule does not make its prices current; a rate's effective date or an upload folder's year does
not make a current schedule old.

**What happened:** James's Oct 18 /fees audit (#1878) found a schedule linked from /fees with 2022
in its filename. Its "read" date was recent. Public pages show only when we read a document, so an
old schedule looked current. `source_documents` holds only fetch-side dates: `crawled_at`,
`last_checked_at`, and `last_modified` (the server's HTTP header, not the printed date). Darwin,
Hamilton and Deming each read a schedule's "Effective ..." line on the fly
(`hamilton/schedule-edition.ts`), but nothing stored it per document. The freshness search
(`discovery.ts`) worked it out again from the newest text, with its own regex and a three-year
threshold, and only for the bank's main link.

**Cause:** the schema had nowhere to keep a document's own date. Each reader worked it out again,
and nobody could count, show or act on the stale ones.

**Fix (#1878, James approved the schema change Oct 25):**
- Migration `20270110000077_source_document_stated_date.sql` adds three nullable columns to
  `source_documents`: `stated_date`, `stated_date_basis` (`effective_statement`, `printed_date`,
  `url_year`, `none`) and `stated_date_version`. It adds columns only and changes no data.
- Magellan's stated-date pass (`magellan/stated-date.ts`, `STATED_DATE_VERSION` v1) runs at the
  start of each `discover` step. Each step dates up to 200 documents, those live fees cite first,
  reading the first 8,000 characters of the newest completed text (Hamilton's `EDITION_SCAN_CHARS`).
  The stated date is the latest of: an "Effective ..." date, read by Hamilton's own readers rather
  than a copy (the later of `effectiveDate()` and `editionStarts()`, which reads the edition line
  past a web page's menu); a "Revised/Rev./Updated" date; and a currency line ("As of January 1,
  2026" heading the schedule, "current / accurate as of ...", "Disclosure Date: ..."). An
  "effective" that dates rates is masked first. Only a text with no date at all falls back to the
  latest year in the address. The step writes the three columns and one `magellan.stated_dates`
  run event with stale samples and their evidence words.
- The freshness search picks up a bank once at version 2 when the link's own document (its last
  main fetch, or the current copy of the link's page, never a companion) states a date more than
  24 months old. Such a search replaces the link only with a page that states a later date by the
  same reader; an undated, older or same-dated page leaves the link, and the refusal is kept on the
  attempt (`stated_date_check`) and in the step detail (`stated_date_refusals`).
- Ordering: the pass and the freshness search both check for the columns
  (`statedDateColumnsReady`). Until the migration runs, the pass reads and writes nothing
  (`schema_ready: false`), and the search query leaves out the stated-date arm.

**Dry run (read-only prod, 2026-10-25):** the counts come from a SQL copy of the reader's
patterns, and 11 sample documents were checked against the TypeScript reader. Of 8,418 documents
that live fees cite (85,723 live fees), 3,670 state a date: 2,760 from an effective statement, 328
from a printed revision date and 582 from the address. 1,227 are dated before 2024-10-25, carrying
16,774 live fees at 903 banks. The freshness search can act on 501 of them (9,364 live fees, 497
banks), the ones that are the bank's main link. 178 of those banks were already searched at
freshness v2 and are not searched again. The other 726 documents include companion pages (286)
and older copies (237); the rest are current pages that are not the bank's main link. They get
their date stored but no search. The issue's estimate of 1,542 stale documents (21,272 fees) could not be reproduced
with this reader; how that figure was counted is not recorded.

**Review fix (same PR, Oct 25):** an independent review found the first reader called current
schedules old, and the freshness search would then have replaced the bank's link with any other
page that passed the fee-page check. unclecu.org's `/uploads/2017/08/feeschedule.pdf` (doc 2282)
says "As of January 1, 2026" but was dated 2017 from its address; usccreditunion.org (docs 2307,
15227, "current as of September 17, 2026") and hebfcu.org (docs 12171, 31941, "accurate as of
October 12, 2026") the same way; riegelfcu.org (docs 2797, 14512, 27687) was dated by "Rates
effective September 1, 2024" above "FEES CURRENT AS OF: August 3, 2026"; myfsbonline.com (doc
32498) by "updated 06/2024" below "current as of 02/27/2026". The reader now reads currency lines,
masks rate "effective" dates, takes the latest date and never uses the address year once the text
states a date, and the search keeps the link unless the new page states a later date.

Re-measured (Oct 25, read-only): for each of the 8,417 documents behind live fees, the lines of its
newest completed text (first 8,000 characters) that hold "as of", "effective", "updated",
"revised", "rev." or "disclosure date" and a number, with the line before and after (up to 8 such
lines), were pulled by SQL and run through the old and the new reader locally. This is not the
whole text, so Hamilton's late-edition reader sees less than it would. On that input the old reader
calls 1,227 documents old (17,031 live fees, 908 banks), the same count as the dry run above; the
fixed reader calls 1,303 old (17,667 live fees, 963 banks: 938 from an effective statement, 221
from a printed or currency date, 144 from the address). 41 that the old reader called old now read
current or undated, all nine examples above among them; 117 are newly old, mostly pages that say
"accurate as of" or "current as of" an old date (product pages, credit card disclosures) that the
old reader left undated, and about 14 whose only newer date was a rate's. 58 of the 1,303 show a
newer sign the reader does not count (34 sit at an address naming 2025 or later, the rest have a
2025-2027 date in a line it does not read as the schedule's, such as one fee's own effective date);
these may be current. With the replacement guard such a document costs at most a search, never its
link.

**Not yet done:** the public pages do not show "schedule dated 2022, read Oct 2026" yet. That
belongs to the Page templates lane and needs the columns filled first. A rate's "effective" date is no longer read as the page's date, but a currency line about rates
("Interest Rates ... are current as of 02/27/2026") is, since it dates the document as printed. A
file at an address naming a later year than the date its text states (the file went up again
later) is still called old; only the replacement guard stops it costing the link.

**Agent lesson:** magellan/issue-1878-stated-date-not-read-date
