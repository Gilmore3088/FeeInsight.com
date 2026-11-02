# 2026-11-01: a fee's section was read one line at a time, so headings two levels up were lost

**What happened:** the reviews of #2863 (closed) found failure classes that come from not knowing a
document's structure: retired sections, older effective-date blocks, audience headings two levels up.
Before building anything, every published read on main was checked against the 291 Texas, seven-state
and lab texts (the shadow lab's stages, Darwin's audience decision with its own-price clause). Read by
hand, per text:

| Class | Reads on main | Where |
|---|---|---|
| Only rows under a grandfathered or previously offered section | 4 | Texas key 2445 "Grandfathered Checking Account Types:" ($5, $7.50 monthly); Texas key 2426 "Previously Offered Products" > "Features" ($0 and $25 monthly) |
| Same, but the fee is also printed at the same price in the current section | 3 | Texas key 2426 boxes "3x104", "5x104", "10x104" (current copies print "3x103"...) |
| Under a retired-worded heading whose fees apply to current holders | 10 | State key 5608 "Safe Deposit Box Rental Fees (discontinued)" / "Fees applicable to current safe deposit box holders" (kept: the box is closed to new rentals, the fees are charged today, and the answer key keeps them) |
| In an older effective-date block when a newer block prints the same fee | 0 | 53 texts print an effective date and 11 print two or more; each dates its own section (State keys 11477, 13303, 10358), repeats the schedule's one date, dates a rate, or (live audit 2538) dates new and existing accounts; none prints one fee in an older and a newer block |
| Under a business heading, published unknown or both | 58 | State key 3981 (29, a column line naming business in both cells), State key 1338 (16, "Business Customers" and its scope sentence), Texas key 2434 (6, "Business Account(s)" > sub-sections), Texas keys 2445 (2), 2437 (2), 2420 (1), live audits 1082 (1) and 2538 (1) |

Many other flagged lines were not real: navigation menus ("Business Banking" in a site menu), sibling
sections ("Business Account Fees" then "Domestic Debit Card / ATM Fees"), a carousel's "Previous" link,
and three-column agreements read across their columns.

**Cause:** every reader climbed the text one line at a time. `legacyHeadingAbove` stopped at the first
blank line (web pages are stored with a blank line between every line) and at any sub-heading with a
section word ("Transactional Fees", "Features"); `sectionHeadingAudience` skipped a column line whose
cells all name business, and stopped at a schedule title before reaching "Business Customers"; and
`suggestAudience` leaves a business heading undecided in any schedule that also prices business
items, because a distant heading could not be tied to the fee's section. Rosetta stores no heading
levels (`html-dom.ts` writes h1-h6 as plain blocks; PDF font sizes are not kept), so there was no
structure to reuse.

**Fix (`src/lib/section-path.ts`, `SECTION_PATH_LIVE`, off):** a pure, deterministic section path for
every line of a stored text. Headings, column lines, a table's title row, header rows, date lines and
notes are told apart; each heading gets a rank (3: a schedule title, a heading over a date line, or one
whose next lines state its scope; 2: other headings; 1: a colon heading or a title row); a heading
closes every open heading of its own rank or lower. Blank lines never end a section, a menu of three or
more headings counts as its last, a repeated accordion title is read once, a name over a price-first
line is a row, and four paragraphs in a row end every section. With the switch on:
- Darwin's audience (`suggestAudience`, through `darwinAudience`) takes the innermost heading on the
  path that names consumer or business. A heading for both or every account inside it does not widen
  it, an outer heading naming the other audience leaves the fee unknown, and a heading over two-column
  rows decides across them only when it states its scope or is a column line whose every cell names
  the audience.
- The shared check's `discontinued_account` refusal reads a legacy or retired heading anywhere on the
  row's path, an older schedule's own heading ("Previous Fees", "Prior Fee Schedule"), and, for a row
  that only a column heading names, every copy of the row it traced (`retiredTracedRow`).

The effective-date rule was not built: no measured text needed it.

**Measured** (shadow lab, `npm run test:shadow-lab`; read diff over all 291 texts):

| Measure | Main | Switch off | Switch on |
|---|---|---|---|
| Lab answer-key recall | 956 / 1,312 | 956 / 1,312 | 956 / 1,312 |
| Lab false publication | 33 / 160 | 33 / 160 | 33 / 160 |
| Texas gate (right / wrong) | 589 / 11 | 589 / 11 | 585 / 11 |
| Seven-state gate (right / wrong) | 915 / 30 | 915 / 30 | 915 / 30 |
| Published reads over 291 texts that change | | 0 | 36 relabelled, 4 held |
| Golden set (`SWITCH_GATE_SWITCHES=SECTION_PATH_LIVE`) | | | pass, no member moved |

Switched on, the 36 audience changes are 34 unknown to business and 2 both to business, all under a
business section; each was read by hand and none is wrong. (The first head, 863cebf, changed 47: its
review found headings that close a business section in real layouts but not in the ranks, and the
fix below refuses those, giving up 6 consumer and 5 business reads that were right.) The 4 holds are the 4 retired-section reads above. The Texas gate's 4 lost reads are
those 4: Texas keys 2445 and 2426 were keyed on Oct 6, before #2070, and key previously offered and
grandfathered accounts' fees as current. The lab has no audience measure, so its numbers cannot move
with the audience half; the read diff is that measure. Of the 58 business-section reads, 23 stay as
they are: a stray unpriced line ("Waived for CSCU Documents") closes 3981's column line, Title Case
sub-headings under a heading may be siblings and refuse (1338's "Non-Ameris Bank ATM Usage:", 2434's
"Other Services Fees"), and `feeLineIndex` finds some fees' lines elsewhere (2437's $3 transfer).

**Review of 863cebf (three blockers, fixed in this PR):** with the switch on, a general heading after
a business section ("Fees applicable to all accounts:", "Other Fees:", "Other Services | Fee") nested
under it and read business; a retired heading of rank 3 stayed on the path across the next Title Case
section ("Previously Offered Products" ... "Checking Accounts"); and a consumer heading the classifier
did not take for one (a bullet, a heading over twelve words, a two-item menu) left consumer fees under
business. Now only the fee's own heading decides, or a heading stating its scope (or an all-same column
line) over sub-headings set visibly below it (column lines, capitals under Title Case); a general or
every-account heading over the fee defers to main; any unpriced line naming another audience between
the last row before the heading and the fee refuses; a retired heading counts only while every heading
between it and the row is visibly under it, and a "Current ..." heading ends it; "Previous / Prior /
Old Fees" count only beside a current schedule the text prints. The review's 22 cases are near-miss
tests.

**Not measured:** live counts. No production access in this session. `npm run audit:switch-dry-runs`
section 4 counts the live fees the switch would take down and those whose audience decision changes.

**Lesson:** a fee's audience and currency are often said only by a heading two levels above its row, or
by the sentence under that heading. Read the section path, and decide only where the path ties the fee
to the heading.

**Agent lesson:** knox/issue-1092-read-the-section-a-fee-sits-in
**Guard:** `src/lib/section-path.test.ts`, `src/lib/section-path-near-miss.test.ts` (55 near misses)
