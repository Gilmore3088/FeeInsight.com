# 2026-10-26: publish cut a fee's threshold off its name, and the re-read could never settle it
**What happened:** #1443 left one open item: publish's hold reads the stored name, but the row goes
live under `publishedFeeName`, whose `nameBeforeLeaders` cut "threshold figures out of real names".
A read-only prod check on Oct 26 of the 7,241 live fees whose name differs from their verified name
found 19 still showing that cut, e.g. 149336 "monthly fee if balance falls below" (read "... below
$2,500.00"), 157375 "Overdraft/NSF Charge, per item if the amount of the individual item is",
109755 "Paid NSF Item <" and 139704 "Non Member Check Cashing Fee - For checks". 8 of the 19 are
fragments no live check reads (`liveFragmentName` passes them). Darwin's live check flags 6 others
as `sentence_end` and asks Knox to re-read them; Knox settled each request as `same_name`,
`other_category` or `ambiguous` on every rules version (149336 nine times since Oct 17), because
the whole name it reads equals its own raw name, which the re-read never treats as a new read.
Publishing again would also cut names Knox's live tidy had restored (131639 "Check cashing if less
than $100", 108016 "Cashier's check more than $1,000").
**Cause:** `nameBeforeLeaders` ended the name at the first dollar figure outside a parenthesis. A
figure inside an open parenthesis was kept since Oct 9 ("(daily balance falls below $500)"); one the
words before it lead into ("below", "of", "is", "<") or the words after it complete ("or less",
"and over") was not. The fragment was made by the publish step, not by the read, so no read-side
fix could reach it.
**Fix:** this PR. `nameBeforeLeaders` keeps a threshold figure, a range's second figure and a tier
after it, cuts at a fee's own price ("A fee of $20.00 will be ..."), at a second tier ("Up to $2,500
Over $2,500") and after the sentence that ends on the kept figure. Across the 2,199 verified rows
with a figure in the name, it changes 303 published names and no publish, hold or category-guard
verdict; on the 54 live fees named apart from their verified name whose published name it changes, every new name passes the
category guard and adds no name rule, Darwin's `sentence_end` flag goes from 31 to 1, and 1 gains a
`pronoun` flag (90789, a $5 `reread`, no takedown). Live fees keep their names until a switch: with
`KNOX_REREAD_PUBLISHED_NAME_LIVE` (off) a kept-live re-read request whose fragment is the head of
today's published name of Knox's own read takes that name. Dry run on the stored texts: 16 of the 19
would be renamed if asked; Darwin asks for 6 today, and 5 of those would be renamed (154070 is
`not_found` at its price); all 19 names trace with `checkFeeAgainstSource`, and the 5 read right
against the bank's own line. Also here: the hold collapses a doubled space inside a name before its
cut-off test, so the collapse no longer counts as Knox's repair (5 of 2,366 held names escaped with
one added; 0 live or verified rows on prod have one).
**Lesson:** a name repair that leaves the name ending on "below", "of" or "<" made the fragment it
was meant to remove; check what a repair publishes, not only what it cuts.
**Guard:** `src/lib/agents/hamilton/publish.test.ts` ("keeps a threshold the name leads into or completes"), `src/lib/agents/knox/reread-feedback.test.ts` ("published-name repair").
**Agent lesson:** hamilton/issue-1443-keep-the-threshold
