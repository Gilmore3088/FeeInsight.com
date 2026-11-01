# 2026-10-25: refresh copy wrote live rows past publish's name hold
**What happened:** #1443 counted 264 live rows published after the name hold (#797, #803, merged
2026-10-09 02:34 UTC) that the hold should have stopped, none with a `publish.rules` attempt. A
read-only prod check on Oct 25 rebuilt the set with Oct 9's code (commit d4c45b0b4): 303 live rows
published Oct 9 to 15 that `publishNameHold` holds on their verified name. 273 of them carry a
`hamilton.refresh_copy` attempt and no `publish.rules` attempt (first 2026-10-09 03:27, last
2026-10-13 12:36 UTC, 27 on Oct 12 to 13), e.g. live 103068 "Counter checks-first five are free"
(refresh of 70583). 257 of the 273 have the same name as the live row they replaced, and 221 of
those replaced rows went live before the hold existed: refresh re-wrote old live names as new rows
with a new published date. The other 30 have `publish.rules` attempts, so they are not the issue's
set (most are `price_in_name` thresholds such as "Minimum Balance Fee (if Balance is Below $7,500)").
**Cause:** refresh copy v1 (`refreshFeesFromCurrentCopy`, `refresh-copy.ts:207` at d4c45b0b4)
moved a live fee to a newer copy of its page by writing a new row with `insertPublishedFee`, which
had no name hold; the hold lived only in `runHamiltonPublish`. Refresh copy v2 (#1223, commit
1c9ebe252, merged 2026-10-13 13:10 UTC) moves the live row in place and keeps its id, name and
published date, so that path closed on Oct 13; since then `runHamiltonPublish` is the only caller
of the writer, and it holds first.
**Fix:** this PR. The single writer (`writePublishedFee`, under every `insertPublishedFee` call)
reads `publishNameHold` itself, the same call the publish step makes, so no present or future path
can write a name the step would hold. It changes nothing for the publish step's own rows. Rows
already live this way are the live fragment check's to re-read (#1466, #1745).
Not fixed here, found on the way: the hold reads the stored name while the row goes live under
`publishedFeeName`. Holding the written name instead was tried and dropped: it holds real fees
whose threshold figure publish's own leader cut took out ("Cashier's check more than $1,000 (sold to
MCB customers only)" live as "Cashier's check more than", 108016; 26 of the 30 live names it
would newly hold in a prefiltered read of 6,923) and real names Knox repaired ("Overdraft Transfer from your other accounts",
shadow lab live audit 6595). Both belong to the name-repair steps (`nameBeforeLeaders` should keep
a threshold figure) and to narrowing `cutoff_name`, not to the hold.
**Lesson:** put a publish gate in the writer every path shares, not in one caller.
**Guard:** `src/lib/agents/hamilton/publish.admin-hold.test.ts` ("the single writer reads publish's name hold").
**Agent lesson:** hamilton/issue-1443-hold-in-the-writer
