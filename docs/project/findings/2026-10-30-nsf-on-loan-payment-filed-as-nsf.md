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
  such a name fails NSF and re-files to other lending, in place, through Darwin's re-check of every
  live fee when `CATEGORY_GUARD_VERSION` is bumped at switch-on. Read-only dry run (Oct 30, the
  mirror over live NSF fees): 2 live fees would re-file (67818, 67831); Global FCU has no live other
  lending fee, so nothing is duplicated.

**Guard:** `src/lib/custom-report/loan-payment-nsf.test.ts`, `src/lib/agents/knox/loan-payment-nsf.test.ts`.
**Agent lesson:** knox/nsf-on-a-loan-payment-is-the-loans-fee, darwin/guard-word-lists-cover-the-whole-product
