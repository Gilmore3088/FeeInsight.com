# 2026-10-22: Safe deposit boxes went live named by their size alone

A name rule that adds words the row does not print must teach the shared source check and the
same-line check to read the row by its own words, or the better name loses the fee.

**What happened:** The W43 live audit's replay in the shadow lab (#2064, #2544) found 30 fees that
pass every stage under a wrong name. 26 were safe deposit boxes named only by their size: "10x10
Annual Fee", "3 x 10", "10X10", 'Large (10"x10")', "3” x 10” x 22” Box". A box table prints its sizes
under a heading ("Safe Deposit Box Annual Rental", "Self Storage Lease Boxes") that the row never
repeats. Knox filed the category from the size, but named each fee by its row's words alone.

**Cause:** Knox's name tidy (`tidyFeeName`) kept the row's own cell. Nothing between Knox and
publication adds what the row is.

**Fix:** Knox rules v99 names a bare box size "Safe Deposit Box" plus the row's own words
(`boxSizeNamed` in `src/lib/custom-report/box-size-name.ts`, run at the end of `tidyFeeName`).
A name with any other word, two sizes, a paper size (8.5x11, 11x17) or a footnote figure is left
as read. Knox renames only a read it files as `safe_deposit_box`; every other caller of
`tidyFeeName` keeps the size as read.

The first try only renamed. It lost 30 answer-key fees (924 -> 894 of 1,312), because the self-check's
`checkFeeAgainstSource` looks for the name on the page, and "Safe Deposit Box 10x10 Annual Fee" is
not printed there. Hamilton's same-line check (`linesApartOnPage`) also merged the renamed $25 5x5 box
with the $25 key replacement. Both now read a name built this way by the row's own words
(`asReadBoxName`), with two limits from the review of 3f7803d:
- The fee must be filed as `safe_deposit_box`. A null key never qualifies, because Knox's self-check
  passes the read's category.
- The size must lead its own row (`leadsBoxRow`). "Night Deposit Bag 10x12 $20.00" and "Wire Transfer
  3x5 $25.00" do not trace as boxes.

Name re-tidy stays at v26 and does not apply the rule to live names. How many live names it would
change is not measured: no dry-run count has been run.

A few smaller live paths can still move without a count:
- Rules-recheck restores and Darwin's verify now pass a "Safe Deposit Box <size>" name of a fee filed
  as a box, where they failed it before.
- Hamilton's `normalizedFeeName` reads such a name as its row's words. So a live "5x5 Annual Fee" and
  a live "Safe Deposit Box 5x5 Annual Fee" are one line in Darwin's `edition-effective-check` grouping,
  in `refresh-copy` (fewer `name_differs` skips) and in Hamilton's supersede.
- `reread-feedback` can rename a live box fee to the box name when its open request's fragment has 3
  or more words.
- Knox's held re-check matches held rows by exact name. A held bare-size row no longer matches
  today's box-named read, so that path only gets more conservative.

None of these is counted.

Shadow lab, before -> after:
- Names that match the schedule: 287 -> 313 of 317.
- Answer-key recall: 924 of 1,312, unchanged.
- All-expected recall: 1,286 of 1,766, unchanged.
- Live audit recall: 339 of 431, unchanged.
- Known-wrong fees published: 34 of 160, unchanged.
- Texas gate: 590 right, 11 wrong. Held-out: 60 right, 4 wrong. Seven-state gate: 885 right, 34
  wrong. All unchanged.
- Ratchet: no expectation lost or gained. It scores fees, not names.

**Lesson:** Before giving a fee a name its row does not print, list every check that looks for the
name on the page (the self-check, Darwin's verify, Hamilton's same-line check). Map the new name
back to the row's words in each one, and check recall in the shadow lab as well as the name score.

**Guard:** `src/lib/custom-report/box-size-name.test.ts`; `src/lib/agents/knox/layout.test.ts`
("v99: names a bare box size..."); `src/lib/agents/hamilton/publish.test.ts` ("finds a box Knox
named by its size apart..."); the shadow lab name score. Agent lesson:
knox/issue-2064-box-size-names.
