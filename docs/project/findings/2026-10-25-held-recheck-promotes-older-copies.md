# 2026-10-25: Knox's held-line recheck promoted lines read from older copies of a page

**Lesson:** A line held on an older copy of a page is history, not a fee. Before a held line goes
to Darwin, its document must be its page's current copy, and a name rule that admits new lines
must keep the ambiguous ones (a conditional, tiered, percentage, second or opening price, a price
per year, quarter, item or debit, or one name printed at two prices on one page) held. Darwin's
category guard must admit the same name shape in the same change, read from the same pattern.

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

The independent review of #2618 then found two more problems. First, Darwin's category guard (v85)
admitted a monthly maintenance name only when it said maintenance, monthly service, service charge
or monthly fee, so every one of the 41 promoted lines would have failed `category_mismatch`
(name_unsupported) and Bellco FCU's $3.95 would never publish. Second, the checking-name pattern let
through opening and setup charges ("New Checking Account Fee", "Re-open Checking Fee": the hyphen
got past `reopen\w*`), business accounts (corporate, non-profit, analysis, IOLTA, trust and others)
and other fees' words (replacement, late, lost, withdrawal, deposit and others), and the ambiguity
check let through prices per year, quarter, item or debit, closure and initial-deposit charges, and
"if ... not chosen" prices. Two of the 41 were such: First Federal's "EZ Checking Fee $4.95 if
standard features are not chosen" (raw 166502, doc 6800, and raw 655353, doc 30291, both current
copies). Neither copy states a period for the $4.95; it is charged only when the member declines the
standard features, so it is a conditional charge, not a flat monthly fee.

**Cause:** `recheckHeldRows` checked that the row's stored text is the document's current text
(`text_hash`), but not that the document is still its page's current copy. Magellan keeps every
copy of a page and marks the newer one current; the held rows of older copies stayed eligible. The
guard and Knox each kept their own idea of a monthly fee's name, so a name Knox learned was one the
guard still refused.

**Fix:** `recheckHeldRows` now joins `source_documents` and re-reads only lines on a current copy
(`status = 'success'`, no `duplicate_of_id`, no `superseded_by_id`). A line filed only by
`CHECKING_ACCOUNT_FEE_NAME` stays held when its price is ambiguous (`checkingNamePriceAmbiguous`
in `rules.ts`, also applied at first read in `specialists.ts`: now also a price charged only "if" or
"when" something happens, a closure or initial-deposit charge, and a price per year, quarter, item or
debit) or when the same page prints the same name at another price (`checkingNameHeld`). The pattern
moved to `src/lib/checking-fee-name.ts` and keeps out opening, setup and reopening charges, business
accounts and other fees' words. The category guard (v86) admits a monthly maintenance name that the
same pattern reads as the account's own checking fee (`namedForCheckingAccount`), so Knox and the
guard cannot drift.

**Dry runs (read-only, Oct 25):**
- Held-line recheck, v109 against v110 as fixed, current copies only, on the prod rows read at
  12:54 UTC (re-checked at 13:05: all 92 lines any version promotes are still held, their copies'
  current flags unchanged, and no newer held line names checking, a thousands figure or a bracketed
  waiver): 39 lines at 29 institutions go to Darwin as monthly maintenance, down from 41 at 30
  (166502 and 655353 now held). All 39 trace in `checkFeeAgainstSource` on their stored text, pass
  guard v86 (all 39 fail v85) and get no reason code from Darwin's `verificationReasonCode`.
- Five institutions have the same fee promoted from two current copies, or twice from one: 5412
  (docs 3341 and 21322, Rise $6 and Peak $8), 5532 (docs 2700 and 23056), 8041 (docs 14737 and
  26107), 6017 (docs 29420 and 38353) and 5503 (raw 400981 and 253617, one line of doc 18902 read
  under two names). They do not both go live: Darwin verifies both copies of a two-document pair
  (its in-batch key includes the document), but Hamilton's publish step finds the first copy live at
  the same institution, category, frequency and price and skips the second as "Identical fee already
  published" (`decidePriorFee`); where the frequencies differ, the exact-duplicate gate refuses or
  replaces it (`exactDuplicateDecision`, same name, unstated frequency matches any). The one-document
  pair shares Darwin's in-batch key (same document and source line), so the second is
  `duplicate_in_batch` when both are in one batch and "identical" at publish otherwise.
- Guard v86 against v85, over every live fee and every guard takedown whose name contains
  "checking (account) fee|charge" (38 live, 2 taken down; no other name can change verdict): no
  verdict, re-file or restore changes.
- Darwin re-judges rows it rejected as `category_mismatch` under an older guard. 17 Knox rows with
  such a name carry that rejection; v86 admits 10, of which 7 are due again (Knox still flags them
  for Darwin, no verified row): 176852 (Accent Checking, $5, institution 7193, which already has a
  live $5 monthly fee), 640692 ($5 basic checking, 8677), 669181 and 669182 (Hometown Checking Plus
  $5 and Plus 50 $3, United State Bank, 2525, each named for its account) and 677982, 677986 and
  800100 (LiveWell Checking $5.95 on three copies, 2718). Each traces in `checkFeeAgainstSource` on
  its own lines (read as a window around the line, not the whole text). At most four new live fees
  at three institutions follow, if the rest of Darwin's checks pass.

**Not yet known:** whether other held categories have lines on older copies that earlier versions
already promoted; this fix stops new ones only.

**Guard:** `src/lib/agents/knox/checking-fee-name.test.ts`, `src/lib/checking-fee-name.test.ts`,
`src/lib/agents/knox/held-recheck.test.ts`.
**Agent lesson:** knox/issue-1918-named-checking-fee, darwin/issue-1918-guard-reads-knoxs-name-pattern
