# 2026-10-25: Knox filed paper statement charges as the account's monthly maintenance fee
**What happened:** James's live fee check (round 2 batch 1, Oct 18, #1947) found TD Bank's "Paper
statements: $3 monthly fee" live as a $3 monthly maintenance fee named "Monthly fee", beside TD's own
live paper statement row. That row was already down (#1774), but the class was still live: 19 monthly
maintenance fees at 17 institutions were paper statement charges ("Service charge | $3.00 paper
statement fee each statement cycle", "A $2 paper statement fee applies if you are not enrolled in
eStatements", "*A monthly fee of $3 applies if you choose to receive paper statements", "Paper (mailed)
Statement Fee **** | $2.00 Monthly Fee"). 14 of them sat beside the bank's live paper statement fee at
the same price, so the same charge counted twice, once in the maintenance benchmark.
**Cause:** Knox named the price by the generic words around it ("Monthly fee", "Service charge", "A
monthly fee of") or by the account cell before it, and those classify as monthly maintenance. The
paper statement words that said what the price was for came after the price, where Knox's rules read
only the next fee's words, or in a footnote. Knox v114 (#2637) leaves a generic phrase's read as it is
on purpose, and the category guard read only the name (and, since v84, a service cell or heading
before a bare "Monthly fee"), so nothing read the words right after the price.
**Fix:** one matcher, `paperStatementPriceOnLine` (`src/lib/paper-statement-price.ts`), reads the
fee's own line at its price. Knox rules v115 (`paperStatementRead`) files such a read as the paper
statement fee. Category guard v91 fails a live or new maintenance fee whose line prices it so and
re-files it to paper_statement, in Darwin's verify and on Hamilton's live guard (which re-checks every
live fee on the version bump); paper_statement admits its generic name on that line. A fee beside a
live paper statement fee at the same price is the same fee and goes to the second look. The account's
own price for paper holders beside an electronic price ("$4 for paper statement or $3 for
estatement", "$7 with paper statement") stays maintenance.
**Scope (read-only, Oct 25):** 47 live monthly maintenance fees name paper, printed or mailed on their
line; 19 fail v91 (none fail on main), each borne out by its bank's newest completed stored text.
5 move in place (95610, 126632, 128394, 128395, 138716); 14 have a live paper statement twin and go to
the second look. Of 5 earlier guard takedowns with paper words, 1 (14316, "A $6.00 monthly paper
statement service charge will apply when not enrolled", no twin) can come back as a paper statement
fee if it traces on its own text.
**Agent lesson:** knox/issue-1947-paper-statement-price-is-not-maintenance
**Guard:** `src/lib/paper-statement-price.test.ts`, `src/lib/fee-category-guard.test.ts` (v91)
