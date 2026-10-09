# 2026-10-09: fold rules were measured with the same narrow patterns they used
**What happened:** PR 779 (fold v7) was reported as proven on prod at 01:41 UTC Oct 9, with 0 or 1
rows left per rule. The UAT thread then matched names more broadly and found about 17 more safe
deposit box late fees still in late_payment, written as "Box Late Payment Fee", "SDB Late
payment", "Safe Box Late Fee" and "Rental Late Fee". It also found 4 "IRA Excessive Withdrawal"
rows in account_research and "Duplicate Lien Satisfied" in legal_process. For PR 783, UAT's
baseline was 13 returned-statement rows, not 10, because "Return Statement Charge" and "Return
of Paper Statement" do not say "returned".
**Cause:** each rule's regex was written from a few sample names. The prod check then reused that
regex, so it could only confirm that the rule moved what the rule matched.
**Fix:** this PR (fold rules v9) widens the box-rent, lien and returned-statement rules and adds
an IRA excess withdrawal rule (account_research to ira_administration). A rule can now carry
more than one target (`also`).
**Lesson:** prove a fold rule with a broad name search that is independent of the rule, such as
every row in the source key that names the thing in any wording. Count what is left, and list
why each leftover stays. A row the new type's price range rejects (a $1 box late fee, or a $2
returned statement against account research's $5 minimum) stays put on purpose.
