# 2026-11-02: most fee schedules had no stated date because the reader looked only at the opening

**What happened:** A fee database a consultant can cite has to say which edition of each bank's
schedule a fee came from. Read-only on prod, Nov 2: `source_documents.stated_date` was set on
6,592 of 41,293 documents. Of the 6,597 current copies behind live fees, 3,537 had no date
(31,423 live fees sit on current copies without one).

A sample of 250 of those 3,537 (ordered by `md5(id)`), with their stored text (`agent_source_texts`)
checked against the reader's patterns:
- 79 state no year anywhere in the stored text.
- 29 state the schedule's own date in a form v1 does not read:
  - an "Effective" line past the first 8,000 characters, after a web page's menu ("Fee Schedule:
    Effective 2/1/2026" at character 23,530, doc 39443);
  - a footer or form stamp ("Rev. 06/2021", "rev 05.01.2023", "M619 01.2026 ©DCU",
    "03/01/2025 Member FDIC", "Federally Insured by NCUA | 07/2025", "v 09/01/26");
  - a month and year ("Effective July, 2024", "Effective 11/2026");
  - a misspelling ("Efective March 6, 2024");
  - a heading ("Approved February 22, 2022", "July 2025" under the letterhead, "Schedule of Fees
    ... (October 1, 2026)", "revised as of May 1, 2026", "Reviewed: February 1, 2019");
  - "as of 07.01.2025" ending a sentence about the fees.
- The other 142 print only dates that are not the schedule's: rate and APY effective dates,
  holidays, promotions, news posts, maintenance windows, "accounts opened before 10/26/2020", or
  copyright years.
- PDF metadata (creation or modification date) is not stored anywhere. The only file-level date is
  the HTTP `Last-Modified` header (`source_documents.last_modified`, on 88 of the 250). That is when
  the server last touched the file, not the edition, so it is not used.

**Cause:** `readStatedDate` (v1) read the first 8,000 characters only, as far as Hamilton reads an
edition line. It knew "Effective" with a full day, "Revised / Rev. / Updated", and currency lines.
Schedules that date themselves at the foot of each page, deep in a long web page, or with a month
and year alone stayed undated.

**Fix (stated-date reader v2, `STATED_DATE_READER_VERSION` 2, `readStatedDateV2` in
`src/lib/agents/magellan/stated-date.ts`):** v2 adds the forms above. It keeps these out:
- a deep line about another document (privacy policy, agreement), a rate, a loan or a promotion;
- a bare date with no footer mark beside it;
- two lone dates in the opening (a list, such as holidays);
- any date more than 60 days ahead, and any year before 1990.

A stated date feeds Darwin's dated-edition takeover, which is live, so v2 writes nothing until
`STATED_DATE_BACKFILL_LIVE` is on. Until then, one discover step in 6 reads 100 v1 current copies with
v2 (by primary key, about 60 ms) and reports what it would date (`stated_dates.backfill`). Turning it on makes the pass's own
selector re-read every v1 document, 200 a step.

**Dry run (Nov 2, the 250-document sample):** v2 would date 29 of the 250 (11.6%). Projected onto
the 3,537, that is about 410 documents; this is an estimate, not a count. Those 29 carry 451 live
fees. 6 of the 29 are at a bank where another text-dated document has live fees, so Darwin's
dated-edition takeover could compare them. How many fees it would retire is not known until the
backfill runs.

**Lesson:** look past the opening only where the schedule dates itself, and never take a date from
a line about something else (one fee's change notice, a news post's date, a copyright line).

**Agent lesson:** magellan/issue-1878-schedule-date-past-the-opening-and-in-the-footer
