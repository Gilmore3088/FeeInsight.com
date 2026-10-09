# 2026-10-09: A hand-found link for First United, Oklahoma was another First United's schedule
**What happened:** First United Bank and Trust Company of Durant, Oklahoma (institution 118,
firstunitedbank.com) was given three hand-found schedules, and none were its own: First Bank of
St. Louis's first.bank schedule, then First United Bank & Trust of Oakland, Maryland's overdraft
opt-in form and account disclosures on mybank.com (institution 595's own website). Each re-read
published Maryland's fees under Oklahoma, and Hamilton's other-bank check rolled them back
(25 fees at 01:38 UTC). The loop repeated on every fetch.
**Cause:** discovery refuses a link on another institution's own website (`other-bank-host.ts`),
but hand-found schedules skipped that check, and the companion review never retired a stored page
for it. The banks share a name, so a person searching for the name found the wrong one.
**Fix:** `addOperatorSchedules` and `addHandFoundLink` refuse a link on another institution's own
website, and `reviewStoredCompanions` retires stored pages there (reason `other_bank_host`), hand-found
or not. On prod that retires four pages: three at 118 and Cornerstone Bank of North Dakota's (663)
page on the Massachusetts Cornerstone Bank's site. The 118 entry is removed from `OPERATOR_SCHEDULES`.
Institution 595 already holds its own copy of the same PDF (document 12922) and 35 live fees.
**Lesson:** same-name bank, different domain. A person's check is no proof against a same-name
bank; the domain rule applies to every link, whoever found it.
