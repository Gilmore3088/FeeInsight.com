# 2026-10-25: the same-line restore brought copies back beside their older line's live replacement

**Lesson:** A takedown that names another line is not undone just because that line is down.
Follow that line's own takedown to the line that replaced it, and keep the fee down while a
replacement at its category and price is live (or held by the account type hold).

**Agent lesson:** hamilton/issue-1673-follow-the-replacement

**Guard:** `src/lib/agents/hamilton/same-line-duplicates.db.test.ts` (a replacement two steps on,
a held replacement, a replacement gone or at another price, a chain that leads back to the copy
itself, and Darwin's re-check through its second look), `src/lib/agents/hamilton/same-line-duplicates.test.ts`
and `src/lib/agents/darwin/same-line-replacement-check.test.ts` (the 17 prod rows of the dry run).

**What happened (#1673):** Hamilton's same-line check (`same-line-duplicates.ts`) takes a copy down
as `same_line_duplicate: live fee #<older>`, and its restore brought the copy back as soon as
`<older>` was no longer live. The restore did not ask why `<older>` was down. Often a newer line of
the same fee had replaced it (`refreshed by #N`, `duplicate of #N`, another same-line takedown), so
the copy went live beside that replacement and the bank's price showed twice. Institution 2580
showed Stop Payment $19.95 as both 15109 "for each check requested for stop payment." and 141864
"Stop Payment Fee - Check"; institution 8058 had four such pairs. The account type hold was not the
cause: none of the older lines was held (#1671).

**Fix (Hamilton restore v2):** `sameLineReplacementSql` follows the older line's takedown through
the lines it names (`refreshed by #`, `superseded by #`, `duplicate of #`, `same_line_duplicate:
live fee #`; the same takedowns the page-copy restore follows), at most 8 steps and never through
the copy itself, and returns the nearest one still on the catalog at the copy's institution,
category and dollar amount. The restore keeps the copy down while there is one. A chain that leads
back to the copy (prod's 14458: 104758, then 134564, then 134645, taken down in 14458's own favour)
is not a second copy, so 14458 still comes back.

**Re-check of what is already live (Darwin, `same-line-replacement-check.ts`, v1):** every verify
step reads the live fees whose `hamilton.same_line_duplicate` second look is `takedown_confirmed`,
follows the same rule (live, unquarantined replacements only), and matches a fee when the names
name one item (`repeatsScheduleLine`), the variants agree and the frequencies do not differ. Its
switch `SAME_LINE_REPLACEMENT_TAKEDOWN_LIVE` is off, so it only reports. Switched on, a match goes
through the 12-hour second look and is archived as `same_line_duplicate: live fee #<replacement>`,
so the restore brings it back if that line goes.

**Dry run (prod, read-only, 2026-10-25 22:14 UTC):** 17 live fees after a confirmed same-line
takedown (the issue counted 15 on Oct 16, before 14458 and 99504 came back). 8 at 5 institutions
sit beside a live replacement at their category and price, and each pair names one item, so all 8
would come down: 15109 (141864), 66618 (26395), 104751 (150871), 104866 (149020), 105031 (146002),
105032 (146006), 105033 (146009), 105034 (146010). 104751's replacement is now two steps on: 98076
was refreshed by 121389, since taken down as a duplicate of live 150871. 9 stay: 7 whose older
line came down for its own copy (`rules_recheck_unreproduced` 5, `source_check_untraceable` 2) and
14458 and 104891, whose chains reach no live line. 104891's replacement 146656 is held by the
account type hold; the restore counts it, the re-check leaves it to the hold. No restore is pending
today (none of the 147 same-line takedowns has an older line that is down and not held), so v2
changes no row on its own.

**Boundary:** no production write. The 8 pairs were matched by name, category, price, variant and
frequency, not yet against the bank's text with `checkFeeAgainstSource`; that check, and James's
yes, come before the switch goes on. 66618 "Re-presented overdraft items may be charged" beside
26395 "Overdraft" is the pair to read most closely.
