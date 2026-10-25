# 2026-10-25: the edition reader never saw a schedule's date behind a web page's menu

**Lesson:** A web page's first lines are often its menu, so a schedule's own edition line can sit
further down. Read it there only with guards: most pages that date a future edition past the menu
are still current pages announcing the next one.

**What happened:** T1 of the Hamilton V5 plan (current-schedule checks: document type, effective
date, supersession). The #1915 rule (`editionStarts`, PR #2523) dates a document by the first 400
characters of its stored text. A read-only prod measure on 2026-10-25 ranked the current-schedule
gaps by live fees (88,025 live fees at 4,349 banks):

| Gap | Live fees | Fixable without James? |
|---|---|---|
| Superseded source copy (the newer copy of the same page replaced it) | 6,433 | Mostly no (below) |
| Not a fee schedule by Rosetta's document kind (product page 3,639, Truth in Savings 2,350, other 1,919, agreement 1,821) | 9,729, of which 564 conflict in price with the bank's current schedule | Product-page part is behind `PRODUCT_PAGE_CONFLICT_LIVE` |
| Duplicate source document | 925, of which 4 repeat a live fee on the original | Link only, no price effect |
| Schedule not yet in effect, heading read | 0 (166 already held by #2523) | Live |
| Schedule edition stated past the first 400 characters | 472 documents, 6,225 live fees carry such a line | Yes: this finding |

The superseded-copy fees split by where the newer copy stopped (newest copy in each chain): newer
copy has live fees but not this line 3,256 (current-copy check, `CURRENT_COPY_CONFIRM_LIVE`, James);
the same category and amount live on the newer copy under another name or audience 750 (not the same
line for refresh-copy or the page-copy collapse); newer copy has no completed text 727 (Rosetta
refused nearly all of those copies as account or product pages, and for 591 of the fees the older
copy was a product page too; #2482's question); newer copy's Knox rows never verified 880; read but no Knox rows 361; verified but not published 459.

**Cause:** `EDITION_HEAD_CHARS` (400) was chosen so a date further down a schedule (one line's
change) is not read as its edition. On a web page the first 400 characters are usually navigation,
so the page's own "FEE SCHEDULE / Effective …" line was never read.

**Adversarial samples (prod stored texts):** reading any future "effective" date past the menu
would have held 182 live fees on 13 documents. Only one is a schedule not yet in effect:

| Doc | Live fees | What the page is | Rule |
|---|---|---|---|
| 36178 Allentown FCU newsletter | 1 | "FEE SCHEDULE / Effective January 1st, 2027" | Held (with the switch on) |
| 38397, 17320 MCCU | 32 | Links the Dec 1 schedule above "Current Consumer Fees … in effect through November 30, 2026" | Current prices: not held |
| 37226, 25479, 2041, 13448 BayPort | 36 | "New Fee Schedule effective November 1, 2026." above a "Fee - Current" table | Announcement, current prices |
| 36403 Wyrope | 29 | Newsletter: "2027 Updated Fee Schedule" | Announcement |
| 20371 Minnwest | 31 | Disclosure packet contents: "Schedule of Fees … Effective 11.01.2026 ……44" | Contents entry |
| 22307 BMO | 13 | "Important Notice Effective 11/7/2026" about funds availability | Not about fees |
| 38132, 30611 | 23 | Consumer fees "Effective 1/1/2027", business fees "Effective 1/1/2023" | Two editions: not judged |
| 37380 MECU | 17 | Heading "EFFECTIVE JANUARY 2, 2026", a 2027 schedule further down | Heading wins |

**Fix:** `lateEdition` in `hamilton/schedule-edition.ts`, used by `editionStarts` when the heading
states no edition. A line past the heading counts when it has "effective <date>", no price and no
contents leader, ends at its date (or a footnote mark), and either has only the whole schedule's
name before "effective" ("Fees Effective …", "Business Fee Schedule - Effective …") or sits under a
short title naming the whole schedule ("Fee Schedule", "Schedule of Fees", "Fees and Charges";
never a bare "schedule" or one section's "<X> Fees"). A "Current Fee" or "Fee Today" column counts
as current prices. The heading's
filters apply; announcement, notice and link words (on the line or the title above) skip a line; a
page that calls its prices current, or whose edition lines disagree, gets no late edition. Both
readers get the same text: `editionWindowSql` sends up to 8,000 characters only for texts with an
effective date in this year or the next two past the heading (982 of 9,133 cited documents,
6.3 MB), and Darwin's read sends each document's text once, joined after the per-fee sort. The switch `EDITION_LATE_HEADING_LIVE` is
off: Darwin's edition re-check (`EDITION_CHECK_VERSION` 2) reports `late_heading_would_hold` and holds nothing on that
account until James approves.

**Dry run (prod, read-only, 2026-10-25, the new read → `judgeEditions` off and on):** 24,932 live
or held fees checked on 1,548 dated documents (19,431 before: documents dated only past the menu are
now read). Today's rule: 0 holds, 0 restores, 0 retirements. With the switch on: 1 more hold, fee
149487 "Monthly Service Charge" $0, Allentown FCU (5481), doc 36178. Checked against the stored text
(text 34322, 15,554 characters): its only "effective" is the 2027 heading at character 5,821, and the
line "Monthly Service Charge | NONE" is the first row of that schedule's share account fees. The bank
keeps 18 live fees from its checking page (doc 36182). The read took 11.6 s (EXPLAIN ANALYZE).

**Independent review (PR #2573, first head):** the first guards still dated six kinds of current
page with the switch on: a link line ("Consumer Fee Schedule Effective January 1, 2027 (PDF)"), a
rate or holiday schedule title ("Dividend Rate Schedule" / "Effective December 1, 2026"), a
newsletter sentence ("Our fees and charges effective January 1, 2027 are listed on our website."),
"Coming soon: Fee Schedule effective …" and a "Notice to Members" title. A second review found
more: a table with a "Current Fee" column beside "Fees Effective January 1, 2027", notice titles
("Fee Updates", "Fee Waivers", "No More Overdraft Fees") and one section's date ("Overdraft Fees" /
"Effective …", "Wire transfer fees effective …:"). So the reader now takes only the whole
schedule's name, not any line with a fee word. None of these is in prod's texts today; each is
refused and tested. The same review timed Darwin's read at 20.7 s against
main's 7.8 s (a per-fee join carrying the 8,000-character text and a costly fee-word prefilter);
the rework ran in 5.6 s on prod (EXPLAIN ANALYZE, Oct 25), reading 28,930 live or held fees on
2,011 dated documents. The tighter reader only refuses more lines, so the switch-on dry run stays
at most the one Allentown hold, which the guard test still reads.

**Not fixed here:** sections with their own editions in one document (38132, 30611, MECU 37380;
40 live fees sit on those three) need a rule that dates the section a fee was read from.

**Agent lesson:** hamilton/t1-edition-line-past-menu

**Guard:** `src/lib/agents/hamilton/schedule-edition-late.test.ts`
