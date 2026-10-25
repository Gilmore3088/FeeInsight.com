# 2026-10-25: a read date is not a schedule date

**Lesson:** When Magellan reads a document, record the date the document states, not just when it
was fetched. A schedule dated more than two years ago goes back to discovery to look for a newer
one. A recent fetch of an old schedule does not make its prices current.

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
  The stated date is the latest "Effective ..." date, read by Hamilton's own readers rather than a
  copy (the later of `effectiveDate()` and `editionStarts()`, which reads the edition line past a
  web page's menu), or "Revised/Rev./Updated" date found there. With neither, it falls back to the latest year in the address. The step writes the three
  columns and one `magellan.stated_dates` run event with stale samples and their evidence words.
- The freshness search picks up a bank once at version 2 when the link's own document (its last
  main fetch, or the current copy of the link's page, never a companion) states a date more than
  24 months old.
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

**Not yet done:** the public pages do not show "schedule dated 2022, read Oct 2026" yet. That
belongs to the Page templates lane and needs the columns filled first. A rate disclosure's date on
a fee page ("Rates are effective as of November 15, 2013") also counts as the page's date.

**Agent lesson:** magellan/issue-1878-stated-date-not-read-date
