# 2026-10-20: free checking accounts never reached the index
**What happened:** #1100 asks why Knox misses monthly maintenance fees on the answer key. Deming's
replay (Oct 18) missed 68 of 126 monthly maintenance key fees. Production agrees: banks such as
8448 publish their priced checking accounts' monthly fees but none of their free accounts.
**Cause:** since v78 Knox holds a checking account's own free row ("Free Checking (CK02) | Free")
as a $0 monthly maintenance read, but it named the read with the bare product name ("Free Checking
(CK02)"). A product name does not say which fee it is, so Darwin's category guard refused every one
as "Fee name does not support its category". The priced account rows already got a fee name
("... Monthly service charge") and published.
**Fix:** this PR. Knox rules v91 names the free row "<account> Maintenance Fee", after the heading
filters that test the bare row. The name passes the guard and still traces to the bank's own row in
the shared source check. Business, savings and money market rows still fail the guard. The version
bump re-reads old texts, so the refused rows come back through Darwin.
**Still open (on #1100):** the answer-key gate still scores business and savings monthly fees that
the Oct 16 checking-only rule excludes; the replay has scored no bank since Oct 19 because every
answer-key bank's eligibility receipt is unknown or rejected; priced bare-product rows
("Interest Checking | $8.00") need the section heading as context; dormant and escheat fees over
$30 fail Darwin's envelope; returned-deposit wording gaps.
**Lesson:** a read is only as good as its name. A fee named only by its product cannot be checked,
so it never ships.

**Agent lesson:** knox/issue-1100-name-a-free-account-row-as-its-fee
