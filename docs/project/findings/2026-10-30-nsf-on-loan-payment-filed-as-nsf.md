# 2026-10-30: a mortgage subservicer's NSF charge went live as a credit union's NSF fee

**Lesson:** An NSF word does not make a fee the account's NSF fee: read what bounced. A charge for a
bounced loan, mortgage or lease payment ("NSF Loan Payment", "NSF mortgage payment: Additional Cenlar
charge") is the loan's servicing fee, filed as other lending. A guard that refuses a product by one
word ("loan") must refuse every word for it ("mortgage", "lease"), and a refusal that knows where the
fee belongs should re-file it there instead of dropping it.

**What happened (Hamilton proof run, Oct 30):** Global FCU (institution 5005) had a live $25 NSF fee,
"» NSF mortgage payment: Additional Cenlar charge" (67831, doc 1940; and 67818, doc 19930, the same
line in the credit union's compliance packet). Cenlar is the credit union's mortgage subservicer.

The document is not a third party's and was not mis-attached: both are Global FCU's own PDFs on
globalcu.org (`03241-akusa-sads-service-fees.pdf`, `02443-consumer-compliance-packet.pdf`), and the
line is in the credit union's own schedule (stored texts 1049 and 15726):
`From a Savings or Money Market Share or | » NSF mortgage payment: Additional Cenlar charge ....... $25.00 per item`.
Discovery and source linking were right. The error is in categorisation.

**Cause:**
- Knox filed the line as NSF by its "NSF" word (the first category pattern that matches). Its
  #1099 rule files a *returned* loan payment as other lending, but nothing read an NSF one.
- The shared category guard (`fee-category-guard.ts`, used by Darwin's verify and Hamilton's live
  guard) refuses an NSF name that says "loan", but not "mortgage" or "lease", so the Cenlar charge
  passed and went live (verified with `second_source_agrees`, because both PDFs print it).
- The "loan" refusal has no re-file: Knox filed 30 such reads at 16 institutions as NSF (read-only,
  Oct 30). The 15 other institutions' names say "loan" ("NSF Loan Payment", "NSF for Automatic
  Loan Payment"), so they failed NSF and were lost rather than filed as the loan's fee.

**Class (read-only, Oct 30):** live fees whose name prices a bounced loan, mortgage or lease payment
under NSF: 2 (both Global FCU's). Live fees whose source names another company as the fee owner
("Additional Cenlar charge", "charged by", "imposed by", a processor or a subservicer): a name search
over `published_fee_catalog` found the same 2 as the only ones filed as the bank's own NSF; the
other "third party" names are payees or requesters ("Cashier's check payable to third party"), or
the bank's own price with a pass-through note ("plus fees charged by ATM owner").

**Fix:**
- `src/lib/custom-report/loan-payment-nsf.ts` (`loanPaymentNsfName`, with its Postgres mirror
  `LOAN_PAYMENT_NSF_NAME_SQL`): the NSF words price the loan payment itself. One price for the
  account's items and a loan payment ("NSF check/Loan Payment", "Nonsufficient Funds Loan Payment,
  Returned Check") stays NSF.
- Knox v144 files such a read as other lending.
- The category guard's switched re-file (`LOAN_PAYMENT_NSF_REFILE_LIVE`, off): on, an NSF fee with
  such a name fails NSF for new reads. Live fees are re-filed in place to other lending by Darwin's
  re-check (`src/lib/agents/darwin/loan-payment-nsf-refile-check.ts`), behind the same switch and the
  12-hour second look. Its read and UPDATE skip admin-corrected fees, and the UPDATE is guarded on
  the old category, name and amount, still live, not quarantined and no live other lending twin.
  One fee re-files per bank and price (the lowest-numbered): the UPDATE's twin test reads the table
  as it was before the statement, so two same-price fees in one batch would both have moved and
  shown the loan charge twice. A fee whose bank already has a live other lending fee at its price,
  or whose same-price sibling re-files, is a twin and comes down as a duplicate
  (`loan_payment_nsf_twin: live fee #<twin>`), the way the reread category re-check takes down its
  twins, only while that twin is live as other lending at that price. Hamilton's category guard
  leaves a fee to Darwin only when the other lending guard accepts its name (Darwin re-files it or
  takes it down); one it refuses falls through to Hamilton's own re-file and takedown, so none stays
  live as NSF.
  Read-only dry run (Oct 31, the read's pre-filter on prod): 2 live fees, both Global FCU's $25, no
  live other lending fee there. Outcome: 1 re-filed (67818) + 1 twin (67831), which comes down once
  67818 is live as other lending; the bank ends with one live other lending fee at $25.
- The name rule's Postgres mirror agrees with the JavaScript rule on all 25 test cases (run with
  `~*` on prod, read-only, Oct 31).

**Follow-up (not fixed here):** 67818's stored name is garbled: "From a Savings or Money Market Share
or: » NSF mortgage payment: Additional Cenlar charge" carries the neighbouring column's text and the
"»" bullet from the two-column layout. It is the row that stays live (lowest number), so its name
needs cleaning (Knox's two-column name split, or Hamilton's live name refresh) before or after the
re-file.

**Guard:** `src/lib/custom-report/loan-payment-nsf.test.ts`, `src/lib/agents/knox/loan-payment-nsf.test.ts`, `src/lib/agents/darwin/loan-payment-nsf-refile-check.test.ts`, `src/lib/agents/hamilton/category-guard-loan-payment-nsf.test.ts`.
**Agent lesson:** knox/nsf-on-a-loan-payment-is-the-loans-fee, darwin/guard-word-lists-cover-the-whole-product
