# 2026-11-03: a schedule's closing edition line was not read, so a 2027 schedule would replace today's prices

**Lesson:** A schedule can state its edition on its last line, after its footnotes. An edition-only
line that closes the text ("Effective Date 01/05/2027.") dates the whole schedule, and a schedule
not yet in effect must never supersede the prices in force today.

**What happened:** Re-read backlog dry run 7 (40 stored texts, Knox v173; full report in the session
scratchpad, `rb7/verdict.txt`). GTE Federal Credit Union's page "Member Schedule of Current Charges"
was fetched again on 2026-11-03 (doc 42265, text 40659). The new copy ends:

```
... 20. Includes deposit accounts, loan accounts, and credit card accounts. |
Effective Date 01/05/2027.
711 E. Henderson Ave., Tampa, FL 33602 | 813.871.2690 | gtefinancial.org
```

The older copy (doc 13905, crawled 2026-10-03) states no date and carries the prices GTE charges
today. All 34 changed GTE rows matched the new copy's lines, but those prices start on January 5,
2027. Seventeen of them are the same fee name at a new price on a newer copy of the same page, so
publish's same-page supersede (publish.ts:1404-1411) would take down 16 live fees, every one correct
on today's schedule (#82596 account research $20 to $30, #82600 verification of deposit $20 to $25,
#82602 stop payment $35 to $37, #90921 NSF (courtesy pay) $35 to $37, #90923 overdraft transfer $7
to $8, #90926 mailed statements $7 to $9, and ten more).

**Cause:** `lateEdition` (schedule-edition.ts) read a late edition line only when it named the
schedule before "effective" ("Fees Effective 1/1/2027") or sat right under a short schedule title
("FEE SCHEDULE" / "Effective January 1st, 2027"). GTE's line has nothing before "Effective" and a
long footnote line above it, so `notYetEffective` returned null although `effectiveDate()` read
2027-01-05. The publish hold (`editionHolds`) and Darwin's `darwin.edition_effective_check` share
the reader, so neither held it.

**Urgency (SELECT on prod, 2026-11-03 03:16 UTC):** text 40659 had 0 raw rows and no extract attempt.
The normal Knox selector (`textArtifactQuery`) puts a never-read current copy behind live fees in its
first tier whatever `KNOX_REREAD_BACKLOG_LIVE` says, about third of 82 such texts; Knox v172 made 149
extract attempts in the three hours before. Reported to the coordinator for an operator decision.

**Fix:** `closingEditionLine` in `lateEdition`: an edition-only line (`EDITION_ONLY_LINE`: nothing but
"Effective", an optional "Date", "as of" or "on", a date, and closing punctuation or a footnote mark)
counts as the schedule's edition when no price follows it to the end of the text, no short heading
(80 characters or less, no price) sits right above it, and the whole text is shorter than
`EDITION_SCAN_CHARS`, so the reader sees every line after it from the SQL window or the full text
alike. The line above a cut at `EDITION_HEAD_CHARS` is judged whole. The announcement-title skip does
not apply to a closing line under a long footnote ("Fees are subject to change" is not a notice).
The existing guards still apply: a page that calls its prices current, an edition line that disagrees
with another, "effective immediately", another document's date, branch hours. Darwin's edition check
moves to v5 (Bayes manifest updated).

**Dry run (SELECT on prod, 2026-11-03, judged locally with the old and new reader):**

| Set | Documents | Edition date changed | Not yet effective (old to new) |
|---|---|---|---|
| Short texts with a 2026-2028 "effective" line past the heading (`effective[^\n]{0,40}` year, line end) | 690 | 44 | 2 to 4 |
| Short texts with an edition-only line and no `$` after it (any year) | 262 | 153 (all past dates but 2) | 0 to 2 |
| Texts with an edition-only 2026-2028 line past the heading, any length, dated 2027-2028 or November-December 2026 | 13 | 2 | 3 to 5 |

The two new not-yet-effective documents are GTE 42265 (2027-01-05, no rows yet) and Solon/Chagrin
Falls FCU 16774 ("Fee-Schedule-December-1-2026.pdf", whose text ends "Effective December 1, 2026"
under its last priced row; checked against the stored text). Darwin's `judgeEditions` on the live and
held rows of the 62 institutions whose documents changed (455 rows on 33 documents): holds 0 to 7
(Solon's 7 live fees, #54211-#54216 and #60891, held until 2026-12-01 and then restored by the same
check), restores 0 to 0, takeovers 0 to 0. The other changed documents gain a past edition date: they
hold nothing, and the SQL window (`editionWindowSql`) cuts texts whose only late date is before 2026 to
their heading, so the live check never sees most of them. Readers that compare editions
(`history-check`, `monthly-pulse`, competitor alerts) may now date those documents; Magellan's
`effectiveStatement` already takes the latest `effectiveDate()`, which reads every such line.

**Not covered:** a closing edition line in a text longer than `EDITION_SCAN_CHARS` (8,000 characters);
its later pages may print prices after it, and the SQL window does not send the tail.

**Guard:** `src/lib/agents/hamilton/schedule-edition-late.test.ts`, `src/lib/agents/darwin/edition-effective-check.test.ts`.
**Agent lesson:** hamilton/backlog-dry-run-7-closing-edition-line
