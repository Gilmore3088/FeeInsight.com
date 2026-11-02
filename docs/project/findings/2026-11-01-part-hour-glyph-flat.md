# 2026-11-01: a price "per ½ hour" was read and published as a flat charge

**Lesson:** A unit reader that lists spellings misses the ones it was not written for: "per half
hour" and "per 1/2 hour" were known, "per ½ hour" was not, so Navy Federal's checkbook balancing
went live as a flat $5.00. A fee charged per part of an hour also had no live path at all when its
stored frequency was blank: the hourly re-check leaves part-hour prices alone by design, Hamilton's
fill infers no unit for a blank, and the own-unit re-check read only per-item fees.

**What happened:** issue #1905 (Navy Federal, institution 4956) listed several misread live rows. On
Nov 1 (prod, read-only) the ATM table, prepaid and gift card, mortgage late-charge and home equity
rows were already down or re-filed. What was still live and wrong, grouped by cause:

| Cause | Navy Federal live fee | Live elsewhere | Fixed here |
|---|---|---|---|
| Part-hour unit lost: "$5.00 (per ½ hour)" read flat | 122355 Checkbook balancing (repeated) | 34 at 30 institutions with a blank frequency priced per part of an hour (9 at 8 written with ½ or ¼) | yes |
| A partner network's ATM price: "Returned Check Deposits: $6.00" from the CO-OP column's cell, an ATM owner's charge (footnote 1) | 158292 (doc 39026, a superseded copy) | none found: of 137 live documents with a non-network ATM header, 6 hold a network table and only 158292 takes another column's price | no (Knox already blanks such rows since #2648; the live row needs a re-check, checklist line) |
| One overdraft fee read twice, from the table row and the footnote sentence "We will charge a fee of $20 each time we pay an overdraft" | 165796 beside 122356, both $20 | not counted | no (checklist line) |
| A correct read under an old name: "ATM fees: Transfer" $1 (today's read names it "Transfer at Non-Navy Federal/Non-CO-OP Network ATM") | 145758 (doc 26712, a superseded copy) | not counted | no (name only; amount and category match the schedule) |

Still missing (breadth, not misreads): overnight card delivery ("Weekday delivery $12.00 Saturday
delivery $20.00") and notary ("First 2 per week: no charge; each additional: $5.00").

**Cause:** `specialUnitAfterPrice` (`src/lib/fee-unit.ts`) matched "half hour", "1/2 hour" and "30
minutes" but not the glyphs ½ and ¼. Knox's own-unit pass (`withOwnFeeUnit`) uses it, so a new read
kept no unit, and Darwin's own-unit re-check could not prove one. The re-check's candidates were also
only per-item fees (`OWN_UNIT_ROWS_SQL`), so a blank-frequency part-hour fee was never read.

**Fix:**
- Knox v152: `specialUnitAfterPrice` reads "½ hour", "½ hr", "¼ hour" after the price as
  `per_half_hour` / `per_quarter_hour`; the hourly re-check's part-hour exemption
  (`PARTIAL_HOUR_WORDING`) knows the glyphs too. A "½ hour minimum" is still no unit.
- Darwin's own-unit re-check also reads a live fee with no frequency whose stored line names a part of
  an hour, judged exactly as a per-item fee, but only for a part-hour unit, and writes it only with its
  own switch, `OWN_UNIT_BLANK_PART_HOUR_LIVE` (off).

**Dry run (prod, read-only, 2026-11-01):** 1,508 live blank-frequency flat fees have a unit word on
their stored line; 35 prove a part-hour unit there (`ownUnitVerdict`). With each document's newest
text and `checkFeeAgainstSource`: 34 re-file at 30 institutions (31 `per_half_hour`, 3
`per_quarter_hour`), 1 is kept as `unit_conflict` (49730, "Account Balancing (30 minutes) $25.00"
beside another fee's $100). Navy Federal's 122355 is among the re-files. Every re-file traced on the
current text; the one to look at before switching on is 48422 ("$10.00/15 minute minimum", read per
quarter hour). Price, name, category and liveness never change.

**Agent lesson:** knox/issue-1905-fraction-glyph-part-hour

**Guard:** `src/lib/fee-unit.test.ts`, `src/lib/agents/knox/part-hour-unit.test.ts` (Navy Federal's
stored lines), `src/lib/agents/darwin/own-unit-check.test.ts` (blank part-hour fees, their own switch).
