# 2026-10-25: Knox's held-line recheck promoted lines read from older copies of a page

**Lesson:** A line held on an older copy of a page is history, not a fee. Before a held line goes
to Darwin, its document must be its page's current copy, and a name rule that admits new lines
must keep the ambiguous ones (a conditional, tiered, percentage, second or opening price, or one
name printed at two prices on one page) held.

**What happened:** porting #2532 (Knox v110, #1918), a read-only dry run on 2026-10-25 re-read the
2,079 held lines on current texts that name checking, a thousands figure or a bracketed waiver.
The new rules promoted 74 lines at 35 institutions. 30 of the 74 sat on a document that is not its
page's current copy: 28 on a superseded copy (`source_documents.superseded_by_id` set; Acadian FCU's
"Opportunity Checking Fee | $12.00/month" on five copies of one page, Regional FCU's "First Step
Checking Fee" on six) and 2 on a duplicate copy (Eaton Family FCU, doc 7840). One more,
The Peoples Bank's "Personal Convenience Checking fee | $ 8.00 if activity exceeds 25 checks & ACHs
in a month", is a 2023 schedule's activity-triggered charge; the bank's current checking page says
the $8 fee is waived with direct deposit. Two more, United State Bank's "$5.00 monthly Hometown
Checking fee" and "$3.00 monthly Hometown Checking fee", are two accounts' fees under one printed
name, so the name does not say which price belongs to which account.

**Cause:** `recheckHeldRows` checked that the row's stored text is the document's current text
(`text_hash`), but not that the document is still its page's current copy. Magellan keeps every
copy of a page and marks the newer one current; the held rows of older copies stayed eligible.

**Fix:** `recheckHeldRows` now joins `source_documents` and re-reads only lines on a current copy
(`status = 'success'`, no `duplicate_of_id`, no `superseded_by_id`). A line filed only by
`CHECKING_ACCOUNT_FEE_NAME` stays held when its price is ambiguous (`checkingNamePriceAmbiguous`
in `rules.ts`, also applied at first read in `specialists.ts`) or when the same page prints the same
name at another price (`checkingNameHeld`). With both, the dry run promotes 41 lines at 30
institutions; all 41 trace in `checkFeeAgainstSource` on their stored text. Nothing live changes:
these rules only decide which held lines go to Darwin.

**Not yet known:** whether other held categories have lines on older copies that earlier versions
already promoted; this fix stops new ones only.

**Guard:** `src/lib/agents/knox/checking-fee-name.test.ts`, `src/lib/agents/knox/held-recheck.test.ts`.
**Agent lesson:** knox/issue-1918-named-checking-fee
