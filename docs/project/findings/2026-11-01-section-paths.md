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
- Darwin's audience (`suggestAudience`, through `darwinAudience`) is decided only by the fee's own
  heading when it names consumer or business, or by a heading that states its scope (or a column line
  naming the audience in every cell) with nothing but column lines between it and the fee. It refuses,
  leaving main's reading, when the heading over the fee is general or for every account, when an outer
  heading names the other audience, when any unpriced line from the last row before the heading to
  the fee names another audience, and over two-column rows unless the heading states its scope.
- The shared check's `discontinued_account` refusal holds a row only when its own section heading is a
  legacy or retired heading (or a plain column line of that retired table sits between), with no other
  heading line of any kind between them; blank lines do not end it. An older schedule's heading
  ("Previous Fees") counts only beside a current schedule's heading. For a row only a column heading
  names, every copy of the row it traced must be held that way (`retiredTracedRow`).

The effective-date rule was not built: no measured text needed it.

**Measured** (shadow lab, `npm run test:shadow-lab`; read diff over all 291 texts):

| Measure | Main | Switch off | Switch on |
|---|---|---|---|
| Lab answer-key recall | 956 / 1,312 | 956 / 1,312 | 956 / 1,312 |
| Lab false publication | 33 / 160 | 33 / 160 | 33 / 160 |
| Texas gate (right / wrong) | 589 / 11 | 589 / 11 | 587 / 11 |
| Seven-state gate (right / wrong) | 915 / 30 | 915 / 30 | 915 / 30 |
| Published reads over 291 texts that change | | 0 | 33 relabelled, 2 held |
| Golden set (`SWITCH_GATE_SWITCHES=SECTION_PATH_LIVE`) | | | pass, no member moved |

Switched on, the 33 audience changes are 31 unknown to business and 2 both to business, all under a
business section (State key 3981 17, 1338 9, Texas key 2434 4, 2445 1, live audit 2538 1, lab case
75618 1); each was read by hand and none is wrong. The 2 holds are Texas key 2445's grandfathered CK03
$5 and CK01 $7.50, which is the Texas gate's 2 lost reads: the key was written on Oct 6, before
#2070, and keys grandfathered accounts' fees as current. Texas key 2426's two previously offered
monthly fees are no longer held: a sub-heading sits between "Previously Offered Products" and their
rows, and the narrow rule leaves such rows to main. The lab has no audience measure, so its numbers
cannot move with the audience half; the read diff is that measure. Of the 58 business-section reads,
32 are fixed; 26 stay as they are, because the rule refuses wherever a sub-heading could be a sibling
section (1338's "NIGHT DEPOSIT" and "Non-Ameris Bank ATM Usage:", 2434's "Other Services Fees"), a
stray unpriced line closes 3981's column line, or `feeLineIndex` finds a fee's line elsewhere.

**Reviews (#2872, all fixed in the PR):** the first head (863cebf) relabelled 47 and held 4, and its
review found three ways to label or hold a fee wrongly: a general heading after a business section
read as its sub-section ("Other Fees:"), a retired heading reached across the next section, and a
consumer heading the classifier did not take for one (a bullet, a long heading, a two-item menu) left
consumer fees under business. The second head (b56ee83) relabelled 36 and held 4, and its review found
the retired rule still reached across colon headings, title rows and capitals siblings ("Other Fees:",
"Wire Transfers | Fee", "OTHER SERVICES"), and a scoped business heading across capitals siblings
("KIDS SAVINGS"). Both rules are now narrow by construction: no heading line of any kind between the
deciding heading and the fee except plain column lines. Every case from both reviews is a near-miss
test.

**Not measured:** live counts. No production access in this session. `npm run audit:switch-dry-runs`
section 4 counts the live fees the switch would take down and those whose audience decision changes.

**Lesson:** a fee's audience and currency are often said only by a heading two levels above its row, or
by the sentence under that heading. Read the section path, and decide only where the path ties the fee
to the heading.

**Agent lesson:** knox/issue-1092-read-the-section-a-fee-sits-in
**Guard:** `src/lib/section-path.test.ts`, `src/lib/section-path-near-miss.test.ts` (55 near misses)
